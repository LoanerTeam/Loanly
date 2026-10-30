from fastapi.testclient import TestClient

from app.ai import tts
from app.config import settings
from app.main import app


def test_application_mounts_authenticated_tts(monkeypatch):
    calls = []

    async def speech(text):
        calls.append(text)
        return b"mock wav"

    monkeypatch.setattr(settings, "dev_auth", True)
    monkeypatch.setattr(tts, "generate_speech", speech)
    client = TestClient(app)
    assert client.post("/api/ai/tts", json={"text": "Hello"}).status_code == 401
    assert calls == []
    response = client.post("/api/ai/tts", headers={"Authorization": "Bearer alice"},
                           json={"text": "Hello"})
    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/wav"
    assert calls == ["Hello"]
