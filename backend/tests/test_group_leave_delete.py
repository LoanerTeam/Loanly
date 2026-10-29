import pytest
from bson import ObjectId
from fastapi.testclient import TestClient
from mongomock_motor import AsyncMongoMockClient

from app.chat import groups, presence, repo
from app.config import settings
from app.main import app


@pytest.fixture
def db(monkeypatch):
    db = AsyncMongoMockClient()["loanly_test"]
    monkeypatch.setattr(repo, "get_db", lambda: db)
    monkeypatch.setattr(groups, "get_db", lambda: db)
    # conftest stubs the empty snapshot; rooms, groups and unread must come from the fake db here
    monkeypatch.setattr(presence, "list_private_rooms", repo.list_private_rooms)
    monkeypatch.setattr(presence, "list_groups", groups.list_groups)
    monkeypatch.setattr(presence, "unread_counts", repo.unread_counts)
    monkeypatch.setattr(settings, "dev_auth", True)
    return db


@pytest.fixture
def client(db):
    return TestClient(app)


def recv(ws, type):
    """Next frame of the given type; presence and other noise is skipped."""
    while True:
        frame = ws.receive_json()
        if frame["type"] == type:
            return frame


def create_group(ws, name="team"):
    ws.send_json({"type": "group.create", "name": name})
    return recv(ws, "group.upsert")["group"]


def join(ws, group_id):
    ws.send_json({"type": "group.join", "groupId": group_id})
    return recv(ws, "room.upsert")["room"]


def test_member_leaves_and_can_rejoin(client):
    with (
        client.websocket_connect("/ws?token=alice") as a,
        client.websocket_connect("/ws?token=bob") as b,
    ):
        group = create_group(a)
        join(b, group["id"])
        b.send_json({"type": "group.leave", "groupId": group["id"], "reqId": "l"})
        assert recv(b, "group.upsert")["group"]["members"] == ["alice"]
        removed = recv(b, "room.removed")
        assert removed == {"type": "room.removed", "roomId": group["id"], "reqId": "l"}
        # Everyone sees bob gone from the member list.
        while (frame := recv(a, "group.upsert"))["group"]["members"] != ["alice"]:
            pass
        # A former Member no longer receives the Group's messages or history.
        a.send_json({"type": "message.send", "roomId": group["id"], "text": "after bob left"})
        recv(a, "message.new")
        b.send_json({"type": "history.get", "roomId": group["id"]})
        while (frame := b.receive_json())["type"] != "error":
            assert frame["type"] != "message.new"
        assert frame["code"] == "not_member"
        assert join(b, group["id"])["members"] == ["alice", "bob"]


def test_creator_cannot_leave(client):
    with client.websocket_connect("/ws?token=alice") as a:
        group = create_group(a)
        a.send_json({"type": "group.leave", "groupId": group["id"], "reqId": "l"})
        error = recv(a, "error")
        assert (error["code"], error["reqId"]) == ("creator_cannot_leave", "l")
    with client.websocket_connect("/ws?token=alice") as a:
        assert recv(a, "init")["groups"][0]["members"] == ["alice"]


def test_non_member_cannot_leave(client):
    with client.websocket_connect("/ws?token=alice") as a:
        group = create_group(a)
    with client.websocket_connect("/ws?token=carol") as c:
        c.send_json({"type": "group.leave", "groupId": group["id"]})
        assert recv(c, "error")["code"] == "not_member"


def test_only_the_creator_can_delete(client):
    with (
        client.websocket_connect("/ws?token=alice") as a,
        client.websocket_connect("/ws?token=bob") as b,
    ):
        group = create_group(a)
        join(b, group["id"])
        b.send_json({"type": "group.delete", "groupId": group["id"], "reqId": "d"})
        error = recv(b, "error")
        assert (error["code"], error["reqId"]) == ("forbidden", "d")
    with client.websocket_connect("/ws?token=carol") as c:
        assert [g["id"] for g in recv(c, "init")["groups"]] == [group["id"]]


def test_delete_removes_group_for_everyone_with_its_messages(client):
    with (
        client.websocket_connect("/ws?token=alice") as a,
        client.websocket_connect("/ws?token=bob") as b,
        client.websocket_connect("/ws?token=carol") as c,
    ):
        group = create_group(a)
        join(b, group["id"])
        a.send_json({"type": "message.send", "roomId": group["id"], "text": "soon gone"})
        message = recv(b, "message.new")["message"]
        b.send_json({"type": "read.mark", "roomId": group["id"], "messageId": message["id"]})
        a.send_json({"type": "group.delete", "groupId": group["id"], "reqId": "d"})
        assert recv(a, "group.removed") == {"type": "group.removed", "groupId": group["id"], "reqId": "d"}
        for ws in (b, c):
            assert recv(ws, "group.removed") == {"type": "group.removed", "groupId": group["id"]}
        b.send_json({"type": "message.send", "roomId": group["id"], "text": "too late"})
        assert recv(b, "error")["code"] == "not_found"
    with client.websocket_connect("/ws?token=bob") as b:
        init = recv(b, "init")
        assert init["groups"] == [] and init["rooms"] == [] and init["unread"] == {}


async def test_delete_clears_messages_and_read_markers(db):
    group = await groups.create_group("team", "alice")
    await repo.add_message(group["id"], "alice", "hi")
    await db.read_markers.insert_one({"username": "bob", "roomId": group["id"], "messageId": ObjectId()})
    other = await groups.create_group("other", "alice")
    await repo.add_message(other["id"], "alice", "stays")
    assert await groups.delete_group(group["id"], "alice") == group
    assert await db.messages.count_documents({"roomId": group["id"]}) == 0
    assert await db.read_markers.count_documents({"roomId": group["id"]}) == 0
    assert await db.messages.count_documents({"roomId": other["id"]}) == 1


@pytest.mark.parametrize("type", ["group.leave", "group.delete"])
@pytest.mark.parametrize("group_id", [None, 5, "", "not-an-id", str(ObjectId())])
def test_unknown_group_is_not_found(client, type, group_id):
    with client.websocket_connect("/ws?token=bob") as b:
        b.send_json({"type": type, "groupId": group_id, "reqId": "x"})
        error = recv(b, "error")
        assert (error["code"], error["reqId"]) == ("not_found", "x")


@pytest.mark.parametrize("type", ["group.leave", "group.delete"])
def test_private_room_cannot_be_left_or_deleted(client, type):
    with client.websocket_connect("/ws?token=bob"):
        pass
    with client.websocket_connect("/ws?token=alice") as a:
        a.send_json({"type": "dm.open", "username": "bob"})
        room = recv(a, "room.upsert")["room"]
        a.send_json({"type": type, "groupId": room["id"]})
        assert recv(a, "error")["code"] == "not_found"


def test_other_tabs_of_the_leaver_lose_the_room(client):
    with client.websocket_connect("/ws?token=alice") as a:
        group = create_group(a)
        with (
            client.websocket_connect("/ws?token=bob") as first,
            client.websocket_connect("/ws?token=bob") as second,
        ):
            join(first, group["id"])
            first.send_json({"type": "group.leave", "groupId": group["id"], "reqId": "l"})
            assert recv(first, "room.removed")["reqId"] == "l"
            other = recv(second, "room.removed")
            assert other["roomId"] == group["id"] and "reqId" not in other
