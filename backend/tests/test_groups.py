import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from bson import ObjectId
from fastapi.testclient import TestClient
from pymongo.errors import DuplicateKeyError

from app.chat import groups, hub, presence
from app.chat.handlers.groups import create
from app.chat.hub import ChatError, Connection
from app.config import settings
from app.main import app

REAL_ENSURE_INDEXES = groups.ensure_indexes


class FakeSocket:
    def __init__(self):
        self.frames = []

    async def send_json(self, frame):
        self.frames.append(frame)


@pytest.fixture
def repository(monkeypatch):
    stored = []

    async def insert(name, creator):
        if any(group['name'] == name and group['creator'] == creator for group in stored):
            raise ChatError('name_taken', 'A Group with this name already exists')
        group = {'id': str(ObjectId()), 'kind': 'group', 'name': name,
                 'members': [creator], 'creator': creator}
        stored.append(group)
        return group

    async def listing():
        return list(stored)

    monkeypatch.setattr(groups, 'create_group', insert)
    monkeypatch.setattr(presence, 'list_groups', listing)
    monkeypatch.setattr(settings, 'dev_auth', True)
    return stored


async def test_create_creator_broadcast_and_req_id(repository):
    alice, second, bob = [Connection(name, FakeSocket()) for name in ['alice', 'alice', 'bob']]
    for connection in [alice, second, bob]:
        await presence.initialize(connection)
        connection.ws.frames.clear()
    # Clear again because later connections generated presence frames.
    for connection in [alice, second, bob]:
        connection.ws.frames.clear()
    await create(alice, {'name': ' team ', 'reqId': 'request', 'creator': 'bob', 'members': ['bob']})
    assert repository[0]['name'] == 'team'
    assert repository[0]['creator'] == 'alice'
    assert repository[0]['members'] == ['alice']
    assert alice.ws.frames == [{'type': 'group.upsert', 'group': repository[0], 'reqId': 'request'}]
    for connection in [second, bob]:
        assert connection.ws.frames == [{'type': 'group.upsert', 'group': repository[0]}]


@pytest.mark.parametrize('name', [None, 123, [], '', '   '])
async def test_invalid_name_rejected(name, repository):
    with pytest.raises(ChatError) as error:
        await create(Connection('alice', FakeSocket()), {'name': name})
    assert error.value.code == 'invalid_text'
    assert repository == []


async def test_same_name_allowed_for_different_creators(repository):
    alice, bob = Connection('alice', FakeSocket()), Connection('bob', FakeSocket())
    await presence.initialize(alice)
    await presence.initialize(bob)
    await create(alice, {'name': 'test'})
    await create(bob, {'name': 'test', 'creator': 'alice'})
    assert [group['creator'] for group in repository] == ['alice', 'bob']
    assert repository[0]['id'] != repository[1]['id']
    with pytest.raises(ChatError) as error:
        await create(bob, {'name': ' test '})
    assert error.value.code == 'name_taken'
    carol = Connection('carol', FakeSocket())
    await presence.initialize(carol)
    assert carol.ws.frames[0]['groups'] == repository


async def test_duplicate_and_database_failure_do_not_broadcast(repository, monkeypatch):
    conn = Connection('alice', FakeSocket())
    await presence.initialize(conn)
    await create(conn, {'name': 'team'})
    conn.ws.frames.clear()
    with pytest.raises(ChatError) as error:
        await create(conn, {'name': 'team'})
    assert error.value.code == 'name_taken'
    monkeypatch.setattr(groups, 'create_group', AsyncMock(side_effect=RuntimeError('DB down')))
    with pytest.raises(RuntimeError):
        await create(conn, {'name': 'other'})
    assert conn.ws.frames == []
    assert len(repository) == 1


async def test_snapshot_all_groups_and_only_own_rooms(repository):
    alice = Connection('alice', FakeSocket())
    await create(alice, {'name': 'team'})
    for name in ['alice', 'bob']:
        conn = Connection(name, FakeSocket())
        await presence.initialize(conn)
        snapshot = conn.ws.frames[0]
        assert snapshot['type'] == 'init'
        assert snapshot['groups'] == repository
        assert snapshot['rooms'] == (repository if name == 'alice' else [])


async def test_connect_during_create_cannot_miss_group(repository, monkeypatch):
    started, finish = asyncio.Event(), asyncio.Event()
    original = groups.create_group

    async def insert(name, creator):
        started.set()
        await finish.wait()
        return await original(name, creator)

    monkeypatch.setattr(groups, 'create_group', insert)
    task = asyncio.create_task(create(Connection('alice', FakeSocket()), {'name': 'team'}))
    await started.wait()
    bob = Connection('bob', FakeSocket())
    joining = asyncio.create_task(presence.initialize(bob))
    await asyncio.sleep(0)
    finish.set()
    await asyncio.gather(task, joining)
    assert bob.ws.frames[0]['type'] == 'init'
    assert bob.ws.frames[0]['groups'] == repository


