import asyncio
from dataclasses import dataclass, field

from fastapi import WebSocket, WebSocketDisconnect


@dataclass
class Connection:
    username: str
    ws: WebSocket
    id: int = field(default_factory=lambda: next(_ids))

    async def send(self, type: str, **payload) -> None:
        async with asyncio.timeout(5):
            await self.ws.send_json({"type": type, **payload})


class ChatError(Exception):
    """Raised by a handler; the dispatcher turns it into an error frame."""

    def __init__(self, code: str, detail: str = ""):
        self.code, self.detail = code, detail


_ids = iter(range(1, 1 << 62))
connections: dict[str, list[Connection]] = {}
# Serialize snapshots with presence changes so init is always the first frame.
presence_lock = asyncio.Lock()
dev_users: set[str] = set()


def _remove(conn: Connection) -> bool:
    active = connections.get(conn.username, [])
    if conn not in active:
        return False
    active.remove(conn)
    if not active:
        connections.pop(conn.username, None)
        return True
    return False


async def broadcast(type: str, **payload) -> None:
    """Best-effort fanout. Caller holds presence_lock for presence transitions."""
    async def deliver(conn: Connection) -> None:
        try:
            await conn.send(type, **payload)
        except (OSError, RuntimeError, TimeoutError, WebSocketDisconnect):
            failed.append(conn)

    failed: list[Connection] = []
    await asyncio.gather(*(deliver(conn) for active in list(connections.values())
                           for conn in list(active)))
    offline = {conn.username for conn in failed if _remove(conn)}
    for conn in failed:
        try:
            async with asyncio.timeout(1):
                await conn.ws.close(code=1011)
        except (OSError, RuntimeError, TimeoutError, WebSocketDisconnect):
            pass
    for username in offline:
        await broadcast("presence", username=username, online=False)


async def disconnect(conn: Connection) -> None:
    async with presence_lock:
        if _remove(conn):
            await broadcast("presence", username=conn.username, online=False)


async def announce_new_user(username: str) -> None:
    """F1 calls this after persisting registration; never writes auth data."""
    async with presence_lock:
        await broadcast("presence", username=username, online=bool(connections.get(username)))
