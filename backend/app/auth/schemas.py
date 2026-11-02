from typing import Literal

from pydantic import BaseModel, Field, SecretStr, field_validator

Language = Literal["en", "th", "ja", "zh", "ko", "es", "fr", "de"]


def normalize_username(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("Username cannot be blank")
    value.encode("utf-8")  # Reject invalid Unicode before writing to MongoDB.
    return value


class Credentials(BaseModel):
    username: str = Field(strict=True)
    password: SecretStr = Field(min_length=8)

    @field_validator("username")
    @classmethod
    def valid_username(cls, value: str) -> str:
        return normalize_username(value)

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
