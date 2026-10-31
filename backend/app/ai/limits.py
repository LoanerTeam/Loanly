import time
from collections import Counter, deque
from datetime import datetime, timedelta, timezone

from app.ai.gemini import AiError
from app.config import settings

# Gemini resets daily quotas at midnight Pacific time.
# shortcut: fixed UTC-8, so in summer our day starts one hour after Google's; use
# ZoneInfo("America/Los_Angeles") if that hour ever matters (needs tzdata on Windows).
PACIFIC = timezone(timedelta(hours=-8))
USER_SHARE = 4  # one user may use at most a quarter of a model's daily requests

# shortcut: in-memory counters, valid while the server runs as one instance (ADR 0003).
_recent: dict[str, deque[float]] = {}
_used: Counter = Counter()
_day = None


def take(kind: str, username: str) -> None:
    """Count one Gemini request of `kind` ("text", "stt" or "tts"), or raise 429."""
    global _day
    rpm, rpd = getattr(settings, f"ai_{kind}_rpm"), getattr(settings, f"ai_{kind}_rpd")
    today = datetime.now(PACIFIC).date()
    if today != _day:
        _day = today
        _used.clear()
    now = time.monotonic()
    recent = _recent.setdefault(kind, deque())
    while recent and now - recent[0] >= 60:
        recent.popleft()
    if _used[kind] >= rpd:
        raise AiError(429, "ai_quota", "The AI quota for today is used up. Try again tomorrow.")
    if _used[kind, username] >= max(1, rpd // USER_SHARE):
        raise AiError(429, "ai_quota", "You have used your AI share for today. Try again tomorrow.")
    if len(recent) >= rpm:
        raise AiError(429, "ai_quota", "The AI is busy right now. Try again in a minute.")
    recent.append(now)
    _used[kind] += 1
    _used[kind, username] += 1


def reset() -> None:
    global _day
    _recent.clear()
    _used.clear()
    _day = None
