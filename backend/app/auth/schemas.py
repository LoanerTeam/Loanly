import re
from typing import Literal

from pydantic import BaseModel, Field, SecretStr, field_validator

USERNAME = re.compile(r"[a-z0-9_]{3,20}")
Language = Literal["en", "th", "ja", "zh", "ko", "es", "fr", "de"]


class Credentials(BaseModel):
    username: str = Field(strict=True)
    password: SecretStr = Field(min_length=8)

    @field_validator("username")
    @classmethod
    def valid_username(cls, value: str) -> str:
        if not USERNAME.fullmatch(value):
            raise ValueError("Username must be 3–20 lowercase letters, numbers or underscores")
        return value

    @field_validator("password")
    @classmethod
    def valid_password(cls, value: SecretStr) -> SecretStr:
        # Reject invalid Unicode before hashing; do not trim or truncate passwords.
        value.get_secret_value().encode("utf-8")
        return value


class TokenResponse(BaseModel):
    token: str


class Profile(BaseModel):
    username: str
    targetLang: Language


class ProfileUpdate(BaseModel):
    targetLang: Language
