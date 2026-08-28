"""A bundled VSCode webview's Origin is vscode-webview://<uuid> with a fresh
uuid per panel, so the exact-match allow-list can never cover it. The extension
launches the container with CPP_TUTOR_CORS_ORIGIN_REGEX instead. Config happens
at import time, so these tests reload app.api around each scenario."""
import importlib
from fastapi.testclient import TestClient


def _reload_api():
    import app.api
    return importlib.reload(app.api)


def _preflight(client, origin):
    return client.options(
        "/api/trace",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )


def test_regex_admits_any_webview_uuid(monkeypatch):
    monkeypatch.setenv("CPP_TUTOR_CORS_ORIGIN_REGEX", "^vscode-webview://.*")
    api = _reload_api()
    try:
        client = TestClient(api.app)
        for uuid in ("aaaa-1111", "bbbb-2222"):
            r = _preflight(client, f"vscode-webview://{uuid}")
            assert r.status_code == 200
            assert r.headers["access-control-allow-origin"] == f"vscode-webview://{uuid}"
    finally:
        monkeypatch.delenv("CPP_TUTOR_CORS_ORIGIN_REGEX")
        _reload_api()


def test_regex_rejects_other_origins(monkeypatch):
    monkeypatch.setenv("CPP_TUTOR_CORS_ORIGIN_REGEX", "^vscode-webview://.*")
    api = _reload_api()
    try:
        r = _preflight(TestClient(api.app), "https://evil.example")
        assert "access-control-allow-origin" not in r.headers
    finally:
        monkeypatch.delenv("CPP_TUTOR_CORS_ORIGIN_REGEX")
        _reload_api()


def test_unset_regex_leaves_existing_allow_list_behaviour(monkeypatch):
    monkeypatch.delenv("CPP_TUTOR_CORS_ORIGIN_REGEX", raising=False)
    api = _reload_api()
    client = TestClient(api.app)
    ok = _preflight(client, "http://localhost:5173")
    assert ok.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert "access-control-allow-origin" not in _preflight(client, "vscode-webview://x").headers


def test_regex_is_not_widened(monkeypatch):
    """Regression guard: the configured regex must reach CORSMiddleware
    verbatim, with no trailing wildcard appended on the operator's behalf. A
    silently widened pattern is an origin-confusion hole — appending '.*' to
    'https://app\\.example\\.com' would also admit
    'https://app.example.com.evil.io', which is a real deployer-supplied
    pattern on a publicly deployed backend, not a hypothetical."""
    monkeypatch.setenv("CPP_TUTOR_CORS_ORIGIN_REGEX", r"https://app\.example\.com")
    api = _reload_api()
    try:
        client = TestClient(api.app)
        ok = _preflight(client, "https://app.example.com")
        assert ok.headers["access-control-allow-origin"] == "https://app.example.com"
        spoofed = _preflight(client, "https://app.example.com.evil.io")
        assert "access-control-allow-origin" not in spoofed.headers
    finally:
        monkeypatch.delenv("CPP_TUTOR_CORS_ORIGIN_REGEX")
        _reload_api()
