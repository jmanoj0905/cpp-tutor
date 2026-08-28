"""The VSCode extension polls this route to decide when the container is ready."""
from fastapi.testclient import TestClient
from app.api import app

client = TestClient(app)


def test_health_returns_ok():
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}