async def test_repository_index_insert_and_duplicate_mapping(monkeypatch):
    rooms = SimpleNamespace(create_index=AsyncMock(), index_information=AsyncMock(return_value={}),
                            insert_one=AsyncMock(return_value=SimpleNamespace(inserted_id=ObjectId())))
    monkeypatch.setattr(groups, 'get_db', lambda: SimpleNamespace(rooms=rooms))
    await REAL_ENSURE_INDEXES()
    rooms.create_index.assert_awaited_once_with([('creator', 1), ('name', 1)], unique=True,
                                              name='unique_group_creator_name',
                                              partialFilterExpression={'kind': 'group'})
    group = await groups.create_group('team', 'alice')
    assert isinstance(group['id'], str)
    assert group['members'] == ['alice']
    rooms.insert_one.side_effect = DuplicateKeyError('duplicate')
    with pytest.raises(ChatError) as error:
        await groups.create_group('team', 'alice')
    assert error.value.code == 'name_taken'


async def test_index_migration_replaces_legacy_constraint_in_order(monkeypatch):
    events = []

    async def create_index(*args, **kwargs):
        events.append('create')

    async def drop_index(name):
        assert name == 'unique_group_name'
        events.append('drop')

    rooms = SimpleNamespace(create_index=create_index, drop_index=drop_index,
                            index_information=AsyncMock(return_value={'unique_group_name': {
                                'key': [('name', 1)], 'unique': True,
                                'partialFilterExpression': {'kind': 'group'},
                            }}))
    monkeypatch.setattr(groups, 'get_db', lambda: SimpleNamespace(rooms=rooms))
    await REAL_ENSURE_INDEXES()
    assert events == ['create', 'drop']


async def test_failed_replacement_index_preserves_legacy_index(monkeypatch):
    rooms = SimpleNamespace(create_index=AsyncMock(side_effect=RuntimeError('cannot create index')),
                            drop_index=AsyncMock())
    monkeypatch.setattr(groups, 'get_db', lambda: SimpleNamespace(rooms=rooms))
    with pytest.raises(RuntimeError, match='cannot create index'):
        await REAL_ENSURE_INDEXES()
    rooms.drop_index.assert_not_awaited()


async def test_unexpected_legacy_index_is_not_dropped(monkeypatch):
    rooms = SimpleNamespace(create_index=AsyncMock(), drop_index=AsyncMock(),
                            index_information=AsyncMock(return_value={'unique_group_name': {
                                'key': [('name', 1)], 'unique': True,
                            }}))
    monkeypatch.setattr(groups, 'get_db', lambda: SimpleNamespace(rooms=rooms))
    with pytest.raises(RuntimeError, match='manual migration required'):
        await REAL_ENSURE_INDEXES()
    rooms.drop_index.assert_not_awaited()


def test_websocket_create_and_reconnect_snapshot(repository):
    with TestClient(app) as client:
        with client.websocket_connect('/ws?token=alice') as alice:
            alice.receive_json()
            alice.receive_json()
            with client.websocket_connect('/ws?token=bob') as bob:
                bob.receive_json()
                bob.receive_json()
                alice.receive_json()
                alice.send_json({'type': 'group.create', 'name': 'team', 'reqId': 'one'})
                success = alice.receive_json()
                assert success['reqId'] == 'one'
                assert bob.receive_json() == {'type': 'group.upsert', 'group': success['group']}
                alice.send_json({'type': 'group.create', 'name': 'team', 'reqId': 'two'})
                assert alice.receive_json()['code'] == 'name_taken'
        with client.websocket_connect('/ws?token=carol') as carol:
            assert carol.receive_json()['groups'] == repository
    assert not hub.connections


async def test_list_filters_groups_and_serializes(monkeypatch):
    document = {'_id': ObjectId(), 'kind': 'group', 'name': 'team',
                'members': ['alice'], 'creator': 'alice'}

    class Cursor:
        def sort(self, fields):
            assert fields == [('name', 1), ('_id', 1)]
            return self

        def __aiter__(self):
            async def rows():
                yield document
            return rows()

    class Rooms:
        def find(self, query):
            assert query == {'kind': 'group'}
            return Cursor()

    monkeypatch.setattr(groups, 'get_db', lambda: SimpleNamespace(rooms=Rooms()))
    assert await groups.list_groups() == [groups.serialize(document)]


def test_startup_ensures_indexes_and_fails_closed_on_error(monkeypatch):
    ensure = AsyncMock()
    monkeypatch.setattr(groups, 'ensure_indexes', ensure)
    with TestClient(app):
        ensure.assert_awaited_once()
    ensure.side_effect = RuntimeError('index creation failed')
    with pytest.raises(RuntimeError, match='index creation failed'), TestClient(app):
        pass


async def test_failed_group_recipient_does_not_block_healthy_clients(repository):
    class BrokenSocket(FakeSocket):
        broken = False
        closed = False

        async def send_json(self, frame):
            if self.broken:
                raise OSError('recipient disconnected')
            await super().send_json(frame)

        async def close(self, code):
            self.closed = True

    alice = Connection('alice', FakeSocket())
    bob = Connection('bob', BrokenSocket())
    carol = Connection('carol', FakeSocket())
    for conn in [alice, bob, carol]:
        await presence.initialize(conn)
    bob.ws.broken = True
    await create(alice, {'name': 'team', 'reqId': 'request'})
    assert any(frame.get('group') == repository[0] for frame in carol.ws.frames)
    assert any(frame.get('reqId') == 'request' for frame in alice.ws.frames)
    assert bob.ws.closed
    assert 'bob' not in hub.connections
