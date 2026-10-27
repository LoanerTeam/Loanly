# Loanly

Chat web app for a Computer Networks course (socket programming). Start with `AGENTS.md`, then `docs/PLAN.md`, `docs/CONTRACT.md` and `docs/INTEGRATION.md`.

## Run locally
```
cp .env.example .env            # set DEV_AUTH=1 to skip login while developing
cd backend && python -m venv .venv && .venv/Scripts/pip install -r requirements-dev.txt   # Linux/Mac: .venv/bin/pip
.venv/Scripts/uvicorn app.main:app --reload        # API + WebSocket on :8000
cd frontend && npm install && npm run dev           # UI on :5173, proxies /api and /ws to :8000
```
Checks (the gate in `AGENTS.md`): `pytest`, `ruff check .`, `bandit -r app`, `pip-audit` in `backend/`; `npm test`, `npm run lint`, `npm audit --omit=dev` in `frontend/`.
