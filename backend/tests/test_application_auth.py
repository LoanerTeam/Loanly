import pytest
from fastapi.testclient import TestClient
from mongomock_motor import AsyncMongoMockClient
from pymongo.errors import DuplicateKeyError

from app.auth import repo
from app.auth.setup import initialize_auth
from app.chat import presence
from app.config import settings
from app.main import app


@pytest.fixture
def application_db(monkeypatch):
    db = AsyncMongoMockClient()["loanly_test_application"]
    monkeypatch.setattr(repo, "get_db", lambda: db)
    monkeypatch.setattr(presence, "get_db", lambda: db)
    monkeypatch.setattr("app.main.initialize_auth", initialize_auth)
    monkeypatch.setattr(settings, "dev_auth", False)
    monkeypatch.setattr(settings, "jwt_secret", "application-test-key-with-at-least-32-bytes")
    return db


def test_application_mounts_auth_before_frontend_and_initializes_users(application_db):
    with TestClient(app) as client:
        response = client.post("/api/auth/register", json={
            "username": "alice", "password": "correct password",
        })
        assert response.status_code == 201
        assert response.headers["Cache-Control"] == "no-store"
        token = response.json()["token"]
        headers = {"Authorization": f"Bearer {token}"}
        assert client.get("/api/me", headers=headers).json() == {"username": "alice", "targetLang": "en"}
        assert client.put("/api/me", json={"targetLang": "th"}, headers=headers).json()["targetLang"] == "th"
        assert client.post("/api/auth/register", json={
            "username": "alice", "password": "correct password",
        }).status_code == 409
        assert client.get("/api/me").status_code == 401
        with client.websocket_connect(f"/ws?token={token}") as ws:
            assert ws.receive_json()["me"] == "alice"


def test_application_rejects_missing_secret_at_startup(application_db, monkeypatch):
    monkeypatch.setattr(settings, "jwt_secret", "")
    with pytest.raises(RuntimeError, match="JWT_SECRET"), TestClient(app):
        pass


async def test_application_rejects_existing_duplicate_users_at_startup(application_db):
    await application_db.users.insert_many([{"username": "alice"}, {"username": "alice"}])
    with pytest.raises(DuplicateKeyError), TestClient(app):
        pass
