# Plan: four people in parallel

Stack: FastAPI + Motor + `google-genai` (backend), Vite + React + TypeScript + Tailwind (frontend), MongoDB Atlas M0, Render free. See `docs/adr/` and `GLOSSARY.md`.

## Step 0 — scaffold (one person, ~1 hour, everyone waits)
Create the skeleton so nobody touches the same file later:
```
backend/app/main.py        # mounts routers, serves frontend/dist
backend/app/db.py          # get_db() (Motor)
backend/app/deps.py        # get_current_user() -> username   [STUB: returns "test"; P2 replaces]
backend/app/auth/          # P2
backend/app/chat/          # P1  (ws.py, hub.py, repo.py, rooms.py)
backend/app/ai/            # P4
backend/tests/
frontend/src/{api,ws,components,pages,ai}/   # see owners below
.env.example               # MONGODB_URI, JWT_SECRET, GEMINI_API_KEY
```
Everything after this follows `docs/CONTRACT.md`. Each person works in their own folders; shared files (`main.py`, `deps.py`) are touched only at the stated hand-offs.

## Workstreams

### P1 — Chat core (backend)  · `backend/app/chat/`
WebSocket endpoint, connection hub, presence, Private Rooms, Groups (create/join/leave/delete), history, read markers, unread counts. Mongo `rooms`, `messages`, `read_markers`.
- Covers R4–R11, AI-free.
- Tests (`pytest`): non-member gets no group messages, creator cannot leave, only creator deletes, joiner sees full history, own messages never unread, private room only reaches its two users.
- Needs from others: `deps.get_current_user` — uses the stub; works standalone.

### P2 — Auth, users, infra  · `backend/app/auth/`, `Dockerfile`, deploy, slides
Register/login (bcrypt, JWT), `/api/me`, token check for the WS, `users` collection, broadcast of new users as `presence` via a hub function `announce_new_user(username)` (P1 provides it; P2 calls it after register — leave a TODO until P1 lands). Then: Dockerfile, Render + Atlas setup, LAN fallback instructions, and the Implementation Explanation slides (protocol stack, why WebSocket, R1/R2 answers).
- Covers R3 and the cloud bonus.
- Hand-off: replace the `deps.py` stub with real JWT validation, and expose `verify_token(token) -> username | None` for P1's WS (until then P1 uses the stub).

### P3 — Frontend chat app  · `frontend/src/{ws,components,pages}`, `api/auth.ts`
Login/register pages, one WebSocket client hook with reconnect, state store, sidebar (users with online dots, group list with member lists, join/leave/delete buttons), chat room view (message window + chat box), unread badges and read-marking on visible rooms.
- Covers the UI half of R3–R11.
- Develops against a small mock WebSocket server (`frontend/mock-server.ts`) that speaks the contract, so it needs neither P1 nor P2.
- Exposes slots for P4 (see below): `<MessageItem>` renders `<MessageActions message={m} />`, and the room header and chat box render `<RoomAiBar />` and `<MicButton />` — P3 creates these as empty placeholders.

### P4 — AI vertical slice  · `backend/app/ai/`, `frontend/src/ai/`
Backend: `/api/ai/{summarize,translate,stt,tts}` using Gemini with one key; input validation (caps, MIME, size); friendly error when quota is hit. Frontend: replaces P3's placeholders, in `frontend/src/ai/`, with `RoomAiBar` (Summarize unread, shown when unread > 0, sends the latest ≤200 unread messages), `MessageActions` (Translate, Speak), `MicButton` (record → STT → fills chat box), and a target-language select that calls `PUT /api/me`.
- Covers all four Part 3 points.
- Develops against stubs: call the endpoints directly with curl/pytest, and test the components in isolation (Vite playground page with fake messages). Needs no live chat.
- Check on day 1: that the Gemini TTS model is free on your key; otherwise fall back to `speechSynthesis` for TTS only.

## Hand-off points (the only dependencies)
| # | From → To | What | Fallback until then |
|---|---|---|---|
| 1 | P2 → P1, P4 | real `get_current_user` / `verify_token` | stub returns a fixed user |
| 2 | P1 → P2 | `announce_new_user()` | skip, users appear after refresh |
| 3 | P3 → P4 | placeholder components exist | P4 builds in its own playground |
| 4 | P1 + P2 → P3 | real server replaces the mock | mock server |

## Integration (everyone, after the above)
1. P3's UI against real P1+P2 server; fix contract mismatches in `CONTRACT.md` first, code second.
2. Mount P4 components; test on two real computers over the LAN (R1).
3. Deploy (P2), rehearse the demo against the spec checklist R1–R11 + four AI features; wake Render before the demo.

## Definition of done
Every requirement R1–R11 and the four AI features demoed from two physical computers, `pytest` green, no secrets committed.
