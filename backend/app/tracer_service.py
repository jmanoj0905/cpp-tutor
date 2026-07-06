import json
import os
import subprocess
import threading
from app import local_tracer
from app.trace_model import Trace, CompileError, parse_trace


class TracerError(Exception):
    pass


class TracerTimeout(TracerError):
    pass


_LIMIT_FLAGS = [
    "--net=none", "--cap-drop", "all", "--user=netuser",
    "--memory=256m", "--cpus=1", "--pids-limit=128",
]

_TRACER_ARGV = ["python", "/opt/tracer/run_cpp_backend.py"]

WARM_CONTAINER = "cpp-tutor-tracer-warm"

# Execs share the warm container's /opt/tracer/usercode.* scratch files, so
# requests are serialized. Tracing was already effectively serial (1 CPU).
_warm_lock = threading.Lock()

# The warm container lives only while someone is actively tracing: each
# request re-arms this timer, and IDLE_TTL_SECONDS without a request reaps
# the container. The next request cold-starts a fresh one.
IDLE_TTL_SECONDS = 35 * 60
_reap_timer: threading.Timer | None = None


def _arm_reap_timer() -> None:
    global _reap_timer
    if _reap_timer is not None:
        _reap_timer.cancel()
    t = threading.Timer(IDLE_TTL_SECONDS, shutdown_pool)
    t.daemon = True
    t.start()
    _reap_timer = t


def _docker_cmd(code: str, lang: str, image: str) -> list[str]:
    return [
        "docker", "run", "--rm", "-i", *_LIMIT_FLAGS, image,
        *_TRACER_ARGV, code, lang, "--jsondump",
    ]


def _docker(*args: str, timeout: int | None = None):
    return subprocess.run(["docker", *args], capture_output=True,
                          text=True, timeout=timeout)


def _warm_running() -> bool:
    proc = _docker("inspect", "-f", "{{.State.Running}}", WARM_CONTAINER)
    return proc.returncode == 0 and proc.stdout.strip() == "true"


def _start_warm(image: str) -> bool:
    _docker("rm", "-f", WARM_CONTAINER)
    proc = _docker("run", "-d", "--name", WARM_CONTAINER, *_LIMIT_FLAGS,
                   image, "sleep", "infinity")
    return proc.returncode == 0


def shutdown_pool() -> None:
    global _reap_timer
    if _reap_timer is not None:
        _reap_timer.cancel()
        _reap_timer = None
    with _warm_lock:  # never yank the container out from under a live exec
        try:
            _docker("rm", "-f", WARM_CONTAINER)
        except Exception:
            pass


def _run_tracer(code: str, lang: str, image: str, timeout: int):
    """Exec inside the warm container; fall back to a cold `docker run --rm`
    when the warm path is unavailable."""
    with _warm_lock:
        if _warm_running() or _start_warm(image):
            try:
                proc = _docker("exec", "-i", WARM_CONTAINER,
                               *_TRACER_ARGV, code, lang, "--jsondump",
                               timeout=timeout)
            except subprocess.TimeoutExpired:
                # The guest process outlives the exec — remove the container
                # so it can't keep burning CPU; next request starts a fresh one.
                _docker("rm", "-f", WARM_CONTAINER)
                raise
            if proc.returncode == 0 or _warm_running():
                _arm_reap_timer()
                return proc
            # container died mid-exec — fall through to a cold run
    return subprocess.run(_docker_cmd(code, lang, image),
                          capture_output=True, text=True, timeout=timeout)


def run_trace(code: str, lang: str,
              image: str = "cpp-tutor-tracer:dev",
              timeout: int = 60) -> Trace | CompileError:
    if lang not in ("c", "cpp"):
        raise TracerError(f"unsupported lang: {lang}")
    try:
        if os.environ.get("CPP_TUTOR_TRACER", "docker") == "local":
            proc = local_tracer.run_local(code, lang, timeout)
        else:
            proc = _run_tracer(code, lang, image, timeout)
    except subprocess.TimeoutExpired as e:
        raise TracerTimeout("tracer exceeded time limit") from e

    out = proc.stdout.strip()
    try:
        raw = json.loads(out)
    except json.JSONDecodeError as e:
        raise TracerError(
            f"tracer produced non-JSON output (exit {proc.returncode}): "
            f"{out[:200] or '(empty stdout)'} | stderr: {proc.stderr[:200]}"
        ) from e

    # The OPT backend reports a compile error as a single-point trace whose
    # event is "uncaught_exception" with the compiler message in exception_msg.
    tr = raw.get("trace", [])
    if len(tr) == 1 and tr[0].get("event") == "uncaught_exception" \
            and "exception_msg" in tr[0]:
        return CompileError(message=tr[0]["exception_msg"],
                            line=tr[0].get("line"))
    return parse_trace(raw)
