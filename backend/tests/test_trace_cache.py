import pytest
from unittest.mock import patch
from app import trace_cache
from app.trace_model import Trace, ExecPoint, CompileError
from app.tracer_service import TracerTimeout


@pytest.fixture(autouse=True)
def fresh_cache():
    trace_cache.clear()
    yield
    trace_cache.clear()


def _trace(code: str) -> Trace:
    return Trace(code=code,
                 trace=[ExecPoint(line=1, event="step_line", func_name="main")])


def test_identical_request_hits_cache():
    calls = []

    def fake(code, lang, **kw):
        calls.append((code, lang))
        return _trace(code)

    with patch("app.trace_cache.tracer_service.run_trace", side_effect=fake):
        first = trace_cache.run_trace("int main(){}", "cpp")
        second = trace_cache.run_trace("int main(){}", "cpp")

    assert len(calls) == 1
    assert first is second


def test_different_code_or_lang_misses_cache():
    calls = []

    def fake(code, lang, **kw):
        calls.append((code, lang))
        return _trace(code)

    with patch("app.trace_cache.tracer_service.run_trace", side_effect=fake):
        trace_cache.run_trace("int main(){}", "cpp")
        trace_cache.run_trace("int main(){return 1;}", "cpp")
        trace_cache.run_trace("int main(){}", "c")

    assert len(calls) == 3


def test_compile_errors_are_cached():
    calls = []

    def fake(code, lang, **kw):
        calls.append(code)
        return CompileError(message="expected ;")

    with patch("app.trace_cache.tracer_service.run_trace", side_effect=fake):
        trace_cache.run_trace("bad", "cpp")
        result = trace_cache.run_trace("bad", "cpp")

    assert len(calls) == 1
    assert isinstance(result, CompileError)


def test_errors_are_not_cached():
    """A timeout may be transient (load spike) — the next identical request
    must reach the tracer again."""
    fake = patch("app.trace_cache.tracer_service.run_trace",
                 side_effect=[TracerTimeout("slow"), _trace("x")])
    with fake:
        with pytest.raises(TracerTimeout):
            trace_cache.run_trace("x", "cpp")
        result = trace_cache.run_trace("x", "cpp")
    assert isinstance(result, Trace)


def test_lru_eviction(monkeypatch):
    monkeypatch.setattr(trace_cache, "MAX_ENTRIES", 2)
    calls = []

    def fake(code, lang, **kw):
        calls.append(code)
        return _trace(code)

    with patch("app.trace_cache.tracer_service.run_trace", side_effect=fake):
        trace_cache.run_trace("a", "cpp")
        trace_cache.run_trace("b", "cpp")
        trace_cache.run_trace("c", "cpp")   # evicts "a"
        trace_cache.run_trace("a", "cpp")   # must re-run tracer

    assert calls == ["a", "b", "c", "a"]
