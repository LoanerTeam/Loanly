import asyncio
from unittest.mock import AsyncMock

import pytest

from app.ai import limits, translate
from app.auth import router
from app.chat import groups, hub, presence, repo
from app.chat.hub import connections, dev_users


@pytest.fixture(autouse=True)
def clear_presence(monkeypatch):
    lock = asyncio.Lock()
    monkeypatch.setattr(hub, "presence_lock", lock)
    monkeypatch.setattr(presence, "presence_lock", lock)
    monkeypatch.setattr(groups, "ensure_indexes", AsyncMock())
    monkeypatch.setattr(repo, "ensure_indexes", AsyncMock())
    monkeypatch.setattr(translate, "ensure_indexes", AsyncMock())
    limits.reset()
    router.failures.clear()
    # Ordinary chat unit tests do not need an account database or JWT configuration.
    # Application-auth integration tests restore the real initializer explicitly.
    monkeypatch.setattr("app.main.initialize_auth", AsyncMock())
    monkeypatch.setattr(presence, "list_groups", AsyncMock(return_value=[]))
    monkeypatch.setattr(presence, "list_private_rooms", AsyncMock(return_value=[]))
    monkeypatch.setattr(presence, "unread_counts", AsyncMock(return_value={}))
    connections.clear()
    dev_users.clear()
    yield
    connections.clear()
    dev_users.clear()
