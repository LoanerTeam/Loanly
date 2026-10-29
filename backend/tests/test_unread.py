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
    monkeypatch.setattr(presence, "list_private_rooms", repo.list_private_rooms)
    monkeypatch.setattr(presence, "unread_counts", repo.unread_counts)
    monkeypatch.setattr(settings, "dev_auth", True)
    return TestClient(app)


def recv(ws, type):
    while True:
        frame = ws.receive_json()
        if frame["type"] == type:
            return frame


def register(client, *names):
    for name in names:
        with client.websocket_connect(f"/ws?token={name}"):
            pass


def say(ws, room_id, text):
    ws.send_json({"type": "message.send", "roomId": room_id, "text": text})
    return recv(ws, "message.new")["message"]


def unread_for(client, name):
    with client.websocket_connect(f"/ws?token={name}") as ws:
        return recv(ws, "init")["unread"]


def alice_writes_to_offline_bob(client, count):
    """alice sends `count` messages to bob while bob is offline; returns (room id, message ids)."""
    register(client, "bob")
    with client.websocket_connect("/ws?token=alice") as a:
        a.send_json({"type": "dm.open", "username": "bob"})
        room = recv(a, "room.upsert")["room"]
        return room["id"], [say(a, room["id"], f"m{i}")["id"] for i in range(count)]


def mark(ws, room_id, message_id):
    ws.send_json({"type": "read.mark", "roomId": room_id, "messageId": message_id, "reqId": "m"})


def test_unread_counts_messages_from_others_and_never_your_own(client):
    room_id, _ = alice_writes_to_offline_bob(client, 3)
    assert unread_for(client, "bob") == {room_id: 3}
    assert unread_for(client, "alice") == {}  # the sender's own messages are never unread


def test_marking_read_clears_the_count_and_survives_reconnect(client):
    room_id, ids = alice_writes_to_offline_bob(client, 3)
    with client.websocket_connect("/ws?token=bob") as b:
        recv(b, "init")
        mark(b, room_id, ids[-1])
        b.send_json({"type": "history.get", "roomId": room_id})  # round trip: mark was processed first
        recv(b, "history")
    assert unread_for(client, "bob") == {}


def test_partial_mark_leaves_the_rest_unread_and_marker_never_moves_back(client):
    room_id, ids = alice_writes_to_offline_bob(client, 4)
    with client.websocket_connect("/ws?token=bob") as b:
        recv(b, "init")
        mark(b, room_id, ids[2])
        mark(b, room_id, ids[0])  # stale mark arriving late
        b.send_json({"type": "history.get", "roomId": room_id})
        recv(b, "history")
    assert unread_for(client, "bob") == {room_id: 1}


def test_new_messages_after_the_marker_count_again(client):
    room_id, ids = alice_writes_to_offline_bob(client, 1)
    with client.websocket_connect("/ws?token=bob") as b:
        recv(b, "init")
        mark(b, room_id, ids[0])
        b.send_json({"type": "history.get", "roomId": room_id})
        recv(b, "history")
    with client.websocket_connect("/ws?token=alice") as a:
        recv(a, "init")
        say(a, room_id, "later")
    assert unread_for(client, "bob") == {room_id: 1}


def test_read_mark_requires_membership_and_a_message_in_that_room(client):
    room_id, ids = alice_writes_to_offline_bob(client, 1)
    register(client, "carol")
    with client.websocket_connect("/ws?token=carol") as c:
        mark(c, room_id, ids[0])
        assert recv(c, "error")["code"] == "not_member"
    with client.websocket_connect("/ws?token=bob") as b:
        mark(b, room_id, "not-an-id")
        assert recv(b, "error")["code"] == "not_found"
        mark(b, room_id, "0" * 24)
        assert recv(b, "error")["code"] == "not_found"
