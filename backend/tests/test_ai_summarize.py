from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient
from google.genai import errors

from app.ai import gemini
from app.config import settings
from app.main import app

ALICE = {"Authorization": "Bearer alice"}
BODY = {"roomName": "team", "messages": [{"sender": "bob", "text": "lunch at noon?"},
                                         {"sender": "carol", "text": "yes, at the canteen"}]}


@pytest.fixture
def client(monkeypatch):
    # With DEV_AUTH a bearer token is just a username, so no account database is needed.
    monkeypatch.setattr(settings, "dev_auth", True)
    return TestClient(app)


@pytest.fixture
def fake_gemini(monkeypatch):
    calls = []

    async def generate(prompt, *, instruction):
        calls.append((prompt, instruction))
        return "Bob and Carol agreed on lunch at the canteen at noon."

    monkeypatch.setattr(gemini, "generate", generate)
    return calls


def test_summarizes_exactly_the_given_messages(client, fake_gemini):
    response = client.post("/api/ai/summarize", json=BODY, headers=ALICE)
    assert response.status_code == 200
    assert response.json() == {"summary": "Bob and Carol agreed on lunch at the canteen at noon."}
    [(prompt, instruction)] = fake_gemini
    assert "Chat Room: team" in prompt
    assert "bob: lunch at noon?\ncarol: yes, at the canteen" in prompt
    assert "not instructions" in instruction


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer"}, {"Authorization": "Basic alice"},
                                     {"Authorization": "Bearer NOT A USER"}])
def test_requires_a_signed_in_user(client, fake_gemini, headers):
    response = client.post("/api/ai/summarize", json=BODY, headers=headers)
    assert response.status_code == 401
    assert response.json()["error"] == "invalid_token"
    assert fake_gemini == []


def line(text="hi", sender="bob"):
    return {"sender": sender, "text": text}


@pytest.mark.parametrize("body", [
    {"roomName": "team", "messages": []},
    {"roomName": "team", "messages": [line()] * 201},
    {"roomName": "team", "messages": [line("x" * 2001)]},
    {"roomName": "team", "messages": [line("")]},
    {"roomName": "team", "messages": [line(sender="")]},
    {"roomName": "", "messages": [line()]},
    {"roomName": "x" * 201, "messages": [line()]},
    {"messages": [line()]},
    {"roomName": "team"},
])
def test_rejects_invalid_requests_without_calling_gemini(client, fake_gemini, body):
    response = client.post("/api/ai/summarize", json=body, headers=ALICE)
    assert response.status_code == 422
    assert response.json()["error"] == "validation_error"
    assert fake_gemini == []


def test_accepts_the_200_message_limit(client, fake_gemini):
    body = {"roomName": "team", "messages": [line(f"m{i}") for i in range(200)]}
    assert client.post("/api/ai/summarize", json=body, headers=ALICE).status_code == 200


def test_ai_errors_use_the_rest_error_shape(client, monkeypatch):
    async def quota(prompt, *, instruction):
        raise gemini.AiError(429, "ai_quota", "The AI quota is used up for now. Try again later.")

    monkeypatch.setattr(gemini, "generate", quota)
    response = client.post("/api/ai/summarize", json=BODY, headers=ALICE)
    assert response.status_code == 429
    assert response.json() == {"error": "ai_quota", "detail": "The AI quota is used up for now. Try again later."}


class FakeModels:
    def __init__(self, result=None, error=None):
        self.result, self.error, self.calls = result, error, []

    async def generate_content(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        return self.result


@pytest.fixture
def models(monkeypatch):
    fake = FakeModels(result=SimpleNamespace(text="  a summary \n"))
    monkeypatch.setattr(gemini, "_client", lambda key: SimpleNamespace(aio=SimpleNamespace(models=fake)))
    monkeypatch.setattr(settings, "gemini_api_key", "test-key")
    monkeypatch.setattr(settings, "gemini_model", "test-model")
    return fake


async def test_generate_uses_the_configured_model_and_instruction(models):
    assert await gemini.generate("prompt", instruction="be brief") == "a summary"
    [call] = models.calls
    assert call["model"] == "test-model"
    assert call["contents"] == "prompt"
    assert call["config"].system_instruction == "be brief"


async def test_missing_key_is_reported_without_a_call(models, monkeypatch):
    monkeypatch.setattr(settings, "gemini_api_key", "")
    with pytest.raises(gemini.AiError) as error:
        await gemini.generate("prompt", instruction="x")
    assert (error.value.status, error.value.code) == (503, "ai_unavailable")
    assert models.calls == []


@pytest.mark.parametrize(("failure", "status", "code"), [
    (errors.ClientError(429, {"error": {"message": "quota"}}), 429, "ai_quota"),
    (errors.ClientError(400, {"error": {"message": "bad"}}), 502, "ai_failed"),
    (errors.ServerError(503, {"error": {"message": "high demand"}}), 503, "ai_busy"),
    (errors.ServerError(500, {"error": {"message": "internal"}}), 502, "ai_failed"),
    (httpx.ConnectError("offline"), 502, "ai_failed"),
    (TimeoutError(), 502, "ai_failed"),
])
async def test_gemini_failures_become_friendly_errors(models, failure, status, code):
    models.error = failure
    with pytest.raises(gemini.AiError) as error:
        await gemini.generate("prompt", instruction="x")
    assert (error.value.status, error.value.code) == (status, code)
    assert "test-key" not in error.value.detail


@pytest.mark.parametrize("text", [None, "", "   "])
async def test_empty_answer_is_a_failure(models, text):
    models.result = SimpleNamespace(text=text)
    with pytest.raises(gemini.AiError) as error:
        await gemini.generate("prompt", instruction="x")
    assert error.value.code == "ai_failed"


def test_client_keeps_sdk_retries_short():
    gemini._client.cache_clear()
    try:
        retry = gemini._client("test-key")._api_client._http_options.retry_options
        assert (retry.attempts, retry.initial_delay, retry.max_delay) == (3, 1, 4)
    finally:
        gemini._client.cache_clear()
