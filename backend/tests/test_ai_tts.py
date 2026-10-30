import base64
import io
import json
import wave

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.ai import tts
from app.ai.gemini import AiError, ai_error_handler
from app.auth.setup import install_auth
from app.config import settings

ALICE = {"Authorization": "Bearer alice"}


def wav_bytes():
    output = io.BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(24000)
        audio.writeframes(b"\0\0" * 240)
    return output.getvalue()


def audio_body(data=None, mime="audio/wav"):
    return {"steps": [{"type": "model_output", "content": [{
        "type": "audio", "mime_type": mime,
        "data": base64.b64encode(wav_bytes() if data is None else data).decode(),
    }]}]}


@pytest.fixture
def provider(monkeypatch):
    calls = []
    state = {"body": audio_body(), "status": 200, "error": None}

    def handle(request):
        calls.append(request)
        if state["error"]:
            raise state["error"]
        return httpx.Response(state["status"], json=state["body"])

    client_class = httpx.AsyncClient
    monkeypatch.setattr(tts.httpx, "AsyncClient", lambda **kw: client_class(
        transport=httpx.MockTransport(handle), **kw))
    monkeypatch.setattr(settings, "gemini_api_key", "test-key")
    monkeypatch.setattr(settings, "gemini_tts_model", "test-tts")
    return calls, state


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(settings, "dev_auth", True)
    # Keep the feature testable before the shared application wiring lands.
    app = FastAPI()
    install_auth(app)
    app.include_router(tts.router, prefix="/api/ai")
    app.add_exception_handler(AiError, ai_error_handler)
    return TestClient(app)


@pytest.mark.parametrize("text", ["Hello", "สวัสดีครับ", "x" * 2000, "  Hello\nworld  "])
def test_returns_playable_wav_and_sends_verbatim_text(client, provider, text):
    calls, _ = provider
    response = client.post("/api/ai/tts", headers=ALICE, json={"text": text})
    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/wav"
    assert response.headers["cache-control"] == "no-store"
    assert response.content == wav_bytes()
    [request] = calls
    assert request.headers["x-goog-api-key"] == "test-key"
    body = json.loads(request.content)
    assert body["model"] == "test-tts"
    assert body["input"][0]["content"] == [{"type": "text", "text": text}]
    assert body["store"] is False
    assert body["response_format"] == {"type": "audio"}


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer garbage!"}])
def test_auth_before_provider(client, provider, headers):
    assert client.post("/api/ai/tts", headers=headers, json={"text": "hi"}).status_code == 401
    assert provider[0] == []


@pytest.mark.parametrize("body", [{}, {"text": ""}, {"text": " \n\t"}, {"text": "x" * 2001},
                                 {"text": None}, {"text": 42}])
def test_validates_input_without_provider_call(client, provider, body):
    response = client.post("/api/ai/tts", headers=ALICE, json=body)
    assert response.status_code == 422
    assert response.json()["error"] == "validation_error"
    assert provider[0] == []


def test_missing_key(client, provider, monkeypatch):
    monkeypatch.setattr(settings, "gemini_api_key", "")
    response = client.post("/api/ai/tts", headers=ALICE, json={"text": "hi"})
    assert (response.status_code, response.json()["error"]) == (503, "ai_unavailable")
    assert provider[0] == []


@pytest.mark.parametrize(("status", "code"), [(429, "ai_quota"), (503, "ai_busy"),
                                            (400, "ai_failed"), (500, "ai_failed")])
def test_friendly_provider_status_errors(client, provider, status, code):
    provider[1].update(status=status, body={"error": "private provider details test-key"})
    response = client.post("/api/ai/tts", headers=ALICE, json={"text": "hi"})
    assert response.status_code == (status if status in (429, 503) else 502)
    assert response.json()["error"] == code
    assert "test-key" not in response.text


@pytest.mark.parametrize("error", [httpx.ConnectError("offline"), httpx.ReadTimeout("timeout"),
                                 TimeoutError()])
def test_network_and_timeout_failures(client, provider, error):
    provider[1]["error"] = error
    response = client.post("/api/ai/tts", headers=ALICE, json={"text": "hi"})
    assert (response.status_code, response.json()["error"]) == (502, "ai_failed")


@pytest.mark.parametrize("body", [
    {}, None, {"steps": None}, {"steps": [{"type": "model_output", "content": None}]},
    audio_body(b""), audio_body(b"not a wav"), audio_body(wav_bytes()[:-2]),
    audio_body(mime="audio/mp3"),
    {"steps": [{"type": "model_output", "content": [{"type": "audio", "data": "%%%"}]}]},
])
def test_missing_or_malformed_audio_is_a_friendly_error(client, provider, body):
    provider[1]["body"] = body
    response = client.post("/api/ai/tts", headers=ALICE, json={"text": "hi"})
    assert (response.status_code, response.json()["error"]) == (502, "ai_failed")
