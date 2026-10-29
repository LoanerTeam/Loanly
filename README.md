# Loanly

Chat web app for a Computer Networks course (socket programming). Start with `AGENTS.md`, then `docs/PLAN.md`, `docs/CONTRACT.md` and `docs/INTEGRATION.md`.

## Run locally
```
cp .env.example .env            # set JWT_SECRET to a generated random value; keep DEV_AUTH=0
cd backend && python -m venv .venv && .venv/Scripts/pip install -r requirements-dev.txt   # Linux/Mac: .venv/bin/pip
.venv/Scripts/uvicorn app.main:app --reload --env-file ../.env  # API + WebSocket on :8000
cd frontend && npm install && npm run dev           # UI on :5173, proxies /api and /ws to :8000
```
Run the backend and frontend commands in separate terminals from their respective
directories. MongoDB must be available at `MONGODB_URI` (see the Docker example below).
Generate a signing secret with
`python -c "import secrets; print(secrets.token_urlsafe(48))"`, then put it in the
root `.env` as `JWT_SECRET`. Real auth requires at least 32 bytes and startup
creates a unique Username index. Do not commit your `.env`.

Register or sign in in the browser. Tokens are stored per tab and verified on
reload. Log out disconnects that tab and clears its account and chat data.
For a production-style local check, run `npm run build` in `frontend/` and open
`http://localhost:8000`; restart the backend after the first build if necessary.
Auth behavior, errors, and tests are described in [docs/F1-AUTH.md](docs/F1-AUTH.md).
Checks (the gate in `AGENTS.md`): `pytest`, `ruff check .`, `bandit -r app`, `pip-audit` in `backend/`; `npm test`, `npm run lint`, `npm audit --omit=dev` in `frontend/`.

## F2: connection and online users

For development without accounts, start the backend with `DEV_AUTH=1` in its
environment. Also set `VITE_DEV_AUTH=1` in the frontend terminal before starting
Vite, or copy `frontend/.env.example` to the git-ignored `frontend/.env` and set it
there. On PowerShell use
`$env:VITE_DEV_AUTH='1'; npm run dev` from `frontend/`. Both flags are explicit:
normal `npm run dev` shows real Login/Register. The development-only form accepts
usernames such as `alice` and `bob`. For two computers, run Vite with
`npm run dev -- --host 0.0.0.0` and open the host computer's LAN address on port
5173. Both `/ws` connections go through Vite's backend proxy.

Check that both users appear, a second tab for `bob` keeps Bob online when one
tab closes, and closing Bob's last tab marks Bob offline for Alice. Restart the
backend and verify automatic reconnect and a fresh user list. Development users
are kept only in memory; registered users will come from MongoDB after F1.

Auth now supplies its verified JWT to `PresenceApp` and calls
`await announce_new_user(username)` after saving a new user. Disable both
development flags for real-auth integration. The production build always uses
real Login/Register and does not expose the development Username form.

## F4: create and list Groups

MongoDB is now required even with `DEV_AUTH=1`: it bypasses login, not persistence.
Start a local MongoDB server or set `MONGODB_URI` to your MongoDB instance. One
local option with Docker is:

```bash
docker run -d --name loanly-mongo -p 127.0.0.1:27017:27017 -v loanly-mongo-data:/data/db mongo:7
```

From `backend/`, activate your virtual environment and run
`uvicorn app.main:app --reload --env-file ../.env` with `DEV_AUTH=1` in the root file
and the frontend development flag enabled as described above.
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

## F5: join Groups and chat

Start the backend and frontend as described for F4 (MongoDB is required). Connect
as `alice`, `bob` and `carol` in separate browser tabs. Alice creates `team` and
sends a few messages in it. Group members see **Open** on the Group; everyone
else sees **Join**.

Bob clicks **Join**: he becomes a Member by himself, his Chat Room for `team`
opens, and every user's Group list shows Members `alice, bob`. Nobody can add
another user, so Carol is not added. Bob sees the Group's full history, but
messages sent before he joined are not counted as Unread; only later messages
from others are. Alice's new messages appear live for Alice and Bob only. Carol
never receives them; a `message.send` or `history.get` for the Group from her
console returns `not_member`. Joining again is harmless, and every open tab of
the joining user gets the room. Leaving and deleting Groups are part of F6.

`backend/tests/test_group_join.py` covers these rules over a real `/ws`
connection with an in-memory database, so plain `pytest` runs it.
