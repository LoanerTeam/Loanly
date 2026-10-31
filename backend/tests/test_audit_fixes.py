import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from mongomock_motor import AsyncMongoMockClient

from app.ai import gemini, limits
from app.ai.gemini import AiError
from app.auth import repo as auth_repo
from app.auth import router
from app.chat import presence
from app.config import settings
from app.main import app, hide_token

ALICE = {"Authorization": "Bearer alice"}
BOB = {"Authorization": "Bearer bob"}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(settings, "dev_auth", True)
    return TestClient(app)


@pytest.fixture
def model(monkeypatch):
    generate = AsyncMock(return_value=SimpleNamespace(text="a summary"))
    monkeypatch.setattr(settings, "gemini_api_key", "test-key")
    monkeypatch.setattr(gemini, "_client", lambda key: SimpleNamespace(
        aio=SimpleNamespace(models=SimpleNamespace(generate_content=generate))))
    return generate


def summarize(client, headers=ALICE):
    return client.post("/api/ai/summarize", headers=headers, json={
        "roomName": "Room", "messages": [{"sender": "bob", "text": "hi"}]})


def test_requests_per_minute_stop_before_calling_gemini(client, model, monkeypatch):
    monkeypatch.setattr(settings, "ai_text_rpm", 2)
    assert [summarize(client).status_code for _ in range(3)] == [200, 200, 429]
    assert model.await_count == 2


def test_one_user_gets_at_most_a_quarter_of_the_daily_limit(client, model, monkeypatch):
    monkeypatch.setattr(settings, "ai_text_rpd", 8)
    assert [summarize(client).status_code for _ in range(3)] == [200, 200, 429]
    assert summarize(client, BOB).status_code == 200


def test_daily_limit_is_shared_and_resets_on_a_new_day(monkeypatch):
    monkeypatch.setattr(settings, "ai_tts_rpd", 2)
    limits.take("tts", "alice")
    limits.take("tts", "bob")
    with pytest.raises(AiError) as error:
        limits.take("tts", "carol")
    assert error.value.status == 429
    monkeypatch.setattr(limits, "_day", None)  # as if the Pacific date changed
    limits.take("tts", "carol")


def test_stt_without_content_length_is_rejected_before_reading(client):
    response = client.post("/api/ai/stt", headers={**ALICE, "Content-Length": ""}, content=b"")
    assert response.status_code == 413


def test_websocket_token_is_masked_in_uvicorn_logs():
    record = logging.LogRecord("uvicorn.error", logging.INFO, "", 0, '%s - "WebSocket %s" [accepted]',
                               ("1.2.3.4:5", "/ws?token=secret.jwt.value&x=1"), None)
    hide_token(record)
    assert "secret" not in record.getMessage()
    assert "/ws?token=***&x=1" in record.getMessage()


def test_repeated_failed_logins_are_blocked_without_hashing(monkeypatch):
    monkeypatch.setattr(settings, "dev_auth", False)
    monkeypatch.setattr(settings, "jwt_secret", "test-only-signing-key-with-at-least-32-bytes")
    monkeypatch.setattr(auth_repo, "get_db", lambda: AsyncMongoMockClient()["loanly_test_limit"])
    client = TestClient(app)
    body = {"username": "alice", "password": "wrong password"}
    codes = [client.post("/api/auth/login", json=body).status_code
             for _ in range(router.MAX_FAILURES + 1)]
    assert codes == [401] * router.MAX_FAILURES + [429]
    assert client.post("/api/auth/login", json={**body, "username": "bob"}).status_code == 401


async def test_dm_target_lookup_reads_one_user(monkeypatch):
    monkeypatch.setattr(settings, "dev_auth", False)
    db = AsyncMongoMockClient()["loanly_test_dm"]
    await db.users.insert_one({"username": "bob"})
    monkeypatch.setattr(presence, "get_db", lambda: db)
    assert await presence.user_exists("bob")
    assert not await presence.user_exists("ghost")
