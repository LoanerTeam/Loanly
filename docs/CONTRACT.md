# Contract

The only thing the four workstreams share. Change it by PR with all four owners approving.
Vocabulary is in `GLOSSARY.md`.

## Conventions
- Usernames: `^[a-z0-9_]{3,20}$`, unique. Passwords: 8+ chars.
- IDs are strings (Mongo ObjectId hex). `ts` is ISO-8601 UTC.
- REST base `/api`, `Authorization: Bearer <jwt>`. Errors: `{ "error": "<code>", "detail": "<text>" }`.
- Message text: 1–2000 chars.

## Shapes
```
Message { id, roomId, sender, text, ts }
Room    { id, kind: "private"|"group", name, members: [username], creator|null }
        // private: name = other user's username, creator = null
Group   = Room with kind "group"   // appears in `groups` even if I am not a member
```

## REST
| Method | Path | Body | Returns |
|---|---|---|---|
| POST | /api/auth/register | `{username,password}` | `{token}` |
| POST | /api/auth/login | `{username,password}` | `{token}` |
| GET | /api/me | – | `{username,targetLang}` |
| PUT | /api/me | `{targetLang}` | `{username,targetLang}` |
| POST | /api/ai/summarize | `{roomName, messages:[{sender,text}]}` (≤200) | `{summary}` |
| POST | /api/ai/translate | `{text, targetLang}` | `{translation}` |
| POST | /api/ai/stt | multipart `audio` (webm/ogg/wav) | `{text}` |
| POST | /api/ai/tts | `{text}` | `audio/wav` bytes |

`targetLang` ∈ `en th ja zh ko es fr de`.

## WebSocket `GET /ws?token=<jwt>`
Bad/missing token → close code 4401. One JSON object per frame. Client frames may carry `reqId`; the server echoes it on the reply or on `error`.

### Client → server
| type | fields | effect |
|---|---|---|
| `dm.open` | `username` | get-or-create the Private Room; replies `room.upsert` |
| `message.send` | `roomId, text` | persist, then `message.new` to online members |
| `history.get` | `roomId` | replies `history` (members only) |
| `group.create` | `name` | creator is sole member; broadcast `group.upsert` to all online |
| `group.join` | `groupId` | caller becomes member; `group.upsert` to all, `room.upsert` to caller |
| `group.leave` | `groupId` | not allowed for creator; `group.upsert` to all, `room.removed` to caller |
| `group.delete` | `groupId` | creator only; `group.removed` to all |
| `read.mark` | `roomId, messageId` | advance caller's read marker (never backwards) |

### Server → client
| type | fields |
|---|---|
| `init` | `me, users:[{username,online}], rooms:[Room], groups:[Room], unread:{roomId:n}` (sent right after connect) |
| `presence` | `username, online` (also sent for newly registered users) |
| `room.upsert` | `room` (private room created, or a group I joined) |
| `room.removed` | `roomId` |
| `group.upsert` | `group` (any group changed/created, visible to everyone) |
| `group.removed` | `groupId` |
| `message.new` | `message` (also echoed to the sender) |
| `history` | `roomId, messages:[Message]` (oldest first, full history) |
| `error` | `code, detail, reqId?` — codes: `not_member invalid_text name_taken not_found forbidden creator_cannot_leave unknown_user` |

Rules: non-members never receive a group's messages; a private room's messages go only to its two users; `unread` counts messages from others after the read marker.

## MongoDB (db `loanly`)
`users {username, passwordHash, targetLang}` — owned by P2.
`rooms {kind, name, members, creator, pairKey?}` (`pairKey` = sorted "a|b" for private, unique) · `messages {roomId, sender, text, ts}` · `read_markers {username, roomId, messageId}` — owned by P1.
