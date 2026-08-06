"""An upload that BE deduplicates must not crash the gateway.

BE's tier-0 dedup answers a re-uploaded file with the id of the document it
already holds instead of minting a new one. The gateway stored that id in its own
`document` table, whose primary key IS that id, with no check that the row was
already there:

    asyncpg.exceptions.UniqueViolationError: duplicate key value violates
    unique constraint "document_pkey"

Every upload of an already-known file answered 500. Two things were wrong. BE
scoped dedup to the owner alone, so a file uploaded to conversation 3 came back
for conversation 73 — fixed on that side by scoping to the conversation too. And
the gateway assumed the id was always new, which is not true even within one
conversation: uploading the same file twice is exactly what dedup is for, and
that is now the idempotent path rather than an error.

No upstream is contacted here; `_create_remote_document` is stubbed.
"""

from __future__ import annotations

import hashlib
from io import BytesIO
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException, UploadFile

from app.constants.status import ProcessingStatus
from app.routes import document as document_routes

CONV_ID = 73
DOC_ID = "2ee4e6be-3b46-4eef-a956-e584d6952e87"


def _upload(name: str = "phatbieu.docx") -> UploadFile:
    return UploadFile(file=BytesIO(b"the same bytes as last time"), filename=name)


async def _run(existing_row, monkeypatch, *, user, same_content_row=None):
    """Drive the route with BE answering `DOC_ID`.

    ``existing_row`` is what the gateway's table holds under that id (or None);
    ``same_content_row`` is what it holds for this conversation + sha256.
    """
    upstream = AsyncMock(return_value={"document_id": DOC_ID, "status": "COMPLETED"})
    monkeypatch.setattr(document_routes, "_create_remote_document", upstream)
    monkeypatch.setattr(document_routes, "audit_log", lambda *a, **k: None)

    conv_repo = AsyncMock()
    conv_repo.find_visible = AsyncMock(return_value={"id": CONV_ID})
    doc_repo = AsyncMock()
    doc_repo.find_visible = AsyncMock(return_value=existing_row)
    doc_repo.find_by_sha256 = AsyncMock(return_value=same_content_row)
    doc_repo.find_by_conversation = AsyncMock(return_value=[])
    doc_repo.create = AsyncMock()

    result = await document_routes.upload_document(
        request=None,
        user_id=user["id"],
        conv_id=CONV_ID,
        file=_upload(),
        _user=user,
        conv_repo=conv_repo,
        doc_repo=doc_repo,
    )
    return result, doc_repo, upstream


@pytest.fixture
def user():
    return {"id": 1, "unit_id": 1, "is_admin": True}


@pytest.mark.asyncio
async def test_a_new_document_is_still_inserted(user, monkeypatch):
    """The ordinary path must keep working."""
    result, doc_repo, _ = await _run(None, monkeypatch, user=user)

    doc_repo.create.assert_awaited_once()
    assert doc_repo.create.await_args.args[0]["id"] == DOC_ID
    assert result.document_id == DOC_ID


@pytest.mark.asyncio
async def test_a_dedup_hit_in_this_conversation_does_not_insert_again(
    user, monkeypatch
):
    """The 500. Re-uploading a file this conversation already has is idempotent:
    the caller gets the same document id back and nothing is written."""
    row = {"id": DOC_ID, "conversation_id": CONV_ID, "user_id": 1,
           "status": ProcessingStatus.COMPLETED}

    result, doc_repo, _ = await _run(row, monkeypatch, user=user)

    doc_repo.create.assert_not_awaited()
    assert result.document_id == DOC_ID


@pytest.mark.asyncio
async def test_a_document_held_by_another_conversation_is_refused_cleanly(
    user, monkeypatch
):
    """BE's conversation scoping should stop this from happening at all. If it
    still does — a legacy row, a race — the answer is a 409 the UI can explain,
    not a primary-key crash the user reads as 'upload is broken'."""
    row = {"id": DOC_ID, "conversation_id": 3, "user_id": 1,
           "status": ProcessingStatus.COMPLETED}

    with pytest.raises(HTTPException) as exc:
        await _run(row, monkeypatch, user=user)

    assert exc.value.status_code == 409


# ── the gateway settles re-uploads itself ────────────────────────────────────────
#
# Everything above is a net under ingestion's dedup. The gateway does not need to
# ask: it already stores a `sha256` per document, so it can recognise a file this
# conversation holds before any upstream call. Recognising it here is better than
# recognising it there — ingestion answers with an id, and an id it minted for a
# different conversation is exactly what broke this route; the sha256 column is
# scoped to the conversation by construction. It also means a re-upload no longer
# ships the bytes across the network at all.

