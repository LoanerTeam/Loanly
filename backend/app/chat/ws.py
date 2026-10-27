import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.chat import handlers as _handlers  # noqa: F401  (registers handlers)
from app.chat.hub import ChatError, Connection, connections
from app.chat.registry import handlers
from app.deps import verify_token

router = APIRouter()


@router.websocket("/ws")
async def ws_endpoint(ws: WebSocket, token: str = ""):
    username = verify_token(token)
    if username is None:
        await ws.close(code=4401)
        return
    await ws.accept()
    conn = Connection(username=username, ws=ws)
    connections.setdefault(username, []).append(conn)
    try:
        while True:
            raw = await ws.receive_text()
            await dispatch(conn, raw)
    except WebSocketDisconnect:
        pass
    finally:
        connections[username].remove(conn)
        if not connections[username]:
            del connections[username]


async def dispatch(conn: Connection, raw: str) -> None:
    req_id = None
    try:
        msg = json.loads(raw)
        if not isinstance(msg, dict):
            raise TypeError
        req_id = msg.get("reqId")
        fn = handlers.get(msg.get("type"))
        if fn is None:
            raise ChatError("not_found", "unknown frame type")
        await fn(conn, msg)
    except (ValueError, TypeError):
        await conn.send("error", code="invalid_text", detail="malformed frame", reqId=req_id)
    except ChatError as e:
        await conn.send("error", code=e.code, detail=e.detail, reqId=req_id)
