import signal
import subprocess
import pytest
from unittest.mock import patch, MagicMock
from app import local_tracer

# No test drives a real subprocess: the runner is exercised through a fake
# Popen so the suite passes on machines without /opt/tracer.


def _popen(returncode=0, stdout="{}", stderr=""):
    p = MagicMock()
    p.pid = 4242
    p.returncode = returncode
    p.communicate.return_value = (stdout, stderr)
    return p


def test_runs_tracer_script_in_process():
    fake = _popen(stdout='{"code": "x", "trace": []}')
    with patch("app.local_tracer.subprocess.Popen", return_value=fake) as popen:
        proc = local_tracer.run_local("int main(){}", "cpp", timeout=60)

    argv = popen.call_args.args[0]
    assert argv[0] == "python"
    assert argv[1] == local_tracer.TRACER_SCRIPT
    assert argv[2:] == ["int main(){}", "cpp", "--jsondump"]

    kwargs = popen.call_args.kwargs
    assert kwargs["cwd"] == "/opt/tracer"
    assert kwargs["start_new_session"] is True
    assert kwargs["preexec_fn"] is local_tracer._apply_rlimits
    assert kwargs["text"] is True

    assert proc.returncode == 0
    assert proc.stdout == '{"code": "x", "trace": []}'
    assert proc.stderr == ""


def test_timeout_kills_process_group_and_reraises():
    fake = _popen()
    fake.communicate.side_effect = subprocess.TimeoutExpired(cmd="tracer", timeout=60)
    with patch("app.local_tracer.subprocess.Popen", return_value=fake), \
         patch("app.local_tracer.os.killpg") as killpg:
        with pytest.raises(subprocess.TimeoutExpired):
            local_tracer.run_local("int main(){for(;;);}", "cpp", timeout=60)
    killpg.assert_called_once_with(4242, signal.SIGKILL)
    fake.wait.assert_called_once()


def test_cpu_rlimit_sits_below_backend_timeout():
    """The CPU rlimit is the in-container replacement for docker --cpus/timeout;
    it must trip before the 60s wrapper timeout so callers get tracer output,
    not a wrapper kill."""
    assert local_tracer.RLIMIT_CPU_SECONDS < 60
