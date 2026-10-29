import pytest
from fastapi.testclient import TestClient
from mongomock_motor import AsyncMongoMockClient

from app.chat import presence, repo
from app.config import settings
from app.main import app


@pytest.fixture
def client(monkeypatch):
    db = AsyncMongoMockClient()["loanly_test"]
    monkeypatch.setattr(repo, "get_db", lambda: db)
    # conftest stubs the empty snapshot; private rooms must come from the fake db here
    monkeypatch.setattr(presence, "list_private_rooms", repo.list_private_rooms)
    monkeypatch.setattr(settings, "dev_auth", True)
    return TestClient(app)


def recv(ws, type):
    """Next frame of the given type; presence/init noise from other tests of the hub is skipped."""
    while True:
        frame = ws.receive_json()
        if frame["type"] == type:
            return frame


def open_dm(ws, to):
    ws.send_json({"type": "dm.open", "username": to, "reqId": "r"})
    return recv(ws, "room.upsert")["room"]


def register(client, *names):
    """In dev auth a name is known once it has connected."""
    for name in names:
        with client.websocket_connect(f"/ws?token={name}"):
            pass


def test_dm_open_is_idempotent_and_named_after_other_user(client):
    register(client, "bob")
    with client.websocket_connect("/ws?token=alice") as a:
        first, second = open_dm(a, "bob"), open_dm(a, "bob")
    assert first["id"] == second["id"]
    assert first["name"] == "bob" and first["kind"] == "private" and first["creator"] is None
    assert first["members"] == ["alice", "bob"]


def test_dm_to_unknown_user_or_self_is_rejected(client):
    with client.websocket_connect("/ws?token=alice") as a:
        a.send_json({"type": "dm.open", "username": "ghost"})
        assert recv(a, "error")["code"] == "unknown_user"
        a.send_json({"type": "dm.open", "username": "alice"})
        assert recv(a, "error")["code"] == "forbidden"


def test_message_reaches_both_members_and_not_a_third_user(client):
    register(client, "carol")
    with (
        client.websocket_connect("/ws?token=alice") as a,
        client.websocket_connect("/ws?token=bob") as b,
        client.websocket_connect("/ws?token=carol") as c,
    ):
        room = open_dm(a, "bob")
        assert recv(b, "room.upsert")["room"]["name"] == "alice"  # bob learns about the room
        a.send_json({"type": "message.send", "roomId": room["id"], "text": "hi bob"})
        for ws in (a, b):
            m = recv(ws, "message.new")["message"]
            assert (m["sender"], m["text"], m["roomId"]) == ("alice", "hi bob", room["id"])
        # carol is not a member: she gets an error, never the message
        c.send_json({"type": "message.send", "roomId": room["id"], "text": "sneak"})
        assert recv(c, "error")["code"] == "not_member"
        c.send_json({"type": "history.get", "roomId": room["id"]})
        assert recv(c, "error")["code"] == "not_member"


@pytest.mark.parametrize("text", ["", "   ", "x" * 2001, 5, None])
def test_invalid_text_rejected(client, text):
    register(client, "bob")
    with client.websocket_connect("/ws?token=alice") as a:
        room = open_dm(a, "bob")
        a.send_json({"type": "message.send", "roomId": room["id"], "text": text})
        assert recv(a, "error")["code"] == "invalid_text"


def test_unknown_room_is_not_found(client):
    with client.websocket_connect("/ws?token=alice") as a:
        a.send_json({"type": "message.send", "roomId": "nope", "text": "x"})
        assert recv(a, "error")["code"] == "not_found"


def test_history_is_stored_for_offline_user_and_ordered(client):
    register(client, "bob")  # bob exists but is offline while alice writes
    with client.websocket_connect("/ws?token=alice") as a:
        room = open_dm(a, "bob")
        for t in ("one", "two"):
            a.send_json({"type": "message.send", "roomId": room["id"], "text": t})
            recv(a, "message.new")
    with client.websocket_connect("/ws?token=bob") as b:
        init = recv(b, "init")
        assert [r["name"] for r in init["rooms"]] == ["alice"]  # room restored after reconnect
        b.send_json({"type": "history.get", "roomId": room["id"], "reqId": "h"})
        frame = recv(b, "history")
    assert frame["reqId"] == "h"
    assert [m["text"] for m in frame["messages"]] == ["one", "two"]
