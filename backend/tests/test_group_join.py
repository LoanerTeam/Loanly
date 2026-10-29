import pytest
from bson import ObjectId
from fastapi.testclient import TestClient
from mongomock_motor import AsyncMongoMockClient

from app.chat import groups, presence, repo
from app.config import settings
from app.main import app


@pytest.fixture
def client(monkeypatch):
    db = AsyncMongoMockClient()["loanly_test"]
    monkeypatch.setattr(repo, "get_db", lambda: db)
    monkeypatch.setattr(groups, "get_db", lambda: db)
    # conftest stubs the empty snapshot; rooms, groups and unread must come from the fake db here
    monkeypatch.setattr(presence, "list_private_rooms", repo.list_private_rooms)
    monkeypatch.setattr(presence, "list_groups", groups.list_groups)
    monkeypatch.setattr(presence, "unread_counts", repo.unread_counts)
    monkeypatch.setattr(settings, "dev_auth", True)
    return TestClient(app)


def recv(ws, type):
    """Next frame of the given type; presence and other noise is skipped."""
    while True:
        frame = ws.receive_json()
        if frame["type"] == type:
            return frame


def create_group(ws, name="team"):
    ws.send_json({"type": "group.create", "name": name, "reqId": "c"})
    return recv(ws, "group.upsert")["group"]


def say(ws, room_id, text):
    ws.send_json({"type": "message.send", "roomId": room_id, "text": text})
    return recv(ws, "message.new")["message"]


def test_join_adds_only_the_caller_and_notifies_everyone(client):
    with (
        client.websocket_connect("/ws?token=alice") as a,
        client.websocket_connect("/ws?token=bob") as b,
        client.websocket_connect("/ws?token=carol") as c,
    ):
        group = create_group(a)
        for ws in (b, c):
            recv(ws, "group.upsert")
        b.send_json({"type": "group.join", "groupId": group["id"], "reqId": "j"})
        upsert = recv(b, "group.upsert")["group"]
        room = recv(b, "room.upsert")
        assert upsert["members"] == ["alice", "bob"]
        assert room["reqId"] == "j"
        assert room["room"] == upsert
        assert room["room"]["kind"] == "group" and room["room"]["creator"] == "alice"
        # Everyone sees the new member list; carol was not added.
        for ws in (a, c):
            assert recv(ws, "group.upsert")["group"]["members"] == ["alice", "bob"]


def test_group_messages_reach_members_only(client):
    with (
        client.websocket_connect("/ws?token=alice") as a,
        client.websocket_connect("/ws?token=bob") as b,
        client.websocket_connect("/ws?token=carol") as c,
    ):
        group = create_group(a)
        b.send_json({"type": "group.join", "groupId": group["id"]})
        recv(b, "room.upsert")
        say(a, group["id"], "hi team")
        assert recv(b, "message.new")["message"]["text"] == "hi team"
        # carol is not a member: she gets errors, never the message. Her error frame is
        # sent after "hi team", so a leaked message.new would arrive before it.
        c.send_json({"type": "message.send", "roomId": group["id"], "text": "sneak"})
        while (frame := c.receive_json())["type"] != "error":
            assert frame["type"] != "message.new"
        assert frame["code"] == "not_member"
        c.send_json({"type": "history.get", "roomId": group["id"]})
        assert recv(c, "error")["code"] == "not_member"
    with client.websocket_connect("/ws?token=carol") as c:
        init = recv(c, "init")
        assert init["rooms"] == [] and init["unread"] == {}


def test_late_joiner_sees_full_history_without_unread(client):
    with client.websocket_connect("/ws?token=alice") as a:
        group = create_group(a)
        sent = [say(a, group["id"], text) for text in ("one", "two")]
        with client.websocket_connect("/ws?token=bob") as b:
            b.send_json({"type": "group.join", "groupId": group["id"]})
            recv(b, "room.upsert")
            b.send_json({"type": "history.get", "roomId": group["id"], "reqId": "h"})
            history = recv(b, "history")
            assert [m["id"] for m in history["messages"]] == [m["id"] for m in sent]
        say(a, group["id"], "three")
    # Earlier history is not Unread for the new member; later messages are.
    with client.websocket_connect("/ws?token=bob") as b:
        init = recv(b, "init")
        assert [room["id"] for room in init["rooms"]] == [group["id"]]
        assert init["unread"] == {group["id"]: 1}


def test_repeat_join_keeps_members_and_unread(client):
    with client.websocket_connect("/ws?token=alice") as a:
        group = create_group(a)
        with client.websocket_connect("/ws?token=bob") as b:
            b.send_json({"type": "group.join", "groupId": group["id"]})
            recv(b, "room.upsert")
        say(a, group["id"], "while away")
        with client.websocket_connect("/ws?token=bob") as b:
            b.send_json({"type": "group.join", "groupId": group["id"], "reqId": "again"})
            room = recv(b, "room.upsert")
            assert room["reqId"] == "again"
            assert room["room"]["members"] == ["alice", "bob"]
        with client.websocket_connect("/ws?token=bob") as b:
            assert recv(b, "init")["unread"] == {group["id"]: 1}


def test_other_tabs_of_the_joiner_get_the_room(client):
    with client.websocket_connect("/ws?token=alice") as a:
        group = create_group(a)
        with (
            client.websocket_connect("/ws?token=bob") as first,
            client.websocket_connect("/ws?token=bob") as second,
        ):
            first.send_json({"type": "group.join", "groupId": group["id"], "reqId": "j"})
            assert recv(first, "room.upsert")["reqId"] == "j"
            other = recv(second, "room.upsert")
            assert other["room"]["id"] == group["id"] and "reqId" not in other


@pytest.mark.parametrize("group_id", [None, 5, "", "not-an-id", str(ObjectId())])
def test_join_unknown_group_is_not_found(client, group_id):
    with client.websocket_connect("/ws?token=bob") as b:
        b.send_json({"type": "group.join", "groupId": group_id, "reqId": "x"})
        error = recv(b, "error")
        assert (error["code"], error["reqId"]) == ("not_found", "x")


def test_private_room_cannot_be_joined(client):
    with client.websocket_connect("/ws?token=carol"):
        pass
    with client.websocket_connect("/ws?token=bob"):
        pass
    with client.websocket_connect("/ws?token=alice") as a:
        a.send_json({"type": "dm.open", "username": "bob"})
        room = recv(a, "room.upsert")["room"]
    with client.websocket_connect("/ws?token=carol") as c:
        c.send_json({"type": "group.join", "groupId": room["id"]})
        assert recv(c, "error")["code"] == "not_found"
        c.send_json({"type": "history.get", "roomId": room["id"]})
        assert recv(c, "error")["code"] == "not_member"
