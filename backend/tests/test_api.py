from unittest.mock import patch
from fastapi.testclient import TestClient
from app.api import app
from app.trace_model import Trace, ExecPoint, CompileError
from app.tracer_service import TracerTimeout

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

def test_trace_timeout():
    with patch("app.api.run_trace", side_effect=TracerTimeout("too slow")):
        r = client.post("/api/trace", json={"code": "while(1){}", "lang": "cpp"})
    assert r.status_code == 503
