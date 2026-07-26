"""In-process tracer execution for the all-in-one container image.

Inside the published image there is no Docker; the OPT tracer lives at
/opt/tracer and is run directly. Per-request container isolation is replaced
by process-level limits (rlimits + the caller's timeout); the whole server
already runs as netuser. Requests are serialized because the tracer writes
shared /opt/tracer/usercode.* scratch files.
"""
import os
import resource
import signal
import subprocess
import threading

TRACER_SCRIPT = "/opt/tracer/run_cpp_backend.py"

RLIMIT_CPU_SECONDS = 115       # below the 120s wrapper timeout
RLIMIT_AS_BYTES = 4 * 1024**3  # generous: valgrind reserves large VA ranges

# NB: RLIMIT_NPROC is deliberately NOT set. It caps processes per real UID
# *system-wide*, not per container. On a shared host (e.g. Render) where the
# container's uid maps onto a host uid that already owns many processes, even
# a generous cap is instantly exceeded and the very first compiler fork dies
# with EAGAIN. Process-count containment is the host's cgroup pids-limit job,
# not ours; here we rely on RLIMIT_CPU + RLIMIT_AS + the caller's timeout.

_local_lock = threading.Lock()


def _apply_rlimits() -> None:
    resource.setrlimit(resource.RLIMIT_CPU, (RLIMIT_CPU_SECONDS, RLIMIT_CPU_SECONDS))
    resource.setrlimit(resource.RLIMIT_AS, (RLIMIT_AS_BYTES, RLIMIT_AS_BYTES))


def run_local(code: str, lang: str, timeout: int) -> subprocess.CompletedProcess:
    """Run the tracer directly; same argv/stdout contract as the docker path.
    Raises subprocess.TimeoutExpired after killing the whole process group."""
    with _local_lock:
        proc = subprocess.Popen(
            ["python", TRACER_SCRIPT, code, lang, "--jsondump"],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            cwd="/opt/tracer", start_new_session=True,
            preexec_fn=_apply_rlimits,
        )
        try:
            out, err = proc.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            # start_new_session=True made the child a process-group leader,
            # so this kills the compiler/valgrind tree too, not just python.
            os.killpg(proc.pid, signal.SIGKILL)
            proc.wait()
            raise
        return subprocess.CompletedProcess(proc.args, proc.returncode, out, err)
