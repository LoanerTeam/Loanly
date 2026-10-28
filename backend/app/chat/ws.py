import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pymongo.errors import PyMongoError

from app.chat import handlers as _handlers  # noqa: F401  (registers handlers)
from app.chat.hub import ChatError, Connection, disconnect
from app.chat.presence import initialize
from app.chat.registry import handlers
from app.deps import verify_token

router = APIRouter()


@router.websocket("/ws")
async def ws_endpoint(ws: WebSocket, token: str = ""):
    username = verify_token(token)
    if username is None:
        # Accept only to deliver the contract close code to browser clients.
        await ws.accept()
        await ws.close(code=4401)
        return
    await ws.accept()
    conn = Connection(username=username, ws=ws)
    try:
        await initialize(conn)
        while True:
            raw = await ws.receive_text()
            await dispatch(conn, raw)
    except WebSocketDisconnect:
        pass
    except (OSError, RuntimeError, TimeoutError, PyMongoError):
        try:
            await ws.close(code=1011)
        except (OSError, RuntimeError):
            pass
    finally:
        await disconnect(conn)


async def dispatch(conn: Connection, raw: str) -> None:
    req_id = None
    try:
        msg = json.loads(raw)
        if not isinstance(msg, dict):
            raise TypeError
        req_id = msg.get("reqId")
        frame_type = msg.get("type")
        if not isinstance(frame_type, str):
            raise TypeError
        fn = handlers.get(frame_type)
        if fn is None:
            raise ChatError("not_found", "unknown frame type")
        await fn(conn, msg)
    except (ValueError, TypeError):
        await conn.send("error", code="invalid_text", detail="malformed frame", reqId=req_id)
    except ChatError as e:
        await conn.send("error", code=e.code, detail=e.detail, reqId=req_id)
