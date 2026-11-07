from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from google.genai import errors

from app.ai import gemini, stt
from app.config import settings
from app.main import app

HEADERS = {"Authorization": "Bearer alice"}
WEBM = b"\x1a\x45\xdf\xa3" + b"\x00" * 64
OGG = b"OggS" + b"\x00" * 64
WAV = b"RIFF\x00\x00\x00\x00WAVE" + b"\x00" * 64
MP4 = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 64


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(settings, "dev_auth", True)
    return TestClient(app)


@pytest.fixture
def model(monkeypatch):
    generate = AsyncMock(return_value=SimpleNamespace(text=" hello there \n"))
    monkeypatch.setattr(settings, "gemini_api_key", "test-key")
    monkeypatch.setattr(gemini, "_client", lambda key: SimpleNamespace(
        aio=SimpleNamespace(models=SimpleNamespace(generate_content=generate))))
    return generate


def upload(client, data, mime="audio/webm", headers=HEADERS):
    return client.post("/api/ai/stt", headers=headers, files={"audio": ("clip", data, mime)})


@pytest.mark.parametrize(("data", "mime"), [
    (WEBM, "audio/webm"), (WEBM, "audio/webm;codecs=opus"), (OGG, "audio/ogg"),
    (WAV, "audio/wav"), (WAV, "audio/x-wav"), (MP4, "audio/mp4"),
])
def test_transcribes_supported_recordings_with_the_transcribe_model(client, model, data, mime):
    response = upload(client, data, mime)
    assert response.status_code == 200
    assert response.json() == {"text": "hello there"}
    call = model.call_args.kwargs
    assert call["model"] == settings.gemini_stt_model
    part = call["contents"][0]
    assert part.inline_data.data == data
    assert part.inline_data.mime_type == mime.split(";")[0]
    assert call["config"] is None  # the transcribe model rejects a system instruction


def test_requires_login_and_never_calls_the_provider_without_it(client, model):
    assert upload(client, WEBM, headers={}).status_code == 401
    model.assert_not_called()


@pytest.mark.parametrize(("data", "mime", "status", "code"), [
    (WEBM, "text/plain", 415, "unsupported_audio"),
    (WEBM, "image/png", 415, "unsupported_audio"),
    (WAV, "audio/webm", 415, "unsupported_audio"),  # claims webm, bytes are wav
    (b"not audio at all", "audio/ogg", 415, "unsupported_audio"),
    (b"", "audio/webm", 400, "empty_audio"),
])
def test_rejects_bad_uploads_before_calling_the_provider(client, model, data, mime, status, code):
    response = upload(client, data, mime)
    assert (response.status_code, response.json()["error"]) == (status, code)
    model.assert_not_called()


def test_rejects_oversized_recordings(client, model, monkeypatch):
    monkeypatch.setattr(stt, "MAX_BYTES", 100)
    assert upload(client, WEBM + b"\x00" * 100).json()["error"] == "audio_too_large"
    assert upload(client, WEBM[:60]).status_code == 200
    assert model.call_count == 1


def test_missing_audio_field_is_a_validation_error(client, model):
    assert client.post("/api/ai/stt", headers=HEADERS).status_code == 422
    model.assert_not_called()


def test_empty_transcript_is_no_speech_and_never_asks_a_chat_model(client, model):
    """A chat model given silence would reply with text, which must not reach the chat box."""
    model.return_value = SimpleNamespace(text="")
    assert upload(client, WEBM).json()["error"] == "no_speech"
    model.assert_called_once()
    assert model.call_args.kwargs["model"] == settings.gemini_stt_model


def test_silence_is_reported_as_no_speech(client, model):
    model.return_value = SimpleNamespace(text="  ")
    response = upload(client, WEBM)
    assert (response.status_code, response.json()["error"]) == (422, "no_speech")


def test_transcript_is_capped_to_the_chat_message_limit(client, model):
    model.return_value = SimpleNamespace(text="a" * 3000)
    assert len(upload(client, WEBM).json()["text"]) == 2000


@pytest.mark.parametrize(("error", "status", "code"), [
    (errors.ClientError(429, {"error": {"message": "quota"}}), 429, "ai_quota"),
    (errors.ServerError(503, {"error": {"message": "busy"}}), 503, "ai_busy"),
    (errors.ServerError(500, {"error": {"message": "boom"}}), 502, "ai_failed"),
])
def test_provider_failures_become_friendly_errors(client, model, error, status, code):
    model.side_effect = error
    response = upload(client, WEBM)
    assert (response.status_code, response.json()["error"]) == (status, code)


def test_unconfigured_server_says_ai_is_unavailable(client, model, monkeypatch):
    monkeypatch.setattr(settings, "gemini_api_key", "")
    assert upload(client, WEBM).json()["error"] == "ai_unavailable"


def test_reads_the_transcript_from_audio_transcription_parts(client, model):
    """The real transcribe model returns speech in `audio_transcription`, and `.text` is None."""
    parts = [SimpleNamespace(audio_transcription=SimpleNamespace(text=" Hello, this is a test. "))]
    model.return_value = SimpleNamespace(
        text=None, candidates=[SimpleNamespace(content=SimpleNamespace(parts=parts))])
    assert upload(client, WEBM).json() == {"text": "Hello, this is a test."}
    model.assert_called_once()  # no fallback needed


def test_response_without_any_text_or_parts_is_no_speech(client, model):
    model.return_value = SimpleNamespace(text=None, candidates=[SimpleNamespace(content=SimpleNamespace(parts=None))])
    assert upload(client, WEBM).json()["error"] == "no_speech"


def test_candidate_without_content_is_no_speech_not_a_crash(client, model):
    """Real Gemini behaviour for silent audio: a candidate whose `content` is None."""
    model.return_value = SimpleNamespace(text=None, candidates=[SimpleNamespace(content=None)])
    response = upload(client, WEBM)
    assert (response.status_code, response.json()["error"]) == (422, "no_speech")
