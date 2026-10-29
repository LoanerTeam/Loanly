from app.chat import repo
from app.chat.handlers.messages import member_room
from app.chat.hub import ChatError, Connection
from app.chat.registry import handler


@handler("read.mark")
async def read_mark(conn: Connection, msg: dict) -> None:
    room = await member_room(conn, msg.get("roomId"))
    message_id = msg.get("messageId")
    oid = await repo.message_in_room(str(room["_id"]), message_id) if isinstance(message_id, str) else None
    if oid is None:
        raise ChatError("not_found", "no such message in this room")
    await repo.set_read_marker(conn.username, str(room["_id"]), oid)
