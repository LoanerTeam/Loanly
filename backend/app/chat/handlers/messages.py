from app.chat import repo
from app.chat.hub import ChatError, Connection, send_to
from app.chat.registry import handler

MAX_TEXT = 2000


async def member_room(conn: Connection, room_id) -> dict:
    room = await repo.get_room(room_id) if isinstance(room_id, str) else None
    if room is None:
        raise ChatError("not_found", "no such room")
    if conn.username not in room["members"]:
        raise ChatError("not_member")
    return room


@handler("message.send")
async def message_send(conn: Connection, msg: dict) -> None:
    text = msg.get("text")
    if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT:
        raise ChatError("invalid_text", f"text must be 1-{MAX_TEXT} characters")
    room = await member_room(conn, msg.get("roomId"))
    saved = repo.message_dto(await repo.add_message(str(room["_id"]), conn.username, text))
    for member in room["members"]:
        await send_to(member, "message.new", message=saved)


@handler("history.get")
async def history_get(conn: Connection, msg: dict) -> None:
    room = await member_room(conn, msg.get("roomId"))
    messages = [repo.message_dto(m) for m in await repo.list_messages(str(room["_id"]))]
    await conn.send("history", roomId=str(room["_id"]), messages=messages, reqId=msg.get("reqId"))
