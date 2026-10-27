from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.chat.ws import router as ws_router

app = FastAPI(title="Loanly")
app.include_router(ws_router)
# F1: app.include_router(auth_router, prefix="/api")   F8-F11: app.include_router(ai_router, prefix="/api/ai")


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if dist.is_dir():  # must stay last so it does not shadow /api and /ws
    app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")
