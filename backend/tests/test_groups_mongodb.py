"""Real MongoDB checks. CI supplies a dedicated server; local runs opt in explicitly."""
import asyncio
import os
from uuid import uuid4

import pytest
from motor.motor_asyncio import AsyncIOMotorClient

from app.chat import groups
from app.chat.hub import ChatError

REAL_ENSURE_INDEXES = groups.ensure_indexes


@pytest.mark.skipif(not os.environ.get('LOANLY_TEST_MONGODB_URI'),
                    reason='Set LOANLY_TEST_MONGODB_URI to run real MongoDB integration tests')
async def test_unique_group_names_and_persistence_across_clients(monkeypatch):
    uri = os.environ['LOANLY_TEST_MONGODB_URI']
    name = f'loanly_test_{uuid4().hex}'
    client = AsyncIOMotorClient(uri, serverSelectionTimeoutMS=3000)
    fresh = None
    try:
        db = client[name]
        monkeypatch.setattr(groups, 'get_db', lambda: db)
        # Simulate an existing installation and verify automatic, repeatable migration.
        await db.rooms.create_index('name', unique=True, name='unique_group_name',
                                    partialFilterExpression={'kind': 'group'})
        await REAL_ENSURE_INDEXES()
        await REAL_ENSURE_INDEXES()
        assert 'unique_group_name' not in await db.rooms.index_information()
        # Group-name uniqueness must not constrain Private Rooms.
        await db.rooms.insert_many([
            {'kind': 'private', 'name': 'team'}, {'kind': 'private', 'name': 'team'},
        ])
        results = await asyncio.gather(groups.create_group('team', 'alice'),
                                       groups.create_group('team', 'alice'),
                                       return_exceptions=True)
        assert sum(isinstance(result, dict) for result in results) == 1
        assert sum(isinstance(result, ChatError) and result.code == 'name_taken'
                   for result in results) == 1
        assert await db.rooms.count_documents({'kind': 'group'}) == 1
        bob = await groups.create_group('team', 'bob')
        assert bob['creator'] == 'bob'
        assert await db.rooms.count_documents({'kind': 'group'}) == 2
        # A separate client has no in-memory state from the first connection.
        fresh = AsyncIOMotorClient(uri, serverSelectionTimeoutMS=3000)
        monkeypatch.setattr(groups, 'get_db', lambda: fresh[name])
        restored = await groups.list_groups()
        assert len(restored) == 2
        assert {group['creator'] for group in restored} == {'alice', 'bob'}
        assert all(group['name'] == 'team' and group['members'] == [group['creator']]
                   for group in restored)
    finally:
        await client.drop_database(name)
        if fresh is not None:
            fresh.close()
        client.close()
