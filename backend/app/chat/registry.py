from collections.abc import Awaitable, Callable

from app.chat.hub import Connection

Handler = Callable[[Connection, dict], Awaitable[None]]
handlers: dict[str, Handler] = {}


def handler(type: str):
    """Register a WebSocket frame handler: `@handler("message.send")`. One file per feature."""

    def wrap(fn: Handler) -> Handler:
        handlers[type] = fn
        return fn

    return wrap
