import asyncio

from app.chat.groups import list_groups
from app.chat.hub import Connection, _remove, broadcast, connections, dev_users, presence_lock
from app.chat.repo import list_private_rooms, unread_counts
from app.config import settings
from app.db import get_db


async def registered_usernames() -> set[str]:
    if settings.dev_auth:
        return set(dev_users)
    cursor = get_db().users.find({}, {"_id": 0, "username": 1})
    return {user["username"] async for user in cursor}


async def initialize(conn: Connection) -> None:
    async with presence_lock:
        async with asyncio.timeout(5):
            names = await registered_usernames()
            groups = await list_groups()
            private_rooms = await list_private_rooms(conn.username)
            unread = await unread_counts(conn.username)
        first = not connections.get(conn.username)
        if settings.dev_auth:
            dev_users.add(conn.username)
            names.update(dev_users)
        names.update(connections)
        names.add(conn.username)
        connections.setdefault(conn.username, []).append(conn)
        try:
            await conn.send(
                "init",
                me=conn.username,
                users=[{"username": name, "online": bool(connections.get(name))}
                       for name in sorted(names)],
                rooms=private_rooms + [group for group in groups if conn.username in group["members"]],
                groups=groups, unread=unread,
            )
        except BaseException:
            # Roll back before releasing the lock, including task cancellation.
            _remove(conn)
            raise
        if first:
            await broadcast("presence", username=conn.username, online=True)
