# tests/test_status_listener.py
"""Bug 1: the gateway persists the document status the ingest service pushes.

The push always existed — ``mta-be-intramind`` publishes ``completed``/``failed``
on Redis (``doc-status:{conversation_id}``) the moment a document finishes — but
nothing on the server listened, so the only thing that ever wrote a terminal
status was a browser calling ``GET /admin/documents/{id}/status``.

Measured on the real stack before ``app/services/status_listener.py`` existed: a
``.txt`` that ingests in seconds still read ``PROCESSING`` in Postgres 200s
later, and flipped the instant one ``/status`` call was made. A document left on
``PROCESSING`` is not a cosmetic problem — the AI retrieves ``COMPLETED``
documents only, so it is silently absent from every answer.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from app.constants.status import ProcessingStatus
from app.services import status_listener

DOC_ID = "11111111-2222-3333-4444-555555555555"


# ── the vocabulary the publisher actually speaks ─────────────────────────────


@pytest.mark.parametrize(
    "pushed,expected",
    [
        # What mta-be-intramind publishes today (lowercase words).
        ("completed", ProcessingStatus.COMPLETED),
        ("failed", ProcessingStatus.ERROR),
        # Celery task states, in case the publisher ever forwards them verbatim.
        ("SUCCESS", ProcessingStatus.COMPLETED),
        ("FAILURE", ProcessingStatus.ERROR),
        # Non-terminal: the row already says this, nothing to write.
        ("processing", None),
        ("pending", None),
        ("", None),
        (None, None),
    ],
)
def test_mapPushedStatus_terminalWordsOnly(pushed, expected):
    assert status_listener.map_pushed_status(pushed) is expected


# ── applying one event ───────────────────────────────────────────────────────


class _Repo:
    def __init__(self, written: bool = True) -> None:
        self.calls: list[tuple[str, str]] = []
        self._written = written

    async def set_terminal_status(self, doc_id: str, status: str) -> bool:
        self.calls.append((doc_id, status))
        return self._written


def _patched(repo: _Repo):
    """Patch the session factory + repository the listener reaches for."""

    class _Session:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

    return (
        patch.object(status_listener, "get_session_factory", lambda: _Session),
        patch.object(status_listener, "make_document_repository", lambda s: repo),
    )


@pytest.mark.asyncio
async def test_applyEvent_completed_writesTerminalStatus():
    repo = _Repo()
    p1, p2 = _patched(repo)
    with p1, p2:
        written = await status_listener.apply_event(
            {"document_id": DOC_ID, "status": "completed"}
        )
    assert written is True
    assert repo.calls == [(DOC_ID, ProcessingStatus.COMPLETED)]


@pytest.mark.asyncio
async def test_applyEvent_failed_writesError():
    repo = _Repo()
    p1, p2 = _patched(repo)
    with p1, p2:
        await status_listener.apply_event(
            {"document_id": DOC_ID, "status": "failed", "error": "boom"}
        )
    assert repo.calls == [(DOC_ID, ProcessingStatus.ERROR)]


@pytest.mark.asyncio
async def test_applyEvent_processing_touchesNothing():
    # A "processing" event carries no new information — writing it back would
    # churn the row and, worse, could revert a status set in the meantime.
    repo = _Repo()
    p1, p2 = _patched(repo)
    with p1, p2:
        written = await status_listener.apply_event(
            {"document_id": DOC_ID, "status": "processing"}
        )
    assert written is False
    assert repo.calls == []


@pytest.mark.asyncio
async def test_applyEvent_malformedPayload_isIgnored():
    # The channel is shared infrastructure; a payload without a document_id must
    # not raise inside the subscription loop.
    repo = _Repo()
    p1, p2 = _patched(repo)
    with p1, p2:
        assert await status_listener.apply_event({"status": "completed"}) is False
        assert await status_listener.apply_event({}) is False
    assert repo.calls == []


# ── lifecycle ────────────────────────────────────────────────────────────────


class _App:
    def __init__(self) -> None:
        self.state = type("S", (), {})()


@pytest.mark.asyncio
async def test_start_disabled_startsNoTask():
    app = _App()
    with patch.object(status_listener.settings, "status_listener_enabled", False):
        status_listener.start(app)
    assert getattr(app.state, "status_listener_task", None) is None


@pytest.mark.asyncio
async def test_startThenStop_cancelsTheSubscription():
    app = _App()
    consumed = AsyncMock()
    with patch.object(status_listener.settings, "status_listener_enabled", True), \
            patch.object(status_listener, "_consume", consumed):
        status_listener.start(app)
        assert app.state.status_listener_task is not None
        await status_listener.stop(app)
    assert getattr(app.state, "status_listener_task", None) is None
