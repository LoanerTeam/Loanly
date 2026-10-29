import asyncio
import json
from datetime import UTC, datetime, timedelta

import jwt
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from mongomock_motor import AsyncMongoMockClient
from starlette.websockets import WebSocketDisconnect

from app.auth import repo, security
from app.auth.errors import AuthError
from app.auth.setup import initialize_auth, install_auth
from app.chat import presence
from app.chat.ws import router as ws_router
from app.config import settings
from app.deps import verify_token


@pytest.fixture
def auth_config(monkeypatch):
    monkeypatch.setattr(settings, "dev_auth", False)
    monkeypatch.setattr(settings, "jwt_secret", "test-only-signing-key-with-at-least-32-bytes")


@pytest.fixture
def auth_db(monkeypatch, auth_config):
    db = AsyncMongoMockClient()["loanly_test_auth"]
    monkeypatch.setattr(repo, "get_db", lambda: db)
    monkeypatch.setattr(presence, "get_db", lambda: db)
    return db


@pytest.fixture
def auth_client(auth_db):
    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def lifespan(app):
        await initialize_auth()
        yield

    app = FastAPI(lifespan=lifespan)
    install_auth(app)
    app.include_router(ws_router)
    with TestClient(app) as client:
        yield client


def register(client, username="alice", password="correct password"):
    return client.post("/api/auth/register", json={"username": username, "password": password})


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


async def test_register_persists_only_hash_and_login_restores_profile(auth_client, auth_db):
    response = register(auth_client)
    assert response.status_code == 201
    assert set(response.json()) == {"token"}
    token = response.json()["token"]
    assert verify_token(token) == "alice"
    stored = await auth_db.users.find_one({"username": "alice"})
    assert "password" not in stored
    assert stored["passwordHash"] != "correct password"
    assert security.check_password("correct password", stored["passwordHash"])
    assert auth_client.get("/api/me", headers=bearer(token)).json() == {
        "username": "alice", "targetLang": "en",
    }
    login = auth_client.post("/api/auth/login", json={
        "username": "alice", "password": "correct password",
    })
    assert login.status_code == 200
    assert verify_token(login.json()["token"]) == "alice"


def test_duplicate_username_and_wrong_credentials(auth_client):
    register(auth_client)
    duplicate = register(auth_client)
    assert duplicate.status_code == 409
    assert duplicate.json()["error"] == "name_taken"
    errors = [auth_client.post("/api/auth/login", json={
        "username": name, "password": "wrong password",
    }) for name in ("alice", "unknown")]
    assert all(response.status_code == 401 for response in errors)
    assert errors[0].json() == errors[1].json() == {
        "error": "invalid_credentials", "detail": "Incorrect Username or Password.",
    }


@pytest.mark.parametrize("body", [
    {}, {"username": "aa", "password": "secret123"},
    {"username": "a" * 21, "password": "secret123"},
    {"username": "Alice", "password": "secret123"},
    {"username": "alice\n", "password": "secret123"},
    {"username": {"$ne": None}, "password": "secret123"},
    {"username": "alice", "password": "short"},
    {"username": "alice", "password": 12345678},
    {"username": "alice", "password": "\ud800secret123"},
])
def test_validation_follows_error_shape_without_echoing_password(auth_client, body):
    response = auth_client.post("/api/auth/register", content=json.dumps(body),
                                headers={"Content-Type": "application/json"})
    assert response.status_code == 422
    assert set(response.json()) == {"error", "detail"}
    assert response.json()["error"] == "validation_error"
    assert "secret123" not in response.text


def test_malformed_json_is_a_contract_error(auth_client):
    response = auth_client.post("/api/auth/register", content="{", headers={
        "Content-Type": "application/json",
    })
    assert response.status_code == 422
    assert response.json()["error"] == "validation_error"


@pytest.mark.parametrize("header", [None, "", "garbage", "Basic alice", "Bearer", "Bearer ",
                                          "Bearer garbage", "Bearer alice", "Bearer  alice"])
def test_me_requires_valid_bearer_header(auth_client, header):
    headers = {} if header is None else {"Authorization": header}
    for method in ("get", "put"):
        response = getattr(auth_client, method)("/api/me", headers=headers,
                   **({"json": {"targetLang": "th"}} if method == "put" else {}))
        assert response.status_code == 401
        assert response.json()["error"] == "invalid_token"
        assert response.headers["WWW-Authenticate"] == "Bearer"


