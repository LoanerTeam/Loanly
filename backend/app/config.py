import os

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    mongodb_uri: str = "mongodb://localhost:27017"
    mongodb_db: str = "loanly"
    jwt_secret: str = "change-me"
    gemini_api_key: str = ""
    dev_auth: bool = False


settings = Settings()

# A dev token is just a username, so it must never reach a deployed service.
if settings.dev_auth and os.environ.get("RENDER"):
    raise RuntimeError("DEV_AUTH must not be enabled on Render")
