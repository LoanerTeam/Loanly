import asyncio
from functools import cache

import httpx
from fastapi import Request
from fastapi.responses import JSONResponse
from google import genai
from google.genai import errors, types

from app.config import settings

TIMEOUT = 30


class AiError(Exception):
    def __init__(self, status: int, code: str, detail: str):
        self.status, self.code, self.detail = status, code, detail


async def ai_error_handler(request: Request, error: AiError) -> JSONResponse:
    return JSONResponse(status_code=error.status, content={"error": error.code, "detail": error.detail})


@cache
def _client(api_key: str) -> genai.Client:
    # The SDK retries overloaded responses with growing delays; keep that short so a busy
    # model fails within seconds instead of running into TIMEOUT.
    retry = types.HttpRetryOptions(attempts=3, initial_delay=1, max_delay=4)
    return genai.Client(api_key=api_key, http_options=types.HttpOptions(retry_options=retry))


async def generate_text(prompt: str, *, instruction: str) -> str:
    """One Gemini text call shared by the AI features; failures become friendly AiErrors."""
    if not settings.gemini_api_key:
        raise AiError(503, "ai_unavailable", "AI features are not set up on this server.")
    try:
        async with asyncio.timeout(TIMEOUT):
            response = await _client(settings.gemini_api_key).aio.models.generate_content(
                model=settings.gemini_model, contents=prompt,
                config=types.GenerateContentConfig(system_instruction=instruction),
            )
    except errors.APIError as error:
        if error.code == 429:
            raise AiError(429, "ai_quota", "The AI quota is used up for now. Try again later.") from error
        if error.code == 503:
            raise AiError(503, "ai_busy", "The AI service is busy right now. Try again in a moment.") from error
        raise AiError(502, "ai_failed", "The AI service could not answer. Try again.") from error
    except (TimeoutError, httpx.HTTPError, OSError) as error:
        raise AiError(502, "ai_failed", "The AI service could not answer. Try again.") from error
    text = (response.text or "").strip()
    if not text:
        raise AiError(502, "ai_failed", "The AI service could not answer. Try again.")
    return text
