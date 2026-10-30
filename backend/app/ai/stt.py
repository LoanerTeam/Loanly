from fastapi import APIRouter, Depends, UploadFile
from google.genai import types
from pydantic import BaseModel

from app.ai import gemini
from app.config import settings
from app.deps import get_current_user

router = APIRouter()
MAX_BYTES = 10 * 1024 * 1024  # ~10 MB: minutes of speech, well under the model limit
MAX_TEXT = 2000  # chat message limit, so the transcript always fits the chat box
# MIME type -> (offset, signature) of the container header. The browser-supplied type is
# untrusted, so the bytes must also look like the claimed container.
CONTAINERS = {
    "audio/webm": (0, b"\x1a\x45\xdf\xa3"),
    "audio/ogg": (0, b"OggS"),
    "audio/wav": (8, b"WAVE"),
    "audio/x-wav": (8, b"WAVE"),
    "audio/mp4": (4, b"ftyp"),  # Safari records MP4
}


class SttResponse(BaseModel):
    text: str


def check_audio(mime: str, data: bytes) -> str:
    base = mime.split(";")[0].strip().lower()
    container = CONTAINERS.get(base)
    if container is None:
        raise gemini.AiError(415, "unsupported_audio", "Upload a webm, ogg, wav or mp4 recording.")
    if not data:
        raise gemini.AiError(400, "empty_audio", "The recording is empty.")
    if len(data) > MAX_BYTES:
        raise gemini.AiError(413, "audio_too_large", "The recording is too long. Keep it under a few minutes.")
    offset, signature = container
    if data[offset:offset + len(signature)] != signature:
        raise gemini.AiError(415, "unsupported_audio", "That file is not a valid audio recording.")
    return base


@router.post("/stt", response_model=SttResponse)
async def speech_to_text(audio: UploadFile, username: str = Depends(get_current_user)) -> dict:
    data = await audio.read(MAX_BYTES + 1)  # never buffer more than the limit plus one byte
    mime = check_audio(audio.content_type or "", data)
    part = types.Part.from_bytes(data=data, mime_type=mime)
    # The transcribe model takes no system instruction and only transcribes. There is no
    # fallback to a chat model: given silence it would answer instead of transcribing.
    text = await gemini.generate([part], model=settings.gemini_stt_model, allow_empty=True)
    if not text:
        raise gemini.AiError(422, "no_speech", "No speech was detected. Try again, closer to the microphone.")
    return {"text": text[:MAX_TEXT]}
