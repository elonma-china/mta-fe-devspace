"""Persist document processing outcomes pushed by the ingest service.

Bug 1 (2026-07-30) — "upload xong nhưng phải F5 mới hết Đang xử lý".

The push already existed and was never listened to on the server. The ingest
service publishes the outcome the moment a document finishes
(``mta-be-intramind`` ``api/services/document_service.py`` →
``publish_status_sync(session_id, document_id, "completed" | "failed")``) onto
Redis pub/sub, channel ``{prefix}:{conversation_id}``. The gateway forwarded
that stream straight through to the browser as SSE
(``routes/document.py::document_events_proxy``) and wrote nothing, so the only
thing that ever persisted a terminal status was a browser calling
``GET /admin/documents/{id}/status``.

Measured on the real stack before this module existed: a ``.txt`` that ingests
in a few seconds still read ``PROCESSING`` in Postgres 200 s later, and flipped
the instant one ``/status`` call was made. That is not a cosmetic badge — the AI
retrieves ``COMPLETED`` documents only, so a document nobody happened to be
watching was silently missing from every answer.

This subscribes ONCE, with a pattern (``{prefix}:*``) so a single connection
covers every conversation including the hidden per-unit repository ones, and
writes the terminal status to Postgres. The browser SSE path is untouched and
still delivers the same event — this is a second, independent subscriber.

Design notes:

* **Pattern, not per-conversation.** One connection for the whole instance; new
  conversations need no bookkeeping.
* **Best effort, never fatal.** Redis being down must not stop the gateway from
  serving: the loop logs and retries with a backoff, and ``/status`` remains as
  the pull-based fallback (the FE poll still runs).
* **Terminal states only.** ``processing`` events are ignored — the row already
  says that. ``APPROVED`` is never reverted (see the repository method).
"""

from __future__ import annotations

import asyncio
import json
import logging

from app.config import settings
from app.constants.status import ProcessingStatus, UpstreamStatus
from app.db import get_session_factory
from app.repositories.factory import make_document_repository

logger = logging.getLogger(__name__)

# Backoff between reconnect attempts when Redis is unreachable, in seconds.
_RETRY_DELAY = 5.0


def map_pushed_status(pushed: str | None) -> str | None:
    """Map a pushed status word to a TERMINAL app status, or ``None``.

    The publisher sends lowercase words (``"completed"``, ``"failed"``,
    ``"processing"``); ``/documents/task/{id}`` speaks Celery (``SUCCESS`` /
    ``FAILURE``). Accept both vocabularies so this stays correct if the publisher
    is ever changed to forward the task state verbatim.
    """
    up = (pushed or "").strip().upper()
    if up in (ProcessingStatus.COMPLETED, UpstreamStatus.SUCCESS):
        return ProcessingStatus.COMPLETED
    if up in (
        ProcessingStatus.ERROR,
        UpstreamStatus.FAILED,
        UpstreamStatus.FAILURE,
    ):
        return ProcessingStatus.ERROR
    return None


async def apply_event(payload: dict) -> bool:
    """Persist one pushed status event. Returns whether a row was written."""
    document_id = payload.get("document_id")
    terminal = map_pushed_status(payload.get("status"))
    if not document_id or terminal is None:
        return False
    factory = get_session_factory()
    async with factory() as session:
        repo = make_document_repository(session)
        written = await repo.set_terminal_status(document_id, terminal)
    if written:
        logger.info(
            "[statusListener] %s → %s", document_id, terminal
        )
    return written


async def _consume() -> None:
    """Subscribe and apply events until cancelled, reconnecting on failure."""
    import redis.asyncio as aioredis  # imported here so the app boots without it

    pattern = f"{settings.status_pubsub_channel_prefix}:*"
    while True:
        client = None
        try:
            client = aioredis.Redis.from_url(
                settings.redis_url,
                db=settings.status_pubsub_redis_db,
                decode_responses=True,
            )
            pubsub = client.pubsub()
            await pubsub.psubscribe(pattern)
            logger.info(
                "[statusListener] subscribed to %s (db %s)",
                pattern,
                settings.status_pubsub_redis_db,
            )
            async for message in pubsub.listen():
                if message.get("type") != "pmessage":
                    continue
                try:
                    payload = json.loads(message["data"])
                except (json.JSONDecodeError, TypeError, KeyError):
                    continue
                try:
                    await apply_event(payload)
                except Exception:
                    # One bad document must not take the subscription down.
                    logger.exception(
                        "[statusListener] failed to apply %s", payload
                    )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning(
                "[statusListener] connection lost (%s); retrying in %ss",
                exc,
                _RETRY_DELAY,
            )
            await asyncio.sleep(_RETRY_DELAY)
        finally:
            if client is not None:
                try:
                    await client.aclose()
                except Exception:
                    pass


def start(app) -> None:
    """Start the listener as a background task on ``app.state``."""
    if not settings.status_listener_enabled:
        logger.info("[statusListener] disabled (STATUS_LISTENER_ENABLED=false)")
        return
    app.state.status_listener_task = asyncio.create_task(_consume())


async def stop(app) -> None:
    """Cancel the listener task, if one is running."""
    task = getattr(app.state, "status_listener_task", None)
    if task is None:
        return
    task.cancel()
    try:
        await task
    except (asyncio.CancelledError, Exception):
        pass
    app.state.status_listener_task = None
