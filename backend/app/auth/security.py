import base64
import hashlib
from datetime import UTC, datetime, timedelta

import bcrypt
import jwt

from app.auth.schemas import USERNAME
from app.config import settings

HASH_SCHEME = "bcrypt-sha256$"
TOKEN_LIFETIME = timedelta(hours=1)
# A failed login still performs bcrypt verification when the username does not exist.
DUMMY_HASH = HASH_SCHEME + bcrypt.hashpw(b"unused", bcrypt.gensalt()).decode("ascii")


def validate_config() -> None:
    if not settings.dev_auth and len(settings.jwt_secret.strip().encode("utf-8")) < 32:
        raise RuntimeError("Set JWT_SECRET to a random secret of at least 32 bytes")


def password_bytes(password: str) -> bytes:
    # pyca/bcrypt recommends base64(SHA256(password)) for its 72-byte limit.
    # https://github.com/pyca/bcrypt#maximum-password-length
    return base64.b64encode(hashlib.sha256(password.encode("utf-8")).digest())


def hash_password(password: str) -> str:
    return HASH_SCHEME + bcrypt.hashpw(password_bytes(password), bcrypt.gensalt()).decode("ascii")


def check_password(password: str, stored: str) -> bool:
    if not stored.startswith(HASH_SCHEME):
        return False
    try:
        return bcrypt.checkpw(password_bytes(password), stored.removeprefix(HASH_SCHEME).encode())
    except (ValueError, UnicodeError):
        return False


def issue_token(username: str) -> str:
    validate_config()
    now = datetime.now(UTC)
    return jwt.encode(
        {"sub": username, "iat": now, "exp": now + TOKEN_LIFETIME},
        settings.jwt_secret, algorithm="HS256",
    )


def decode_token(token: str) -> str | None:
    try:
        validate_config()
        claims = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"],
                            options={"require": ["sub", "iat", "exp"]})
        username = claims["sub"]
        if (not isinstance(username, str) or not USERNAME.fullmatch(username)
                or not isinstance(claims["iat"], (int, float))
                or not isinstance(claims["exp"], (int, float))
                or claims["exp"] <= claims["iat"]):
            return None
        return username
    except (jwt.InvalidTokenError, ValueError, TypeError, RuntimeError):
        return None
