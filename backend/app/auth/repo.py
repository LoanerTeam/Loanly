import asyncio

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError, PyMongoError

from app.auth.errors import AuthError
from app.db import get_db


async def ensure_indexes() -> None:
    async with asyncio.timeout(5):
        await get_db().users.create_index("username", unique=True, name="unique_username")


async def find_user(username: str) -> dict | None:
    try:
        async with asyncio.timeout(5):
            return await get_db().users.find_one({"username": username})
    except (PyMongoError, TimeoutError) as error:
        raise AuthError(503, "unavailable", "Accounts are temporarily unavailable. Try again.") from error


async def create_user(username: str, password_hash: str) -> None:
    try:
        async with asyncio.timeout(5):
            await get_db().users.insert_one({
                "username": username, "passwordHash": password_hash, "targetLang": "en",
            })
    except DuplicateKeyError as error:
        raise AuthError(409, "name_taken", "That Username is already registered.") from error
    except (PyMongoError, TimeoutError) as error:
        raise AuthError(503, "unavailable", "Accounts are temporarily unavailable. Try again.") from error


async def update_language(username: str, language: str) -> dict | None:
    try:
        async with asyncio.timeout(5):
            return await get_db().users.find_one_and_update(
                {"username": username}, {"$set": {"targetLang": language}},
                return_document=ReturnDocument.AFTER,
            )
    except (PyMongoError, TimeoutError) as error:
        raise AuthError(503, "unavailable", "Accounts are temporarily unavailable. Try again.") from error
