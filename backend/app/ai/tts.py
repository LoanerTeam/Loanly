import asyncio
import base64
import binascii
import io
import wave

import httpx
from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field, field_validator

from app.ai.gemini import TIMEOUT, AiError
from app.config import settings
from app.deps import get_current_user

router = APIRouter()
URL = "https://generativelanguage.googleapis.com/v1beta/interactions"
MAX_AUDIO_BYTES = 20 * 1024 * 1024


class TtsRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)

    @field_validator("text")
    @classmethod
    def not_blank(cls, text: str) -> str:
        if not text.strip():
            raise ValueError("Text must not be blank")
        return text


def failed() -> AiError:
    return AiError(502, "ai_failed", "Could not create speech. Please try again.")


def wav_audio(body: dict) -> bytes:
    """Interactions returns base64 WAV in the last model-output audio block."""
    try:
        blocks = [
            block for step in body.get("steps", []) if step.get("type") == "model_output"
            for block in step.get("content", []) if block.get("type") == "audio"
        ]
        block = blocks[-1]
        encoded = block["data"]
        if block.get("mime_type") != "audio/wav" or len(encoded) > MAX_AUDIO_BYTES * 4 // 3 + 4:
            raise ValueError("Invalid audio")
        data = base64.b64decode(encoded, validate=True)
        with wave.open(io.BytesIO(data), "rb") as audio:
            frames = audio.getnframes()
            expected = frames * audio.getnchannels() * audio.getsampwidth()
            if not frames or len(audio.readframes(frames)) != expected:
                raise ValueError("Empty or truncated WAV")
        return data
    except (KeyError, IndexError, TypeError, ValueError, AttributeError,
            binascii.Error, wave.Error, EOFError) as error:
        raise failed() from error


async def generate_speech(text: str) -> bytes:
    if not settings.gemini_api_key:
        raise AiError(503, "ai_unavailable", "AI features are not set up on this server.")
    try:
        # The Interactions REST API avoids relying on the SDK's private error classes.
        async with asyncio.timeout(TIMEOUT), httpx.AsyncClient(timeout=TIMEOUT) as client:
            response = await client.post(URL, headers={"x-goog-api-key": settings.gemini_api_key}, json={
                "model": settings.gemini_tts_model,
                "input": [{"type": "user_input", "content": [{"type": "text", "text": text}]}],
                "response_format": {"type": "audio"},
                "generation_config": {"speech_config": [{"voice": "Kore"}]},
                "store": False,
            })
            response.raise_for_status()
            return wav_audio(response.json())
    except httpx.HTTPStatusError as error:
        if error.response.status_code == 429:
            raise AiError(429, "ai_quota", "The AI quota is used up for now. Try again later.") from error
        if error.response.status_code == 503:
            raise AiError(503, "ai_busy", "The AI service is busy. Try again in a moment.") from error
        raise failed() from error
    except (TimeoutError, httpx.HTTPError, OSError, ValueError) as error:
        raise failed() from error


@router.post("/tts")
async def text_to_speech(body: TtsRequest, username: str = Depends(get_current_user)) -> Response:
    return Response(await generate_speech(body.text), media_type="audio/wav",
                    headers={"Cache-Control": "no-store"})
