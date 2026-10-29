# F1 Auth

Implements issue #3 and R3 using the existing REST and WebSocket contract.
`PUT /api/me` is included because issue #3 explicitly assigns it to F1; F9 can
use it for its language selector without changing the users collection.

## Backend

`app.auth.setup.install_auth(app)` installs the REST router and contract-shaped
error handlers. Call it before mounting the static frontend.
`await initialize_auth()` validates configuration and establishes the unique
`users.username` index during startup. Startup fails if the index cannot be
created (including existing duplicate usernames).

| Request | Success | Failure |
|---|---|---|
| `POST /api/auth/register` | 201 `{token}` | 409 `name_taken` |
| `POST /api/auth/login` | 200 `{token}` | 401 `invalid_credentials` |
| `GET /api/me` | 200 `{username,targetLang}` | 401 `invalid_token` |
| `PUT /api/me` with `{targetLang}` | 200 updated profile | 401 `invalid_token` |

Errors use `{error,detail}`. Invalid bodies return 422 `validation_error`;
database failures during account requests return 503 `unavailable`. Validation
errors do not echo submitted credentials. Successful account responses have
`Cache-Control: no-store`. Initial `targetLang` is `en`; updates accept only
the eight languages listed in `CONTRACT.md` and only change the caller's account.

Passwords are not trimmed or truncated. The stored `passwordHash` is tagged
`bcrypt-sha256$` and contains bcrypt (cost 12) of base64(SHA256(UTF-8 password)).
This follows [pyca/bcrypt's long-password approach](https://github.com/pyca/bcrypt#maximum-password-length)
and preserves passwords exceeding bcrypt's 72-byte input limit, including Unicode.
Bcrypt work runs in the thread pool. Unknown-user logins also perform a bcrypt
check, and use the same error as incorrect passwords.

JWTs use HS256, `sub=username`, `iat`, and a one-hour `exp`. Verification pins
the algorithm and requires all three claims, following the
[PyJWT API](https://pyjwt.readthedocs.io/en/stable/api.html).
Real auth requires a random `JWT_SECRET` of at least 32 bytes. Generate one with
`python -c "import secrets; print(secrets.token_urlsafe(48))"` and set it in the
backend environment or the git-ignored `.env` file. Do not commit the result.
Run Uvicorn with `--env-file ../.env` when using the root `.env` from `backend/`.

`deps.verify_token(token)` remains synchronous for F2's WS handshake. Invalid or
expired tokens close WS with 4401; JWT expiration is checked at the handshake,
not continuously on an already-open connection. There is no refresh or token
revocation endpoint. Logout clears this Client's credentials and connection;
an issued JWT remains valid until expiration.

`DEV_AUTH=1` still accepts a valid Username as a development token, as well as a
real JWT. It must stay off for real-auth integration and deployment; the existing
Render guard remains in force.

## Frontend

`features/auth/AuthApp` accepts a `renderChat(token, logout)` function. It opens
the chat only after `/api/me` succeeds. Tokens live in per-tab `sessionStorage`,
with an in-memory fallback if browser storage is unavailable. Passwords are
never stored there. Refresh restores the account using `/api/me`.

A protected REST 401 or WS 4401 signs out and clears presence, Groups, and chat
state. Temporary network errors retain the token and show a retry screen.
Generation checks ignore obsolete authentication responses; an old token's 401
does not sign out a newer account. F9 and other protected REST features can use
`features/auth/api.apiRequest(path, {token, ...})` for the same 401 handling.

Shared application wiring is kept in a separate `chore:` PR per `PLAN.md`.
The development Username form is only available when both
Vite development mode and `VITE_DEV_AUTH=1` are enabled. Normal Vite development
uses the real Login/Register pages. `app.main` initializes accounts at startup
and mounts the Auth router before the frontend; `App.tsx` wraps `PresenceApp`
with `AuthApp`.

## Validation

Backend tests cover register/login/profile, password hashing and Unicode,
error shape, JWT claims/signature/algorithm, REST authentication, real JWT WS
handshakes, registration presence, and concurrent usernames. Real MongoDB tests
use the existing `LOANLY_TEST_MONGODB_URI` convention and disposable databases.

Frontend DOM tests cover Login/Register, guard/loading, reload, blocked storage,
network retry, credential errors, Logout, REST 401, WS 4401, and stale responses.
Run the full test suites before lint/security checks and the production build.
Finally run the R3 checklist in `docs/INTEGRATION.md` with `DEV_AUTH=0`.
