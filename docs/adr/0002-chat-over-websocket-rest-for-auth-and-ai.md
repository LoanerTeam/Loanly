# Chat traffic over WebSocket only; auth and AI over REST

Requirement R2 says chat messages must use sockets only, so every chat action (send, history, groups, presence, read markers) goes over the single authenticated WebSocket. Register/login and the AI calls (audio upload for speech-to-text, summarize, translate, text-to-speech) use plain HTTP, since binary audio and request/response calls fit REST better and are not "chat messages".
