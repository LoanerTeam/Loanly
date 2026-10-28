# Integration plan

Run this after every feature (F1–F11) is merged and **before** deploying (F12). Features were built against stubs, so this is where mismatches show up. Fix contract mismatches in `docs/CONTRACT.md` first, then the code.

Setup: `main` checked out, `DEV_AUTH` off, a fresh MongoDB database, a real `GEMINI_API_KEY`. Two physical computers (X and Y) on the same network, each with a browser. The server runs on X (or a third machine). Users: `alice` on X, `bob` on Y, `carol` on a second browser profile on X.

## Phase 1 — Automated gate (must be green before anything manual)
| # | Check | Command |
|---|---|---|
| 1 | Backend tests | `cd backend && pytest` |
| 2 | Frontend tests | `cd frontend && npm test` |
| 3 | Lint | `ruff check .` and `npm run lint` |
| 4 | Security | `bandit -r app`, `pip-audit`, `npm audit --omit=dev` |
| 5 | Frontend build | `npm run build`, then FastAPI serves `frontend/dist` |
| 6 | No secrets or dev switches in git | `git grep -nE "GEMINI_API_KEY=.+|JWT_SECRET=.+"` returns nothing; `DEV_AUTH` is off |

## Phase 2 — Requirement checklist (two computers, real auth)
Tick each box while watching both screens. Expected result is in the last column.

| Req | Steps | Expected |
|---|---|---|
| R1 | Server on X; open the server URL from Y | Both load the app; the network path (browser -> HTTP upgrade -> WebSocket -> FastAPI -> MongoDB) can be explained |
| R2 | Open browser devtools, Network, WS | Chat messages are frames on one `/ws` connection; no `/api` calls carry chat text |
| R3 | Register `alice`; register `alice` again; log in with a wrong password | Second register rejected (`name_taken`); wrong password rejected; `bob` registers fine |
| R3 | Open `/ws` with no token and with a garbage token | Closed with code 4401 |
| R4 | `alice` and `bob` logged in | Both see both names, including their own, with online dots; close bob's tab -> alice sees bob grey, reopen -> green |
| R5 | alice opens a chat with bob, then with carol | Two separate rooms |
| R6 | In a room | A message window and a chat box exist; sent and incoming messages appear live |
| R7 | alice DMs bob; carol looks everywhere | Only alice and bob see it; carol sees nothing, no unread badge |
| R8 | alice creates group `team` | Group exists with alice as the only member |
| R9 | bob and carol open the group list; alice creates `team` again; bob creates `team` | All see Alice's Group with members `[alice]`; Alice's duplicate is rejected; Bob's separate Group succeeds with members `[bob]` |
| R10 | alice does not add anyone; bob clicks Join | bob becomes a member by himself; carol is not added |
| R11 | alice sends in `team`; carol (non-member) checks | alice and bob see it live; carol never sees it |
| Groups | bob leaves `team`, rejoins; alice tries to leave; bob tries to delete; alice deletes | bob can leave and rejoin; alice cannot leave; only alice can delete; deleting removes the group for everyone |
| History | carol joins `team` after messages were sent | carol sees the full previous history |
| Offline DM | bob logs out; alice DMs bob; bob logs in | Message stored; bob sees it as unread |
| Persistence | Restart the server | Users, rooms, messages, groups and read markers are all still there; clients reconnect |
| Unread | bob is in another room while alice sends 3 messages to bob; then bob opens the room | Badge shows 3; it clears when the room is viewed; alice's own messages never count as unread |

## Phase 3 — AI features (one box each)
| Feature | Steps | Expected |
|---|---|---|
| Summarize unread | bob has 5+ unread in a room, clicks Summarize | A summary of exactly those messages; button hidden when 0 unread; with 200+ unread only the latest 200 are used |
| Translate | Pick target language `th` in settings, press Translate on a message | Translation shown under the original, only to bob, not saved; setting survives reload |
| Text-to-speech | Press the speaker on a message | Audio plays |
| Speech-to-text | Press the mic, speak, stop | Transcript fills the chat box, editable, not sent automatically |
| Failure handling | Unset `GEMINI_API_KEY` or exhaust the quota | Each feature shows a friendly error; chat keeps working |
| Auth on AI | `curl` each `/api/ai/*` without a token | 401 |

## Phase 4 — Security and robustness spot checks
- Send `message.send` to a room you are not in (browser console on Y) -> `not_member`, nothing delivered.
- Send a 2001-char message and an empty message -> `invalid_text`.
- Send `history.get` for another pair's private room -> `not_member`.
- Send an unknown frame `type` and malformed JSON -> `error` frame, connection stays open.
- XSS: send `<img src=x onerror=alert(1)>` -> shown as plain text on the other screen.
- Two tabs, same user -> both receive messages; closing one does not mark the user offline.
- Kill the WiFi for 10 seconds on Y -> client reconnects and catches up via history.
- Upload a non-audio file and a very large file to `/api/ai/stt` -> rejected.

## Phase 5 — Deploy gate
Only when phases 1–4 are fully ticked:
- `DEV_AUTH` is unset on Render, and the server refuses to start if it is set there.
- Environment variables set on Render, not committed: `MONGODB_URI`, `JWT_SECRET`, `GEMINI_API_KEY`.
- Atlas network access allows Render; the database user is least-privilege.
- Exactly one Render instance (live connections are in memory, ADR 0003).
- Wake the service, then rerun Phase 2 R1–R11 from X and Y against the Render URL.
- Slides cover: protocol stack and why WebSocket (ADR 0001), why chat is socket-only and AI is REST (ADR 0002), and the answers to R1 and R2.

## Recording results
Copy this file's tables into the PR description as a checklist; each failed row becomes an issue titled `fix: <req> <symptom>` and gets its own branch per `AGENTS.md`.
