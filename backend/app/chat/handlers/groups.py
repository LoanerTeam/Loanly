from app.chat import groups, hub
from app.chat.hub import ChatError, Connection
from app.chat.registry import handler


@handler("group.create")
async def create(conn: Connection, frame: dict) -> None:
    name = frame.get("name")
    if not isinstance(name, str) or not name.strip():
        raise ChatError("invalid_text", "Group name must not be blank")
    # Same lock as init: subscribers cannot miss a committed Group or see it before init.
    async with hub.presence_lock:
        group = await groups.create_group(name.strip(), conn.username)
        await hub.broadcast("group.upsert", requester=conn, req_id=frame.get("reqId"), group=group)
