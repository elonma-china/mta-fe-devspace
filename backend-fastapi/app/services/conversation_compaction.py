"""Fold aged-out turns into a conversation's rolling summary.

The gateway owns the durable conversation, so it owns the compacted view: a
rolling ``summary`` plus ``absorbed_upto``, the count of leading messages that
summary already accounts for. The AI service owns prompts and the LLM, so the
fold itself is an HTTP call to ``POST /api/v1/conversation/compact``.

Runs **after** a turn is stored, never before one is answered. That placement is
the point: the AI used to re-summarise the forwarded window inside every query,
ahead of retrieval, and discard the result — so the same turns were summarised
again on the next request while the user waited. Here the user waits for
nothing, and the next query reads a summary that is already done.

Best-effort throughout. On any failure the stored ``summary``/``absorbed_upto``
are left exactly as they were, so the turns that failed to fold are still in
``messages`` and simply get absorbed on a later attempt. A partial or wrong
summary would be far worse than a late one: it is the only remaining record of
turns that have aged out of the forwarded window.
"""

from __future__ import annotations

import logging

import httpx

from app.config import settings
from app.db import get_session_factory
from app.models.access import Principal
from app.repositories.factory import make_conversation_repository
from app.routes.llm import _turns_to_absorb

logger = logging.getLogger(__name__)

_TIMEOUT = 60.0


async def compact_conversation(principal: Principal, conv_id: int) -> None:
    """Absorb whatever has aged out of the forwarded window, if anything.

    Opens its own database session rather than accepting the request's. FastAPI
    exits `yield` dependencies before background tasks run (since 0.106), so the
    request-scoped `AsyncSession` behind the injected repository is already
    closed by the time this executes — reusing it fails at runtime while every
    unit test still passes, because the tests exercise the helpers directly.

    Args:
        principal: Owner of the conversation, for the repo's visibility check.
        conv_id: Conversation to compact.
    """
    window = settings.stm_forward_window
    if window <= 0:
        return

    session_factory = get_session_factory()
    async with session_factory() as session:
        repo = make_conversation_repository(session)
        await _compact_with(repo, principal, conv_id, window)


async def _compact_with(repo, principal: Principal, conv_id: int, window: int) -> None:
    """The fold itself, against an already-open repository."""
    try:
        ds = await repo.get_data_source(principal, conv_id)
    except Exception:  # noqa: BLE001 — compaction is best-effort
        logger.warning("Compaction: cannot read conv_id=%s", conv_id, exc_info=True)
        return

    messages = ds.get("messages") or []
    absorbed = ds.get("absorbed_upto") or 0
    if not isinstance(absorbed, int) or absorbed < 0:
        absorbed = 0

    turns = _turns_to_absorb(messages, absorbed, window)
    if not turns:
        return

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            response = await client.post(
                f"{settings.ai_service_host.rstrip('/')}/conversation/compact",
                json={"summary": ds.get("summary") or None, "turns": turns},
            )
            response.raise_for_status()
            payload = response.json()
    except Exception:  # noqa: BLE001 — a failed fold retries after a later turn
        logger.warning("Compaction: fold failed for conv_id=%s", conv_id, exc_info=True)
        return

    summary = (payload.get("summary") or "").strip()
    if not summary:
        logger.warning("Compaction: empty summary for conv_id=%s, keeping the old one", conv_id)
        return

    # The marker counts stored slots *examined*, not messages emitted. Deriving
    # it from `len(turns)` would be wrong twice over: `_turns_to_absorb` emits
    # two messages per stored turn, and it drops half-turns entirely — so a
    # conversation containing one errored turn would advance the marker short of
    # where it looked, and re-absorb the same turns on every later attempt.
    new_marker = len(messages) - window

    # Narrow write: `update_data_source` replaces the whole document, and the
    # LLM call above took seconds — a turn appended in that window would be
    # erased by writing back the `ds` read before it.
    try:
        await repo.set_compaction(principal, conv_id, summary, new_marker)
    except Exception:  # noqa: BLE001
        logger.warning("Compaction: cannot persist conv_id=%s", conv_id, exc_info=True)
        return

    logger.info(
        "Compaction: conv_id=%s absorbed %d turn(s), marker now %d",
        conv_id, new_marker - absorbed, new_marker,
    )
