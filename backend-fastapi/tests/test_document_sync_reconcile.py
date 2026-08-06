"""The gateway's document rows must be reconciled by the gateway.

Today the browser is the only thing that writes a terminal status into Postgres:
the React SSE listener receives BE's `status` event and calls back with a PATCH.
Nothing on the server does. `sync_documents_internal` runs on every conversation
open but only ever asked *does this document still exist*, never *what state is
it in*, so a document that finished — or failed — while no tab was watching stays
PROCESSING for good.

Observed on the running instance: three rows stuck at PROCESSING since 23/06,
25/06 and 23/07, whose BE counterparts are COMPLETED (3 and 287 chunks indexed)
and FAILED. The 287-chunk document was fully answerable the whole time.

The same probe also has the opposite failure: it returned False for *any*
non-200, so a 502 from a restarting BE marked every document in the conversation
permanently ERROR, and the ERROR early-return meant they could never recover.

Both directions are tested here. BE is mocked — this is gateway logic.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

import pytest

from app.constants.status import ProcessingStatus
from app.models.access import Principal
from app.routes.document import (
    RemoteDocumentState,
    _map_upstream_status,
    sync_documents_internal,
)

PRINCIPAL = Principal(id=1, unit_id=1, is_admin=True)
CONV_ID = 71


def _repos(docs: list[dict]):
    conv_repo = AsyncMock()
    conv_repo.find_visible = AsyncMock(return_value={"id": CONV_ID})
    conv_repo.update_field = AsyncMock()
    doc_repo = AsyncMock()
    doc_repo.find_by_conversation = AsyncMock(return_value=docs)
    doc_repo.update = AsyncMock()
    return conv_repo, doc_repo


async def _sync(docs, probe):
    conv_repo, doc_repo = _repos(docs)
    result = await sync_documents_internal(
        PRINCIPAL, conv_repo, doc_repo, CONV_ID, probe=probe
    )
    return doc_repo, result


def _written(doc_repo) -> dict:
    """The single field-update the sync applied, or {} when it wrote nothing."""
    if not doc_repo.update.await_args_list:
        return {}
    return doc_repo.update.await_args_list[0].args[2]


# --- BE's own vocabulary ------------------------------------------------------


@pytest.mark.parametrize("upstream", ["FAILED", "FAILURE", "ERROR", "failed"])
def test_every_failure_word_be_actually_emits_maps_to_error(upstream):
    """`/documents/{id}/status` answers FAILED — verified against the running
    service — while the mapping only knew FAILURE and ERROR, so a genuinely
    failed document was treated as still in flight and never written back."""
    assert _map_upstream_status(upstream) == ProcessingStatus.ERROR


@pytest.mark.parametrize("upstream", ["SUCCESS", "COMPLETED", "completed"])
def test_success_words_map_to_completed(upstream):
    assert _map_upstream_status(upstream) == ProcessingStatus.COMPLETED


@pytest.mark.parametrize("upstream", ["PENDING", "PROCESSING", None, ""])
def test_a_status_still_in_flight_is_not_terminal(upstream):
    assert _map_upstream_status(upstream) is None


# --- reconciliation -----------------------------------------------------------


@pytest.mark.asyncio
async def test_a_document_that_finished_unobserved_is_written_back():
    """The defect that stranded a 287-chunk document for a month."""
    doc_repo, _ = await _sync(
        [{"id": "d", "status": ProcessingStatus.PROCESSING}],
        AsyncMock(return_value=RemoteDocumentState(True, True, "COMPLETED")),
    )

    assert _written(doc_repo)["status"] == ProcessingStatus.COMPLETED


@pytest.mark.asyncio
async def test_a_document_that_failed_unobserved_is_written_back():
    """Otherwise the user watches a spinner for a document that is never coming."""
    doc_repo, _ = await _sync(
        [{"id": "d", "status": ProcessingStatus.PROCESSING}],
        AsyncMock(return_value=RemoteDocumentState(True, True, "FAILED")),
    )

    assert _written(doc_repo)["status"] == ProcessingStatus.ERROR


@pytest.mark.asyncio
async def test_an_unreachable_ingest_service_changes_nothing():
    """A 502 from a restarting BE is not evidence about any document. Writing
    ERROR here is what made a routine restart cost every document in the
    conversation, unrecoverably."""
    doc_repo, result = await _sync(
        [{"id": "d", "status": ProcessingStatus.PROCESSING}],
        AsyncMock(return_value=RemoteDocumentState(reachable=False)),
    )

    doc_repo.update.assert_not_awaited()
    assert result["missing_count"] == 0


@pytest.mark.asyncio
async def test_only_a_definite_absence_marks_the_row_missing():
    doc_repo, result = await _sync(
        [{"id": "d", "status": ProcessingStatus.COMPLETED}],
        AsyncMock(return_value=RemoteDocumentState(reachable=True, exists=False)),
    )

    assert _written(doc_repo)["status"] == ProcessingStatus.ERROR
    assert result["missing_count"] == 1


@pytest.mark.asyncio
async def test_a_row_wrongly_marked_error_recovers():
    """ERROR used to be a one-way door: `_check_one` returned early for it, so a
    document marked ERROR by a transient blip stayed broken in the UI while BE
    held it fully indexed. The user's only recovery was to re-upload."""
    doc_repo, _ = await _sync(
        [{"id": "d", "status": ProcessingStatus.ERROR}],
        AsyncMock(return_value=RemoteDocumentState(True, True, "COMPLETED")),
    )

    assert _written(doc_repo)["status"] == ProcessingStatus.COMPLETED


