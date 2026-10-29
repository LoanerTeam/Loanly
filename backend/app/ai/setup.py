from fastapi import FastAPI

from app.ai import summarize, translate
from app.ai.gemini import AiError, ai_error_handler


def install_ai(app: FastAPI) -> None:
    """Register before the static frontend mount. Each AI feature adds its own router here."""
    app.include_router(summarize.router, prefix="/api/ai")
    app.include_router(translate.router, prefix="/api/ai")
    app.add_exception_handler(AiError, ai_error_handler)
