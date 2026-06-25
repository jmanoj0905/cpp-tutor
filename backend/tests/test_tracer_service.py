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
