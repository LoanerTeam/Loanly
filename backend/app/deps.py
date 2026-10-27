from fastapi import Header, HTTPException

from app.config import settings


def verify_token(token: str) -> str | None:
    """Return the username for a token, or None if invalid. F1 replaces the body with JWT checks."""
    if settings.dev_auth and token:
        return token
    return None  # TODO(F1): decode and verify the JWT


def get_current_user(authorization: str = Header(default="")) -> str:
    username = verify_token(authorization.removeprefix("Bearer ").strip())
    if username is None:
        raise HTTPException(status_code=401, detail="invalid token")
    return username
