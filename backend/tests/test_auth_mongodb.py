"""Real MongoDB index, registration race and persisted profile checks."""
import asyncio
import os
from uuid import uuid4

import pytest
from motor.motor_asyncio import AsyncIOMotorClient

from app.auth import repo
from app.auth.errors import AuthError


@pytest.mark.skipif(not os.environ.get("LOANLY_TEST_MONGODB_URI"),
                    reason="Set LOANLY_TEST_MONGODB_URI to run real MongoDB integration tests")
async def test_registration_race_and_persistence(monkeypatch):
    uri = os.environ["LOANLY_TEST_MONGODB_URI"]
    name = f"loanly_test_{uuid4().hex}"
    client = AsyncIOMotorClient(uri, serverSelectionTimeoutMS=3000)
    fresh = None
    try:
        monkeypatch.setattr(repo, "get_db", lambda: client[name])
        await repo.ensure_indexes()
        await repo.ensure_indexes()
        results = await asyncio.gather(*(repo.create_user("alice", "test-hash") for _ in range(5)),
                                       return_exceptions=True)
        assert sum(result is None for result in results) == 1
        assert sum(isinstance(result, AuthError) and result.code == "name_taken"
                   for result in results) == 4
        await repo.update_language("alice", "th")
        fresh = AsyncIOMotorClient(uri, serverSelectionTimeoutMS=3000)
        monkeypatch.setattr(repo, "get_db", lambda: fresh[name])
        assert (await repo.find_user("alice"))["targetLang"] == "th"
        assert await fresh[name].users.count_documents({}) == 1
    finally:
        await client.drop_database(name)
        if fresh is not None:
            fresh.close()
        client.close()
