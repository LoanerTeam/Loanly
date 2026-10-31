import os

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    mongodb_uri: str = "mongodb://localhost:27017"
    mongodb_db: str = "loanly"
    jwt_secret: str = "change-me"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.5-flash-lite"
    gemini_stt_model: str = "gemini-3.5-transcribe"
    gemini_tts_model: str = "gemini-3.8-flash-tts"
    # Requests per minute / per day for each Gemini model; match your AI Studio free-tier limits.
    ai_text_rpm: int = 10
    ai_text_rpd: int = 500
    ai_stt_rpm: int = 3
    ai_stt_rpd: int = 100
    ai_tts_rpm: int = 3
    ai_tts_rpd: int = 15
    dev_auth: bool = False


settings = Settings()

# A dev token is just a username, so it must never reach a deployed service.
if settings.dev_auth and os.environ.get("RENDER"):
    raise RuntimeError("DEV_AUTH must not be enabled on Render")
