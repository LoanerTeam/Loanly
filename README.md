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

## F2: connection and online users

Until F1 lands, start the backend with `DEV_AUTH=1` in its environment
(e.g. `DEV_AUTH=1 .venv/bin/uvicorn app.main:app --reload` from `backend/`).
Start Vite from `frontend/` with `npm run dev`; its development-only form accepts
usernames such as `alice` and `bob`. For two computers, run Vite with
`npm run dev -- --host 0.0.0.0` and open the host computer's LAN address on port
5173. Both `/ws` connections go through Vite's backend proxy.

Check that both users appear, a second tab for `bob` keeps Bob online when one
tab closes, and closing Bob's last tab marks Bob offline for Alice. Restart the
backend and verify automatic reconnect and a fresh user list. Development users
are kept only in memory; registered users will come from MongoDB after F1.

F1 can pass its JWT to `PresenceApp` and call
`await announce_new_user(username)` from `app.chat.hub` after saving a new user.
The production build does not expose the development username form.