@pytest.mark.asyncio
async def test_an_approved_document_is_never_downgraded():
    """APPROVED is set by a human through the approve endpoint and is documented
    as never changed by ingest sync."""
    doc_repo, _ = await _sync(
        [{"id": "d", "status": ProcessingStatus.APPROVED}],
        AsyncMock(return_value=RemoteDocumentState(True, True, "COMPLETED")),
    )

    doc_repo.update.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_row_already_in_the_right_state_is_not_rewritten():
    """Every conversation open runs this; it must not be a write amplifier."""
    doc_repo, _ = await _sync(
        [{"id": "d", "status": ProcessingStatus.COMPLETED}],
        AsyncMock(return_value=RemoteDocumentState(True, True, "COMPLETED")),
    )

    doc_repo.update.assert_not_awaited()


@pytest.mark.asyncio
async def test_one_failing_probe_does_not_abandon_the_other_documents():
    async def _probe(document_id: str):
        if document_id == "bad":
            raise RuntimeError("connection reset")
        return RemoteDocumentState(True, True, "COMPLETED")

    conv_repo, doc_repo = _repos(
        [
            {"id": "bad", "status": ProcessingStatus.PROCESSING},
            {"id": "good", "status": ProcessingStatus.PROCESSING},
        ]
    )
    await sync_documents_internal(
        PRINCIPAL, conv_repo, doc_repo, CONV_ID, probe=AsyncMock(side_effect=_probe)
    )

    updated = {c.args[1] for c in doc_repo.update.await_args_list}
    assert updated == {"good"}


@pytest.mark.asyncio
async def test_status_writes_never_overlap_on_the_shared_session():
    """The repositories share the request's one AsyncSession, and every write ends
    in `session.commit()`. Fanning the writes out with `asyncio.gather` put two
    commits in flight at once, which SQLAlchemy refuses:

        IllegalStateChangeError: Method 'close()' can't be called here;
        method '_prepare_impl()' is already in progress

    It escaped into the `get_session` teardown, so `GET .../documents` answered
    500 and the conversation rendered with no documents at all. Conversation 73
    had four rows to write and hit it on every open — and because the sync died
    before writing them, the next open had the same four to write. It could not
    drain itself.

    One document could never trigger it, which is why it stayed hidden until a
    conversation had several documents finish unobserved.
    """
    in_flight = 0
    peak = 0

    async def _probe(document_id: str):
        await asyncio.sleep(0)  # let every coroutine reach the write together
        return RemoteDocumentState(True, True, "COMPLETED")

    async def _update(principal, document_id, fields):
        nonlocal in_flight, peak
        in_flight += 1
        peak = max(peak, in_flight)
        await asyncio.sleep(0)  # stands in for the commit's await
        in_flight -= 1

    conv_repo, doc_repo = _repos(
        [{"id": f"d{n}", "status": ProcessingStatus.PROCESSING} for n in range(4)]
    )
    doc_repo.update = AsyncMock(side_effect=_update)

    await sync_documents_internal(
        PRINCIPAL, conv_repo, doc_repo, CONV_ID, probe=_probe
    )

    assert peak == 1, f"{peak} writes were in flight on one session at once"
    assert doc_repo.update.await_count == 4


# --- the probe itself ---------------------------------------------------------


def _response(status_code: int, body: dict | None = None):
    resp = AsyncMock()
    resp.status_code = status_code
    resp.json = lambda: body or {}
    client = AsyncMock()
    client.get = AsyncMock(return_value=resp)
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)
    return patch("httpx.AsyncClient", return_value=client), client


@pytest.mark.asyncio
async def test_the_probe_asks_the_status_endpoint_not_the_document():
    """`GET /documents/{id}` attaches every page's OCR text; this reads three
    fields off it. On a conversation of scanned documents that is megabytes per
    open, thrown away."""
    from app.routes.document import _fetch_remote_status

    ctx, client = _response(200, {"status": "COMPLETED"})
    with ctx:
        state = await _fetch_remote_status("d")

    assert state == RemoteDocumentState(True, True, "COMPLETED")
    assert client.get.await_args.args[0].endswith("/documents/d/status")


@pytest.mark.asyncio
@pytest.mark.parametrize("code", [500, 502, 503])
async def test_a_server_error_is_reported_as_unreachable(code):
    from app.routes.document import _fetch_remote_status

    ctx, _ = _response(code)
    with ctx:
        assert await _fetch_remote_status("d") == RemoteDocumentState(reachable=False)


@pytest.mark.asyncio
async def test_a_404_is_reported_as_a_definite_absence():
    from app.routes.document import _fetch_remote_status

    ctx, _ = _response(404)
    with ctx:
        state = await _fetch_remote_status("d")

    assert state.reachable is True and state.exists is False


@pytest.mark.asyncio
async def test_a_transport_error_is_reported_as_unreachable():
    from app.routes.document import _fetch_remote_status

    with patch("httpx.AsyncClient", side_effect=OSError("no route to host")):
        assert await _fetch_remote_status("d") == RemoteDocumentState(reachable=False)
