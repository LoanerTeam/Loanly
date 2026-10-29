from app.chat import repo
from app.chat.hub import ChatError, Connection, connections, send_to
from app.chat.presence import registered_usernames
from app.chat.registry import handler


@handler("dm.open")
async def dm_open(conn: Connection, msg: dict) -> None:
    other = msg.get("username")
    if not isinstance(other, str) or not other:
        raise ChatError("unknown_user")
    if other == conn.username:
        raise ChatError("forbidden", "cannot message yourself")
    if other not in await registered_usernames() and other not in connections:
        raise ChatError("unknown_user")
    room = await repo.get_or_create_private_room(conn.username, other)
    await conn.send("room.upsert", room=repo.room_dto(room, conn.username), reqId=msg.get("reqId"))
    await send_to(other, "room.upsert", room=repo.room_dto(room, other))
