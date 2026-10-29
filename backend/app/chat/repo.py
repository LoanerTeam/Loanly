from datetime import UTC, datetime

from bson import ObjectId
from bson.errors import InvalidId

from app.db import get_db


def room_dto(room: dict, viewer: str) -> dict:
    """Contract `Room`; a private room is named after the other user."""
    name = room["name"]
    if room["kind"] == "private":
        name = next(m for m in room["members"] if m != viewer)
    return {
        "id": str(room["_id"]),
        "kind": room["kind"],
        "name": name,
        "members": room["members"],
        "creator": room.get("creator"),
    }


def message_dto(msg: dict) -> dict:
    return {
        "id": str(msg["_id"]),
        "roomId": msg["roomId"],
        "sender": msg["sender"],
        "text": msg["text"],
        "ts": msg["ts"],
    }


async def get_or_create_private_room(a: str, b: str) -> dict:
    members = sorted([a, b])
    return await get_db().rooms.find_one_and_update(
        {"pairKey": "|".join(members)},
        {"$setOnInsert": {"kind": "private", "name": "", "members": members, "creator": None}},
        upsert=True,
        return_document=True,
    )


async def get_room(room_id: str) -> dict | None:
    try:
        oid = ObjectId(room_id)
    except (InvalidId, TypeError):
        return None
    return await get_db().rooms.find_one({"_id": oid})


async def add_message(room_id: str, sender: str, text: str) -> dict:
    msg = {
        "roomId": room_id,
        "sender": sender,
        "text": text,
        "ts": datetime.now(UTC).isoformat(),
    }
    msg["_id"] = (await get_db().messages.insert_one(msg)).inserted_id
    return msg


async def list_messages(room_id: str) -> list[dict]:
    # shortcut: full history in one frame, add paging when rooms get long
    return await get_db().messages.find({"roomId": room_id}).sort("_id", 1).to_list(None)


async def list_private_rooms(username: str) -> list[dict]:
    cursor = get_db().rooms.find({"kind": "private", "members": username})
    return [room_dto(room, username) async for room in cursor]


async def set_read_marker(username: str, room_id: str, message_id: ObjectId) -> None:
    # $max keeps the marker monotonic: a late or replayed mark never moves it backwards.
    await get_db().read_markers.update_one(
        {"username": username, "roomId": room_id}, {"$max": {"messageId": message_id}}, upsert=True
    )


async def message_in_room(room_id: str, message_id: str) -> ObjectId | None:
    try:
        oid = ObjectId(message_id)
    except (InvalidId, TypeError):
        return None
    found = await get_db().messages.find_one({"_id": oid, "roomId": room_id}, {"_id": 1})
    return oid if found else None


async def unread_counts(username: str) -> dict[str, int]:
    """Messages from others after the user's read marker, per room; rooms with none are omitted."""
    db = get_db()
    counts: dict[str, int] = {}
    async for room in db.rooms.find({"members": username}, {"_id": 1}):
        room_id = str(room["_id"])
        marker = await db.read_markers.find_one({"username": username, "roomId": room_id})
        query: dict = {"roomId": room_id, "sender": {"$ne": username}}
        if marker:
            query["_id"] = {"$gt": marker["messageId"]}
        count = await db.messages.count_documents(query)
        if count:
            counts[room_id] = count
    return counts
