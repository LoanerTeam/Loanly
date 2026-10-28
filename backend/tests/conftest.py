import asyncio

import pytest

from app.chat import hub, presence
from app.chat.hub import connections, dev_users


@pytest.fixture(autouse=True)
def clear_presence(monkeypatch):
    lock = asyncio.Lock()
    monkeypatch.setattr(hub, "presence_lock", lock)
    monkeypatch.setattr(presence, "presence_lock", lock)
    connections.clear()
    dev_users.clear()
    yield
    connections.clear()
    dev_users.clear()
