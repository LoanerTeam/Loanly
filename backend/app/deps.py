from fastapi import Header

from app.auth.errors import AuthError
from app.auth.schemas import normalize_username
from app.auth.security import decode_token
from app.config import settings


def verify_token(token: str) -> str | None:
    """Shared synchronous token validation for REST and WebSocket handshakes."""
    # Try real JWTs first: a flexible development Username can itself contain dots.
    username = decode_token(token)
    if username is not None:
        return username
    if settings.dev_auth:
        try:
            return normalize_username(token)
        except ValueError:
            return None
    return None


def get_current_user(authorization: str = Header(default="")) -> str:
    scheme, separator, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not separator or not token or token != token.strip():
        raise AuthError(401, "invalid_token", "Please sign in again.")
    username = verify_token(token)
    if username is None:
        raise AuthError(401, "invalid_token", "Please sign in again.")
    return username
