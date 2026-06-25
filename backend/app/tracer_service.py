import json
import subprocess
from app.trace_model import Trace, CompileError, parse_trace


class TracerError(Exception):
    pass


class TracerTimeout(TracerError):
    pass


def _docker_cmd(code: str, lang: str, image: str) -> list[str]:
    return [
        "docker", "run", "--rm", "-i",
        "--net=none", "--cap-drop", "all", "--user=netuser",
        "--memory=256m", "--cpus=1", "--pids-limit=128",
        image,
        "python", "/opt/tracer/run_cpp_backend.py", code, lang, "--jsondump",
    ]


def run_trace(code: str, lang: str,
              image: str = "cpp-tutor-tracer:dev",
              timeout: int = 15) -> Trace | CompileError:
    if lang not in ("c", "cpp"):
        raise TracerError(f"unsupported lang: {lang}")
    try:
        proc = subprocess.run(
            _docker_cmd(code, lang, image),
            capture_output=True, text=True, timeout=timeout,
        )
    except subprocess.TimeoutExpired as e:
        raise TracerTimeout("tracer exceeded time limit") from e

    out = proc.stdout.strip()
    try:
        raw = json.loads(out)
    except json.JSONDecodeError as e:
        raise TracerError(f"tracer produced non-JSON output: {out[:200]}") from e

    # The OPT backend reports a compile error as a single-point trace whose
    # event is "uncaught_exception" with the compiler message in exception_msg.
    tr = raw.get("trace", [])
    if len(tr) == 1 and tr[0].get("event") == "uncaught_exception" \
            and "exception_msg" in tr[0]:
        return CompileError(message=tr[0]["exception_msg"],
                            line=tr[0].get("line"))
    return parse_trace(raw)
