import time

from fastapi import APIRouter, Depends, Response
from starlette.concurrency import run_in_threadpool

from app.auth import repo, security
from app.auth.errors import AuthError
from app.auth.schemas import Credentials, Profile, ProfileUpdate, TokenResponse
from app.chat.hub import announce_new_user
from app.deps import get_current_user


def prevent_caching(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


# shortcut: in-memory, valid while the server runs as one instance (ADR 0003).
MAX_FAILURES, WINDOW = 10, 15 * 60
failures: dict[str, list[float]] = {}


def recent_failures(username: str) -> list[float]:
    now = time.monotonic()
    if len(failures) > 10_000:  # forget stale Usernames so the map cannot grow forever
        for name in [n for n, times in failures.items() if now - times[-1] >= WINDOW]:
            del failures[name]
    times = [t for t in failures.pop(username, []) if now - t < WINDOW]
    if times:
        failures[username] = times
    return times


router = APIRouter(dependencies=[Depends(prevent_caching)])


@router.post("/auth/register", response_model=TokenResponse, status_code=201)
async def register(body: Credentials) -> dict:
    # Validate signing configuration before persisting an account.
    token = security.issue_token(body.username)
    hashed = await run_in_threadpool(security.hash_password, body.password.get_secret_value())
    await repo.create_user(body.username, hashed)
    await announce_new_user(body.username)
    return {"token": token}


@router.post("/auth/login", response_model=TokenResponse)
async def login(body: Credentials) -> dict:
    if len(recent_failures(body.username)) >= MAX_FAILURES:
        raise AuthError(429, "too_many_attempts", "Too many failed sign-ins. Try again in 15 minutes.")
    user = await repo.find_user(body.username)
    valid = await run_in_threadpool(
        security.check_password, body.password.get_secret_value(),
        user["passwordHash"] if user else security.DUMMY_HASH,
    )
    if not valid or user is None:
        failures.setdefault(body.username, []).append(time.monotonic())
        raise AuthError(401, "invalid_credentials", "Incorrect Username or Password.")
    return {"token": security.issue_token(body.username)}


@router.get("/me", response_model=Profile)
async def me(username: str = Depends(get_current_user)) -> dict:
    user = await repo.find_user(username)
    if user is None:
        raise AuthError(401, "invalid_token", "Please sign in again.")
    return user


@router.put("/me", response_model=Profile)
async def update_me(body: ProfileUpdate, username: str = Depends(get_current_user)) -> dict:
    user = await repo.update_language(username, body.targetLang)
    if user is None:
        raise AuthError(401, "invalid_token", "Please sign in again.")
    return user
