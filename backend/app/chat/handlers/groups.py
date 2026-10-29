from fastapi import WebSocketDisconnect

from app.chat import groups, hub, repo
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


@handler("group.join")
async def join(conn: Connection, frame: dict) -> None:
    group_id = frame.get("groupId")
    if not isinstance(group_id, str):
        raise ChatError("not_found", "no such Group")
    async with hub.presence_lock:
        # Read before joining: earlier history is visible but not Unread for the new Member.
        seen = await repo.latest_message_id(group_id)
        group, joined = await groups.join_group(group_id, conn.username)
        if joined:
            if seen is not None:
                await repo.set_read_marker(conn.username, group_id, seen)
            await hub.broadcast("group.upsert", group=group)
        # Every tab of the joiner gets the room; only the requesting tab gets the reqId.
        for tab in list(hub.connections.get(conn.username, [conn])):
            reply = {"reqId": frame.get("reqId")} if tab is conn else {}
            try:
                await tab.send("room.upsert", room=group, **reply)
            except (OSError, RuntimeError, TimeoutError, WebSocketDisconnect):
                pass  # that tab is gone; its own receive loop cleans it up