def test_profile_language_is_persisted_and_only_updates_caller(auth_client):
    alice = register(auth_client).json()["token"]
    bob = register(auth_client, "bob").json()["token"]
    response = auth_client.put("/api/me", json={"targetLang": "th", "username": "bob"},
                               headers=bearer(alice))
    assert response.json() == {"username": "alice", "targetLang": "th"}
    assert auth_client.get("/api/me", headers=bearer(alice)).json()["targetLang"] == "th"
    assert auth_client.get("/api/me", headers=bearer(bob)).json()["targetLang"] == "en"
    invalid = auth_client.put("/api/me", json={"targetLang": "invalid"}, headers=bearer(alice))
    assert invalid.status_code == 422
    assert auth_client.get("/api/me", headers=bearer(alice)).json()["targetLang"] == "th"


def test_signed_token_for_missing_account_cannot_read_profile(auth_client):
    token = security.issue_token("ghost")
    assert auth_client.get("/api/me", headers=bearer(token)).status_code == 401


def test_real_jwt_connects_and_registration_announces_presence(auth_client):
    token = register(auth_client).json()["token"]
    with auth_client.websocket_connect(f"/ws?token={token}") as alice:
        snapshot = alice.receive_json()
        assert snapshot["type"] == "init"
        assert snapshot["me"] == "alice"
        assert snapshot["users"] == [{"username": "alice", "online": True}]
        assert alice.receive_json()["type"] == "presence"
        bob = register(auth_client, "bob").json()["token"]
        assert alice.receive_json() == {"type": "presence", "username": "bob", "online": False}
        with auth_client.websocket_connect(f"/ws?token={bob}") as bob_ws:
            assert bob_ws.receive_json()["me"] == "bob"
            assert alice.receive_json() == {"type": "presence", "username": "bob", "online": True}


@pytest.mark.parametrize("change", [
    {"exp": 1}, {"sub": "Invalid"}, {"sub": 123}, {"sub": "alice\n"},
    {"iat": 9999999999}, {"exp": None},
])
def test_invalid_claims_rejected_for_rest_and_ws(auth_client, change):
    now = datetime.now(UTC)
    claims = {"sub": "alice", "iat": now, "exp": now + timedelta(hours=1), **change}
    token = jwt.encode(claims, settings.jwt_secret, algorithm="HS256")
    assert auth_client.get("/api/me", headers=bearer(token)).status_code == 401
    with auth_client.websocket_connect(f"/ws?token={token}") as ws:
        with pytest.raises(WebSocketDisconnect) as error:
            ws.receive_json()
        assert error.value.code == 4401


def test_signature_algorithm_required_claims_and_dev_fallback(auth_config, monkeypatch):
    token = security.issue_token("alice")
    assert verify_token(token) == "alice"
    claims = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    assert claims["exp"] - claims["iat"] == 3600
    for field in ("exp", "iat", "sub"):
        incomplete = {key: value for key, value in claims.items() if key != field}
        assert verify_token(jwt.encode(incomplete, settings.jwt_secret, algorithm="HS256")) is None
    assert verify_token(jwt.encode(claims, "another-test-key-with-at-least-32-bytes")) is None
    assert verify_token(jwt.encode(claims, "x" * 48, algorithm="HS384")) is None
    assert verify_token(jwt.encode(claims, "", algorithm="none")) is None
    assert verify_token("alice") is None
    monkeypatch.setattr(settings, "dev_auth", True)
    assert verify_token("alice") == "alice"
    assert verify_token(token) == "alice"  # Real JWTs still work in dev mode.
    assert verify_token("invalid username") is None


def test_long_unicode_passwords_are_not_truncated(auth_client):
    password = "ก" * 80 + "🌻"
    assert register(auth_client, password=password).status_code == 201
    assert auth_client.post("/api/auth/login", json={
        "username": "alice", "password": password,
    }).status_code == 200
    assert auth_client.post("/api/auth/login", json={
        "username": "alice", "password": password[:-1] + "x",
    }).status_code == 401


async def test_unique_index_handles_concurrent_registration(auth_db):
    await repo.ensure_indexes()
    await repo.ensure_indexes()
    results = await asyncio.gather(repo.create_user("alice", "hash"), repo.create_user("alice", "hash"),
                                   return_exceptions=True)
    assert sum(result is None for result in results) == 1
    assert sum(isinstance(result, AuthError) and result.code == "name_taken"
               for result in results) == 1
    assert await auth_db.users.count_documents({}) == 1


@pytest.mark.parametrize("secret", ["", "change-me", "short"])
def test_real_auth_rejects_unconfigured_secret(auth_config, monkeypatch, secret):
    monkeypatch.setattr(settings, "jwt_secret", secret)
    with pytest.raises(RuntimeError, match="JWT_SECRET"):
        security.validate_config()
