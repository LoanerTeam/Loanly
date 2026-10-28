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

## F4: create and list Groups

MongoDB is now required even with `DEV_AUTH=1`: it bypasses login, not persistence.
Start a local MongoDB server or set `MONGODB_URI` to your MongoDB instance. One
local option with Docker is:

```bash
docker run -d --name loanly-mongo -p 127.0.0.1:27017:27017 -v loanly-mongo-data:/data/db mongo:7
```

From `backend/`, activate your virtual environment and run
`uvicorn app.main:app --reload --env-file .env` with `DEV_AUTH=1` in that file.
The server ensures a unique `(creator, name)` Group index at startup and refuses to start if
MongoDB is unavailable or existing data prevents index creation. Group names
are trimmed and case-sensitive (`team` and `Team` are distinct). A Creator cannot
reuse a Group name, but different Creators can. Startup creates the replacement
index before removing the legacy global Group-name index; existing Groups are preserved.

Connect as `alice` and `bob` in separate browser tabs. Alice creates `team`;
both users should see the Group with Creator Alice and Members `alice`. Bob
can see the Group without joining it. Creating `team` again should show a name
error for Alice; Bob can create his own `team`, and both Groups should appear
with their respective Creators. Refresh either tab or restart the backend using the same database: the
Group list should be restored. Joining and Group chat are part of F5.

Run ordinary backend tests with `pytest`. To include real MongoDB uniqueness,
concurrent creation and persistence checks, use a disposable MongoDB server:

```bash
LOANLY_TEST_MONGODB_URI=mongodb://localhost:27017 pytest
```

Integration tests create and drop their own randomly named `loanly_test_*`
database. Without that variable the MongoDB integration test is explicitly
skipped; unit tests still run. CI supplies a MongoDB service for this test.
