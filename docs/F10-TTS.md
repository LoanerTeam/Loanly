# F10 Text-to-speech

Issues #12 and #36. An icon-only speaker before the Message bubble reads its
original text. After translation, a second speaker immediately after Translate
reads the displayed translation. Both work in Private Rooms and Groups.

## Backend

`POST /api/ai/tts` accepts `{text}` with a Bearer token and returns playable
`audio/wav` bytes with `Cache-Control: no-store`. Text must contain 1–2000
characters and must not be whitespace-only. Original whitespace is preserved.
Errors retain the existing `{error,detail}` shape: 401 for invalid auth, 422
for invalid input, 503 `ai_unavailable` without a key, 429 `ai_quota`, 503
`ai_busy`, and 502 `ai_failed` for network, timeout or invalid audio failures.

Set `GEMINI_API_KEY` and optionally `GEMINI_TTS_MODEL` (default
`gemini-3.8-flash-tts`). Voice is Kore. TTS uses the Interactions REST API,
whose text input is a verbatim transcript, and requests audio output with
`store: false`. It validates the returned base64 WAV before returning it.
The request has a 30-second timeout. TTS does not write Messages or audio
to MongoDB or send WebSocket frames.

The [Google TTS guide](https://ai.google.dev/gemini-api/docs/speech-generation)
documents this API and Thai support for Flash TTS. The
[pricing page](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.8-flash-tts)
lists a free tier; actual availability depends on the project's quota.
On 2026-10-31, a short Thai/English probe using the local configured key
returned a valid WAV. No browser speechSynthesis fallback is used.

## Frontend

`features/tts/SpeechTools` owns one active request or audio player per Chat
Room. `SpeakButton` supports creating, cancelling, playing, stopping and
retrying. Choosing another Message aborts the previous request and stops
its audio. Late results are ignored. Switching rooms or logging out unmounts
the tools, aborts requests and releases the audio and Object URLs. Browser
playback failures show a local error and allow retry. There is no autoplay
when Messages arrive. Original and translated speech share the same audio
owner, so starting either stops the other. Changing translation language or
replacing a translation removes its old audio control and stops its playback.

The shared REST helper's optional Blob response and AbortSignal preserve
its existing JSON defaults and 401 logout handling. Shared wiring registers
the TTS router in `ai/setup.py` and wraps the active `ChatRoom` in
`SpeechTools`, keyed by token and room ID, in `App.tsx`.

## Verification

Mocked pytest tests cover authentication, text boundaries, verbatim input,
WAV validity, malformed provider output, unavailable keys, quotas and network
failures. Vitest covers binary REST/auth handling, button states, cancellation,
one-player ownership, stale results, cleanup and playback errors.

Run the full AGENTS.md gate and frontend build. Then use the F10 row in
`docs/INTEGRATION.md` with real authentication on two physical computers:
read Thai and English Messages in a Private Room and a Group; only the
requesting browser should play audio. Exercise Stop, switching Messages,
switching rooms, logout and provider failures while chat continues working.
The two-computer audible check requires human verification.
