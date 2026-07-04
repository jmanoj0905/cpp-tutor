from unittest.mock import patch
from fastapi.testclient import TestClient
from app.api import app
from app.trace_model import Trace, ExecPoint, CompileError
from app.tracer_service import TracerTimeout, TracerError

client = TestClient(app)

def _fake_trace():
    return Trace(code="x", trace=[ExecPoint(line=1, event="step_line", func_name="main")])

def test_trace_ok():
    with patch("app.api.run_trace", return_value=_fake_trace()):
        r = client.post("/api/trace", json={"code": "int main(){}", "lang": "cpp"})
    assert r.status_code == 200
    assert len(r.json()["trace"]) == 1

def test_trace_compile_error():
    with patch("app.api.run_trace", return_value=CompileError(message="expected ;")):
        r = client.post("/api/trace", json={"code": "bad", "lang": "cpp"})
    assert r.status_code == 200
    assert r.json()["status"] == "compile_error"

def test_endpoint_uses_trace_cache():
    """/api/trace must go through the LRU cache, not straight to the tracer."""
    from app import api, trace_cache
    assert api.run_trace is trace_cache.run_trace

def test_trace_response_is_gzipped():
    """Traces are megabytes of repetitive JSON; they must go out gzip-compressed."""
    big = Trace(code="x" * 2000,
                trace=[ExecPoint(line=1, event="step_line", func_name="main")])
    with patch("app.api.run_trace", return_value=big):
        r = client.post("/api/trace",
                        json={"code": "int main(){}", "lang": "cpp"},
                        headers={"Accept-Encoding": "gzip"})
    assert r.status_code == 200
    assert r.headers.get("content-encoding") == "gzip"

def test_trace_timeout():
    with patch("app.api.run_trace", side_effect=TracerTimeout("too slow")):
        r = client.post("/api/trace", json={"code": "while(1){}", "lang": "cpp"})
    assert r.status_code == 503

def test_trace_tracer_error():
    with patch("app.api.run_trace", side_effect=TracerError("docker failed")):
        r = client.post("/api/trace", json={"code": "x", "lang": "c"})
    assert r.status_code == 500
