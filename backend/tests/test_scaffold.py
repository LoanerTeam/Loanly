import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.chat.registry import handler
from app.config import settings
from app.main import app

client = TestClient(app)


def test_health():
    assert client.get("/api/health").json() == {"ok": True}


def test_ws_rejects_missing_token():
    with pytest.raises(WebSocketDisconnect) as e, client.websocket_connect("/ws"):
        pass
    assert e.value.code == 4401


def test_ws_dispatch_echoes_req_id_and_handles_bad_frames(monkeypatch):
    monkeypatch.setattr(settings, "dev_auth", True)

    @handler("test.ping")
    async def ping(conn, msg):
        await conn.send("test.pong", reqId=msg.get("reqId"))

    with client.websocket_connect("/ws?token=alice") as ws:
        ws.send_json({"type": "test.ping", "reqId": "1"})
        assert ws.receive_json() == {"type": "test.pong", "reqId": "1"}
        ws.send_json({"type": "nope", "reqId": "2"})
        assert ws.receive_json()["code"] == "not_found"
        ws.send_text("not json")
        assert ws.receive_json()["code"] == "invalid_text"
