"""DEV_READONLY_CORPUS — no mutating call may reach the ingest service.

Dev Space points ``AI_INGEST_HOST`` at a corpus it does not own. The worst
case is not a failed upload: it is ``_delete_remote_document``, which issues
a real ``DELETE /documents/{id}``, so a Dev Space user deleting a
conversation would delete documents out of the real index.

These tests assert the guard where it matters — that the outbound request is
never made — rather than only that a 403 came back. A 403 produced *after*
the upstream call would look identical to the client and be useless.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.config import settings
from app.routes import document


@pytest.fixture
def readonly():
    """Turn the guard on for one test, then put it back."""
    before = settings.dev_readonly_corpus
    settings.dev_readonly_corpus = True
    yield
    settings.dev_readonly_corpus = before


@pytest.fixture
def no_http():
    """Fail loudly if any helper opens an httpx client under the guard."""
    with patch.object(document.httpx, "AsyncClient") as client:
        client.side_effect = AssertionError(
            "guarded helper reached the network"
        )
        yield client


def test_default_is_writable():
    """The guard must be opt-in. The real deployment shares this code."""
    assert settings.dev_readonly_corpus is False


@pytest.mark.asyncio
async def test_upload_refused_before_network(readonly, no_http):
    with pytest.raises(document.HTTPException) as exc:
        await document._create_remote_document(
            b"x", "a.pdf", "application/pdf", owner_id=1, conversation_id=2
        )
    assert exc.value.status_code == 403
    no_http.assert_not_called()


@pytest.mark.asyncio
async def test_process_refused_before_network(readonly, no_http):
    with pytest.raises(document.HTTPException) as exc:
        await document._process_remote_document("doc-1", conversation_id=2)
    assert exc.value.status_code == 403
    no_http.assert_not_called()


@pytest.mark.asyncio
async def test_preview_refused_before_network(readonly, no_http):
    with pytest.raises(document.HTTPException) as exc:
        await document._preview_remote_document("doc-1")
    assert exc.value.status_code == 403
    no_http.assert_not_called()


@pytest.mark.asyncio
async def test_delete_refused_before_network(readonly, no_http):
    """The one that would destroy real data."""
    with pytest.raises(document.HTTPException) as exc:
        await document._delete_remote_document("doc-1")
    assert exc.value.status_code == 403
    no_http.assert_not_called()


@pytest.mark.asyncio
async def test_repo_process_refused_without_marking_document_errored(
    readonly, no_http
):
    """``_process_repo_document`` swallows failures into an ERROR status on
    the row. A Dev Space refusal is not a property of the document, so the
    guard must fire outside that try block — otherwise browsing Dev Space
    would rewrite real documents' status to ERROR.
    """
    doc_repo = MagicMock()
    doc_repo.update = AsyncMock()

    with pytest.raises(document.HTTPException) as exc:
        await document._process_repo_document(
            doc_repo, MagicMock(), "doc-1", 2
        )
    assert exc.value.status_code == 403
    doc_repo.update.assert_not_called()
    no_http.assert_not_called()


@pytest.mark.asyncio
async def test_reads_are_not_guarded(readonly):
    """Reading the corpus is the entire point — the guard must not touch it.

    Guarding a read helper by accident would be a quiet disaster: Dev Space
    would come up looking empty rather than obviously broken.
    """
    resp = MagicMock(status_code=200)
    resp.json = MagicMock(return_value={"status": "COMPLETED"})
    ctx = MagicMock()
    ctx.__aenter__ = AsyncMock(return_value=MagicMock(get=AsyncMock(return_value=resp)))
    ctx.__aexit__ = AsyncMock(return_value=False)

    with patch.object(
        document.httpx, "AsyncClient", MagicMock(return_value=ctx)
    ):
        state = await document._fetch_remote_status("doc-1")

    assert state.reachable and state.exists
    assert state.status == "COMPLETED"
