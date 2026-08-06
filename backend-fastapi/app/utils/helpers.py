"""General-purpose helper functions."""

from __future__ import annotations

import json
import unicodedata
from datetime import datetime, timezone
from typing import Any


def utcnow() -> datetime:
    """Return the current UTC time as a *tz-naive* datetime.

    The Postgres timestamp columns are ``TIMESTAMP WITHOUT TIME ZONE``, so
    values written to them must be naive.  We standardize on naive UTC: this
    mirrors the read side, which re-attaches ``timezone.utc`` to values read
    back from those columns.
    """
    return datetime.now(timezone.utc).replace(tzinfo=None)


def fix_filename_encoding(name: str | None) -> str | None:
    """Normalize a filename from latin-1-encoded UTF-8 bytes to proper NFC unicode."""
    if not name:
        return name
    try:
        # Attempt the latin-1 → utf-8 round-trip (mirrors the Node.js Buffer trick)
        utf8 = name.encode("latin-1").decode("utf-8")
    except (UnicodeDecodeError, UnicodeEncodeError):
        utf8 = name
    return unicodedata.normalize("NFC", utf8)


def parse_json_safe(raw: Any, fallback: Any = None) -> Any:
    """Safely parse a JSON string.  If *raw* is already a dict/list, return as-is."""
    if raw is None:
        return fallback
    if isinstance(raw, (dict, list)):
        return raw
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            return fallback
    return fallback


def extract_client(request) -> dict:
    """Extract client IP and User-Agent from a FastAPI/Starlette request."""
    forwarded = (request.headers.get("x-forwarded-for") or "").strip()
    ip = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else None)
    user_agent = request.headers.get("user-agent")
    return {"ip": ip, "user_agent": user_agent}
