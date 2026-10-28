import asyncio

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.chat import presence
from app.chat.hub import Connection, announce_new_user, broadcast, connections, disconnect
from app.config import settings
from app.main import app


class FakeSocket:
    def __init__(self, fail=False):
        self.frames = []
        self.fail = fail
        self.closed = False

    async def send_json(self, frame):
        if isinstance(self.fail, Exception):
            raise self.fail
        if self.fail:
            raise OSError("connection lost")
        self.frames.append(frame)

    async def close(self, code):
        self.closed = True


@pytest.fixture
def dev_auth(monkeypatch):
    monkeypatch.setattr(settings, "dev_auth", True)


async def test_snapshot_registered_users_and_projection(monkeypatch):
    monkeypatch.setattr(settings, "dev_auth", False)

    class Users:
        def find(self, query, projection):
            assert query == {}
            assert projection == {"_id": 0, "username": 1}

            async def rows():
                for name in ["alice", "bob"]:
                    yield {"username": name}
            return rows()

    class DB:
        users = Users()

    monkeypatch.setattr(presence, "get_db", lambda: DB())
    ws = FakeSocket()
    await presence.initialize(Connection("alice", ws))
    assert ws.frames[0] == {
        "type": "init", "me": "alice",
        "users": [{"username": "alice", "online": True},
                  {"username": "bob", "online": False}],
        "rooms": [], "groups": [], "unread": {},
    }


async def test_multi_tab_transitions_and_offline_dev_users(dev_auth):
    alice = Connection("alice", FakeSocket())
    bob = Connection("bob", FakeSocket())
    second = Connection("bob", FakeSocket())
    await presence.initialize(alice)
    await presence.initialize(bob)
    await presence.initialize(second)
    assert second.ws.frames[0]["type"] == "init"
    assert alice.ws.frames.count({"type": "presence", "username": "bob", "online": True}) == 1
    await disconnect(bob)
    assert not any(f.get("username") == "bob" and f.get("online") is False
                   for f in alice.ws.frames)
    await disconnect(second)
    assert alice.ws.frames[-1] == {"type": "presence", "username": "bob", "online": False}
    await disconnect(second)  # Cleanup is idempotent after a failed broadcast.
    carol = Connection("carol", FakeSocket())
    await presence.initialize(carol)
    assert {"username": "bob", "online": False} in carol.ws.frames[0]["users"]


async def test_registration_announces_offline_and_online(dev_auth):
    conn = Connection("alice", FakeSocket())
    await presence.initialize(conn)
    await announce_new_user("bob")
    assert conn.ws.frames[-1] == {"type": "presence", "username": "bob", "online": False}
    await announce_new_user("alice")
    assert conn.ws.frames[-1]["online"] is True


@pytest.mark.parametrize("failure", [True, WebSocketDisconnect(code=1006)])
async def test_failed_recipient_does_not_break_fanout(dev_auth, failure):
    alice = Connection("alice", FakeSocket())
    bob = Connection("bob", FakeSocket())
    await presence.initialize(alice)
    await presence.initialize(bob)
    bob.ws.fail = failure
    await broadcast("presence", username="carol", online=False)
    assert bob.ws.closed
    assert "bob" not in connections
    assert alice.ws.frames[-1] == {"type": "presence", "username": "bob", "online": False}


async def test_registration_serialized_with_snapshot(monkeypatch):
    started, finish = asyncio.Event(), asyncio.Event()

    async def names():
        started.set()
        await finish.wait()
        return {"alice"}

    monkeypatch.setattr(presence, "registered_usernames", names)
    conn = Connection("alice", FakeSocket())
    init = asyncio.create_task(presence.initialize(conn))
    await started.wait()
    announcement = asyncio.create_task(announce_new_user("bob"))
    await asyncio.sleep(0)
    finish.set()
    await asyncio.gather(init, announcement)
    assert conn.ws.frames[0]["type"] == "init"
    assert conn.ws.frames[-1] == {"type": "presence", "username": "bob", "online": False}


def test_endpoint_init_presence_and_cleanup(dev_auth):
    with TestClient(app) as client:
        with client.websocket_connect("/ws?token=alice") as alice:
            assert alice.receive_json()["type"] == "init"
            assert alice.receive_json() == {"type": "presence", "username": "alice", "online": True}
            with client.websocket_connect("/ws?token=bob") as bob:
                assert bob.receive_json()["type"] == "init"
                assert alice.receive_json() == {"type": "presence", "username": "bob", "online": True}
            assert alice.receive_json() == {"type": "presence", "username": "bob", "online": False}
    assert not connections


def test_snapshot_failure_never_leaks_connection(monkeypatch, dev_auth):
    async def fail():
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(presence, "registered_usernames", fail)
    with TestClient(app) as client:
        with client.websocket_connect("/ws?token=alice") as ws:
            with pytest.raises(WebSocketDisconnect) as error:
                ws.receive_json()
            assert error.value.code == 1011
    assert not connections


async def test_failed_init_send_rolls_back_before_other_snapshots(dev_auth):
    alice = Connection("alice", FakeSocket())
    await presence.initialize(alice)
    before = list(alice.ws.frames)
    bob = Connection("bob", FakeSocket(fail=True))
    with pytest.raises(OSError):
        await presence.initialize(bob)
    assert "bob" not in connections
    assert alice.ws.frames == before
    await disconnect(bob)
    carol = Connection("carol", FakeSocket())
    await presence.initialize(carol)
    assert {"username": "bob", "online": False} in carol.ws.frames[0]["users"]
