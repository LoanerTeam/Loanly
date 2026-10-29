import asyncio
from unittest.mock import AsyncMock

import pytest

from app.chat import groups, hub, presence
from app.chat.hub import connections, dev_users


@pytest.fixture(autouse=True)
def clear_presence(monkeypatch):
    lock = asyncio.Lock()
    monkeypatch.setattr(hub, "presence_lock", lock)
    monkeypatch.setattr(presence, "presence_lock", lock)
    monkeypatch.setattr(groups, "ensure_indexes", AsyncMock())
    monkeypatch.setattr(presence, "list_groups", AsyncMock(return_value=[]))
    monkeypatch.setattr(presence, "list_private_rooms", AsyncMock(return_value=[]))
    connections.clear()
    dev_users.clear()
    yield
    connections.clear()
    dev_users.clear()
