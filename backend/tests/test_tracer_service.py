import pytest
from unittest.mock import patch, MagicMock
from app.tracer_service import run_trace, TracerError, TracerTimeout
from app.trace_model import Trace, CompileError

# The two integration tests below are individually marked `docker` (they run
# the built image); the pure unit test carries no mark, so `-m "not docker"`
# selects only it in unit-only CI.


# ---------------------------------------------------------------------------
# Pure unit test — no Docker required.
# ---------------------------------------------------------------------------

def test_non_json_output_includes_exit_code_and_stderr(monkeypatch):
    """TracerError for non-JSON output must include returncode and stderr."""
    fake_proc = MagicMock()
    fake_proc.stdout = ""
    fake_proc.stderr = "boom"
    fake_proc.returncode = 1

    with patch("app.tracer_service.subprocess.run", return_value=fake_proc):
        with pytest.raises(TracerError) as exc_info:
            run_trace("int main(){}", "cpp")

    msg = str(exc_info.value)
    assert "exit 1" in msg, f"expected 'exit 1' in message, got: {msg!r}"
    assert "boom" in msg, f"expected stderr snippet in message, got: {msg!r}"


def test_run_trace_default_timeout_exceeds_trace_budget():
    """Backend timeout must sit above the ~45s valgrind trace budget so heavy
    programs return a partial trace instead of a wrapper timeout."""
    import inspect
    default = inspect.signature(run_trace).parameters["timeout"].default
    assert default >= 60, f"expected timeout >= 60, got {default}"


# ---------------------------------------------------------------------------
# Warm container pool — unit tests, no Docker required.
# ---------------------------------------------------------------------------

MINIMAL_TRACE_JSON = (
    '{"code": "x", "trace": '
    '[{"line": 1, "event": "step_line", "func_name": "main"}]}'
)


def _proc(returncode=0, stdout="", stderr=""):
    p = MagicMock()
    p.returncode = returncode
    p.stdout = stdout
    p.stderr = stderr
    return p


class FakeDocker:
    """Routes fake subprocess.run calls by docker subcommand and records them."""

    def __init__(self, inspect=None, exec_=None, warm_run=None, cold_run=None):
        self.calls = []
        self.inspect = inspect or []
        self.exec_ = exec_ or []
        self.warm_run = warm_run or []
        self.cold_run = cold_run or []

    def __call__(self, cmd, **kw):
        self.calls.append(cmd)
        key = self._classify(cmd)
        queue = getattr(self, key)
        assert queue, f"unexpected docker call: {cmd[:4]}"
        result = queue.pop(0)
        if isinstance(result, Exception):
            raise result
        return result

    @staticmethod
    def _classify(cmd):
        sub = cmd[1]
        if sub == "inspect":
            return "inspect"
        if sub == "exec":
            return "exec_"
        if sub == "rm":
            return "rm"
        if sub == "run":
            return "warm_run" if "-d" in cmd else "cold_run"
        raise AssertionError(f"unknown docker subcommand: {cmd}")

    rm = property(lambda self: [_proc()])  # rm -f always succeeds, unrecorded queue

    def subcommands(self):
        return [c[1] for c in self.calls]


def test_exec_reuses_running_warm_container():
    fake = FakeDocker(inspect=[_proc(0, "true\n")],
                      exec_=[_proc(0, MINIMAL_TRACE_JSON)])
    with patch("app.tracer_service.subprocess.run", side_effect=fake):
        result = run_trace("int main(){}", "cpp")
    assert isinstance(result, Trace)
    assert "run" not in fake.subcommands()


def test_starts_warm_container_when_missing():
    fake = FakeDocker(inspect=[_proc(1)],
                      warm_run=[_proc(0, "cid\n")],
                      exec_=[_proc(0, MINIMAL_TRACE_JSON)])
    with patch("app.tracer_service.subprocess.run", side_effect=fake):
        result = run_trace("int main(){}", "cpp")
    assert isinstance(result, Trace)
    start = next(c for c in fake.calls if c[1] == "run")
    assert "-d" in start and "--net=none" in start and "--memory=256m" in start


def test_timeout_kills_warm_container():
    """A guest process that outlives the exec timeout must not keep burning
    CPU inside the warm container — the container gets removed."""
    import subprocess as sp
    fake = FakeDocker(inspect=[_proc(0, "true\n")],
                      exec_=[sp.TimeoutExpired(cmd="docker exec", timeout=60)])
    with patch("app.tracer_service.subprocess.run", side_effect=fake):
        with pytest.raises(TracerTimeout):
            run_trace("while(1){}", "cpp")
    assert fake.subcommands()[-1] == "rm"


def test_cold_fallback_when_warm_start_fails():
    fake = FakeDocker(inspect=[_proc(1)],
                      warm_run=[_proc(1, "", "docker daemon angry")],
                      cold_run=[_proc(0, MINIMAL_TRACE_JSON)])
    with patch("app.tracer_service.subprocess.run", side_effect=fake):
        result = run_trace("int main(){}", "cpp")
    assert isinstance(result, Trace)
    cold = fake.calls[-1]
    assert cold[1] == "run" and "--rm" in cold


def test_cold_fallback_when_container_dies_mid_exec():
    fake = FakeDocker(inspect=[_proc(0, "true\n"), _proc(1)],
                      exec_=[_proc(137)],
                      cold_run=[_proc(0, MINIMAL_TRACE_JSON)])
    with patch("app.tracer_service.subprocess.run", side_effect=fake):
        result = run_trace("int main(){}", "cpp")
    assert isinstance(result, Trace)


# ---------------------------------------------------------------------------
# Local (in-container) tracer mode — unit test, no Docker required.
# ---------------------------------------------------------------------------

