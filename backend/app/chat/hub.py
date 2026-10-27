from dataclasses import dataclass, field

from fastapi import WebSocket


@dataclass
class Connection:
    username: str
    ws: WebSocket
    id: int = field(default_factory=lambda: next(_ids))

    async def send(self, type: str, **payload) -> None:
        await self.ws.send_json({"type": type, **payload})


class ChatError(Exception):
    """Raised by a handler; the dispatcher turns it into an `error` frame."""

    def __init__(self, code: str, detail: str = ""):
        self.code, self.detail = code, detail


_ids = iter(range(1, 1 << 62))

# username -> live connections (a user may have several tabs). F2 fills presence logic.
connections: dict[str, list[Connection]] = {}
