"""The all-in-one container serves the built frontend from the backend
process (CPP_TUTOR_STATIC). The mount happens at import time, so these tests
reload app.api around each scenario."""
import importlib
from fastapi.testclient import TestClient


def _reload_api():
    import app.api
    return importlib.reload(app.api)


def test_serves_index_when_static_dir_configured(tmp_path, monkeypatch):
    (tmp_path / "index.html").write_text('<html><div id="root"></div></html>')
    monkeypatch.setenv("CPP_TUTOR_STATIC", str(tmp_path))
    api = _reload_api()
    try:
        client = TestClient(api.app)
        r = client.get("/")
        assert r.status_code == 200
        assert 'id="root"' in r.text
        # API routes must still win over the "/" static mount.
        r2 = client.post("/api/trace", json={"code": "", "lang": "zzz"})
        assert r2.status_code == 422
    finally:
        monkeypatch.delenv("CPP_TUTOR_STATIC")
        _reload_api()


def test_missing_static_dir_is_ignored(tmp_path, monkeypatch):
    monkeypatch.setenv("CPP_TUTOR_STATIC", str(tmp_path / "nope"))
    api = _reload_api()
    try:
        assert TestClient(api.app).get("/").status_code == 404
    finally:
        monkeypatch.delenv("CPP_TUTOR_STATIC")
        _reload_api()


def test_no_static_mount_by_default(monkeypatch):
    monkeypatch.delenv("CPP_TUTOR_STATIC", raising=False)
    api = _reload_api()
    assert TestClient(api.app).get("/").status_code == 404