def test_local_mode_routes_to_local_tracer(monkeypatch):
    """CPP_TUTOR_TRACER=local must bypass docker entirely and still parse."""
    monkeypatch.setenv("CPP_TUTOR_TRACER", "local")
    fake = _proc(0, MINIMAL_TRACE_JSON)
    with patch("app.tracer_service.local_tracer.run_local",
               return_value=fake) as run_local, \
         patch("app.tracer_service.subprocess.run") as docker_run:
        result = run_trace("int main(){}", "cpp")
    assert isinstance(result, Trace)
    run_local.assert_called_once_with("int main(){}", "cpp", 60)
    docker_run.assert_not_called()


# ---------------------------------------------------------------------------
# Idle reaper — the warm container must not outlive a learning session.
# ---------------------------------------------------------------------------

class FakeTimer:
    instances = []

    def __init__(self, interval, fn):
        self.interval = interval
        self.fn = fn
        self.started = False
        self.cancelled = False
        FakeTimer.instances.append(self)

    def start(self):
        self.started = True

    def cancel(self):
        self.cancelled = True


@pytest.fixture
def fake_timer(monkeypatch):
    import app.tracer_service as ts
    FakeTimer.instances = []
    monkeypatch.setattr(ts.threading, "Timer", FakeTimer)
    monkeypatch.setattr(ts, "_reap_timer", None)
    yield FakeTimer


def test_exec_arms_idle_reap_timer(fake_timer):
    fake = FakeDocker(inspect=[_proc(0, "true\n")],
                      exec_=[_proc(0, MINIMAL_TRACE_JSON)])
    with patch("app.tracer_service.subprocess.run", side_effect=fake):
        run_trace("int main(){}", "cpp")
    from app.tracer_service import IDLE_TTL_SECONDS
    assert len(fake_timer.instances) == 1
    t = fake_timer.instances[0]
    assert t.interval == IDLE_TTL_SECONDS and t.started and t.daemon


def test_next_request_rearms_reap_timer(fake_timer):
    fake = FakeDocker(inspect=[_proc(0, "true\n"), _proc(0, "true\n")],
                      exec_=[_proc(0, MINIMAL_TRACE_JSON),
                             _proc(0, MINIMAL_TRACE_JSON)])
    with patch("app.tracer_service.subprocess.run", side_effect=fake):
        run_trace("int main(){}", "cpp")
        run_trace("int main(){}", "cpp")
    assert len(fake_timer.instances) == 2
    assert fake_timer.instances[0].cancelled
    assert fake_timer.instances[1].started


def test_shutdown_pool_cancels_timer_and_removes_container(fake_timer):
    import app.tracer_service as ts
    fake = FakeDocker(inspect=[_proc(0, "true\n")],
                      exec_=[_proc(0, MINIMAL_TRACE_JSON)])
    with patch("app.tracer_service.subprocess.run", side_effect=fake):
        run_trace("int main(){}", "cpp")
        ts.shutdown_pool()
    assert fake_timer.instances[-1].cancelled
    assert fake.calls[-1][:3] == ["docker", "rm", "-f"]


def test_idle_ttl_covers_thinking_gaps():
    """Learners pause up to half an hour between runs — TTL sits in the
    30-40min band: well above a thinking gap, well below 24/7."""
    from app.tracer_service import IDLE_TTL_SECONDS
    assert 30 * 60 <= IDLE_TTL_SECONDS <= 40 * 60


@pytest.mark.docker
def test_run_trace_returns_trace():
    with open("tests/fixtures/pointers.cpp") as f:
        code = f.read()
    result = run_trace(code, "cpp")
    assert isinstance(result, Trace)
    assert len(result.trace) >= 3
    assert any(pt.func_name == "main" for pt in result.trace)

@pytest.mark.docker
def test_compile_error_is_structured():
    result = run_trace("int main(){ return", "cpp")
    assert isinstance(result, CompileError)
    assert result.message


MEMBER_FN_CODE = """\
struct Box {
    int v;
    int grow(int by) {
        v += by;
        return v;
    }
};
int main() {
    Box b{1};
    int r = b.grow(4);
    return r;
}
"""


HEAVY_STATE_LOOP_CODE = """\
#include <vector>
using namespace std;
int main() {
    vector<int> v(2000, 7);
    long s = 0;
    for (int i = 0; i < 100000; i++) {
        s += v[i % 2000];
        v[i % 2000] = i;
    }
    return (int)s;
}
"""


@pytest.mark.docker
def test_heavy_state_program_returns_partial_trace():
    """A program whose per-step memory dump is huge (big vector mutated in a
    long loop) used to blow the vgtrace to 100MB+, OOM the postprocessor, and
    surface as a bare TracerTimeout — the learner saw zero steps. It must
    instead return a partial trace whose last point explains the cutoff."""
    result = run_trace(HEAVY_STATE_LOOP_CODE, "cpp")
    assert isinstance(result, Trace)
    assert len(result.trace) >= 10, "expected enough steps to study the loop"
    last = result.trace[-1]
    assert last.event in ("instruction_limit_reached", "infinite_loop_detected")
    assert last.exception_msg


@pytest.mark.docker
def test_member_function_steps_survive():
    """Method frames report the caller's FP, so the postprocessor's
    duplicate-frame_id filter used to drop every step inside a member
    function — breakpoints there could never hit."""
    result = run_trace(MEMBER_FN_CODE, "cpp")
    assert isinstance(result, Trace)
    method_points = [pt for pt in result.trace if "Box::grow" in pt.func_name]
    assert method_points, "no execution points inside Box::grow"
    # body lines (4: v += by, 5: return v) must be steppable
    assert {4, 5} <= {pt.line for pt in method_points}
