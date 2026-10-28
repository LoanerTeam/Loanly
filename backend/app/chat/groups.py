import asyncio

from pymongo.errors import DuplicateKeyError

from app.chat.hub import ChatError
from app.db import get_db


async def ensure_indexes() -> None:
    async with asyncio.timeout(5):
        rooms = get_db().rooms
        # Establish the replacement constraint before removing the legacy one.
        await rooms.create_index(
            [("creator", 1), ("name", 1)], unique=True, name="unique_group_creator_name",
            partialFilterExpression={"kind": "group"},
        )
        indexes = await rooms.index_information()
        legacy = indexes.get("unique_group_name")
        if legacy is not None:
            if (legacy.get("key") != [("name", 1)] or not legacy.get("unique")
                    or legacy.get("partialFilterExpression") != {"kind": "group"}):
                raise RuntimeError("Unexpected legacy Group index; manual migration required")
            await rooms.drop_index("unique_group_name")


def serialize(document: dict) -> dict:
    return {"id": str(document["_id"]), "kind": "group", "name": document["name"],
            "members": document["members"], "creator": document["creator"]}


async def list_groups() -> list[dict]:
    async with asyncio.timeout(5):
        return [serialize(document) async for document in
                get_db().rooms.find({"kind": "group"}).sort([("name", 1), ("_id", 1)])]


async def create_group(name: str, creator: str) -> dict:
    document = {"kind": "group", "name": name, "members": [creator], "creator": creator}
    try:
        async with asyncio.timeout(5):
            result = await get_db().rooms.insert_one(document)
    except DuplicateKeyError as error:
        raise ChatError("name_taken", "You already created a Group with this name") from error
    document["_id"] = result.inserted_id
    return serialize(document)
