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
