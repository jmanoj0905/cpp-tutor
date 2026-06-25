import pytest
from app.tracer_service import run_trace, TracerTimeout
from app.trace_model import Trace, CompileError

pytestmark = pytest.mark.docker  # requires built image; skip in unit-only CI

def test_run_trace_returns_trace():
    with open("tests/fixtures/pointers.cpp") as f:
        code = f.read()
    result = run_trace(code, "cpp")
    assert isinstance(result, Trace)
    assert len(result.trace) >= 3
    assert any(pt.func_name == "main" for pt in result.trace)

def test_compile_error_is_structured():
    result = run_trace("int main(){ return", "cpp")
    assert isinstance(result, CompileError)
    assert result.message
