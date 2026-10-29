from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.ai.setup import install_ai
from app.auth.setup import initialize_auth, install_auth
from app.chat import groups
from app.chat.ws import router as ws_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    await initialize_auth()
    await groups.ensure_indexes()
    yield


app = FastAPI(title="Loanly", lifespan=lifespan)
install_auth(app)
app.include_router(ws_router)
install_ai(app)  # F8-F11


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if dist.is_dir():  # must stay last so it does not shadow /api and /ws
    app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")