@pytest.mark.asyncio
async def test_a_file_this_conversation_already_has_is_settled_locally(
    user, monkeypatch
):
    row = {"id": DOC_ID, "conversation_id": CONV_ID, "user_id": 1,
           "status": ProcessingStatus.COMPLETED}

    result, doc_repo, upstream = await _run(
        None, monkeypatch, user=user, same_content_row=row
    )

    upstream.assert_not_awaited()
    doc_repo.create.assert_not_awaited()
    assert result.document_id == DOC_ID


@pytest.mark.asyncio
async def test_the_same_file_in_another_conversation_is_a_document_of_its_own(
    user, monkeypatch
):
    """The lookup is scoped to this conversation, so another conversation's copy
    is not visible to it and the upload proceeds normally."""
    result, doc_repo, upstream = await _run(
        None, monkeypatch, user=user, same_content_row=None
    )

    upstream.assert_awaited_once()
    doc_repo.find_by_sha256.assert_awaited_once()
    assert doc_repo.find_by_sha256.await_args.args[1:] == (
        CONV_ID, hashlib.sha256(b"the same bytes as last time").hexdigest(),
    )
    doc_repo.create.assert_awaited_once()
    assert result.document_id == DOC_ID


# ── a unit's repository is another one of those spaces ───────────────────────────
#
# The "kho" is not a different kind of storage: it is a conversation of its own,
# a hidden one keyed by unit, which conversation_id the documents carry. So it
# inherited the whole defect. A super-admin who focuses unit A, uploads a file,
# then focuses unit B and uploads the same file asked ingestion twice, got one id
# back, and the second insert died on the primary key — the very 500 fixed for
# chat, still live on the admin route. The same two guards close it here.

REPO_CONV_ID = 99
REPO_USER = {"id": 7, "username": "admin", "unit_id": 5, "is_admin": True}


async def _run_repo(monkeypatch, *, existing_row=None, same_content_row=None):
    upstream = AsyncMock(return_value={"document_id": DOC_ID, "status": "COMPLETED"})
    monkeypatch.setattr(document_routes, "_create_remote_document", upstream)
    monkeypatch.setattr(document_routes, "audit_log", lambda *a, **k: None)
    monkeypatch.setattr(document_routes, "_process_repo_document", AsyncMock())

    conv_repo = AsyncMock()
    conv_repo.find_repository_conversation = AsyncMock(return_value=REPO_CONV_ID)
    doc_repo = AsyncMock()
    doc_repo.find_by_sha256 = AsyncMock(return_value=same_content_row)
    doc_repo.find_visible = AsyncMock(return_value=existing_row)
    doc_repo.create = AsyncMock()

    result = await document_routes.upload_repository_document(
        request=None,
        file=_upload(),
        group_id=None,
        unit_id=None,
        current_user=REPO_USER,
        conv_repo=conv_repo,
        doc_repo=doc_repo,
    )
    return result, doc_repo, upstream


@pytest.mark.asyncio
async def test_a_repository_upload_names_its_conversation_upstream(monkeypatch):
    """Ingestion scopes dedup by conversation, so it has to be told which one.
    Without this the repository upload was the one caller still dedup'ing in the
    unscoped bucket — across every unit at once."""
    _, _, upstream = await _run_repo(monkeypatch)

    assert upstream.await_args.kwargs["conversation_id"] == REPO_CONV_ID


@pytest.mark.asyncio
async def test_a_file_this_repository_already_has_is_settled_locally(monkeypatch):
    row = {"id": DOC_ID, "conversation_id": REPO_CONV_ID, "user_id": 7,
           "name": "phatbieu.docx", "group_id": None,
           "status": ProcessingStatus.COMPLETED}

    result, doc_repo, upstream = await _run_repo(
        monkeypatch, same_content_row=row
    )

    upstream.assert_not_awaited()
    doc_repo.create.assert_not_awaited()
    assert result.id == DOC_ID


@pytest.mark.asyncio
async def test_a_repository_dedup_hit_does_not_insert_again(monkeypatch):
    """Ingestion answered with a document this repository already holds."""
    row = {"id": DOC_ID, "conversation_id": REPO_CONV_ID, "user_id": 7,
           "name": "phatbieu.docx", "group_id": None,
           "status": ProcessingStatus.COMPLETED}

    result, doc_repo, _ = await _run_repo(monkeypatch, existing_row=row)

    doc_repo.create.assert_not_awaited()
    assert result.id == DOC_ID


@pytest.mark.asyncio
async def test_a_repository_document_held_elsewhere_is_refused_cleanly(monkeypatch):
    """Another unit's repository, or a chat conversation: a 409, not a crash."""
    row = {"id": DOC_ID, "conversation_id": 3, "user_id": 7,
           "name": "phatbieu.docx", "group_id": None,
           "status": ProcessingStatus.COMPLETED}

    with pytest.raises(HTTPException) as exc:
        await _run_repo(monkeypatch, existing_row=row)

    assert exc.value.status_code == 409
