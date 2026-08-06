"""Document routes — upload/delete proxy to AI ingest service, lazy sync."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
import hashlib
import logging
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile, File, status
from starlette.responses import StreamingResponse

from app.config import settings
from app.constants.audit import AuditActions, AuditEntityTypes
from app.constants.errors import ErrorMessages
from app.constants.status import ProcessingStatus, UpstreamStatus
from app.middlewares.auth import (
    get_current_user,
    get_current_user_sse,
    require_permission,
)
from app.models.access import Principal
from app.repositories.base import ConversationRepository, DocumentRepository
from app.repositories.factory import (
    get_conversation_repository,
    get_document_repository,
)
from app.models.schemas import (
    DocRepoItem,
    DocRepoListResponse,
    DocumentListResponse,
    DocumentOut,
    DocumentPagesResponse,
    DocumentsResponse,
    LinkRepoDocsRequest,
    ProcessResponse,
    RepoSearchRequest,
    UnitRepoListResponse,
    UpdateDocRepoRequest,
    UpdateDocumentRequest,
    DocumentPreviewRequest,
    DocumentPreviewResponse,
    PagePreview,
)
from starlette.responses import Response
from app.utils.audit import audit_log
from app.utils.helpers import fix_filename_encoding, utcnow

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Dev Space read-only corpus guard ────────────────────────────────
# Dev Space points AI_INGEST_HOST at a corpus it does not own, so every
# helper below that MUTATES that corpus calls this first. The guard lives
# in the helpers, not only on the routes, because the helpers are where the
# damage is: `_delete_remote_document` issues a real DELETE against the
# ingest service, and a Dev Space user deleting a conversation would take
# real documents out of the real index with it.
#
# Read helpers (`_fetch_remote_*`, `_read_remote_task_status`,
# `_fetch_remote_status`) are deliberately NOT guarded — reading the corpus
# is the whole point of Dev Space. So is `link_repository_documents`, which
# attaches existing documents by reference and never calls upstream at all.


def _assert_corpus_writable() -> None:
    """Refuse a mutating upstream call when this gateway is read-only.

    Raises:
        HTTPException: 403 when ``DEV_READONLY_CORPUS`` is set.
    """
    if settings.dev_readonly_corpus:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=ErrorMessages.READONLY_CORPUS,
        )


async def forbid_readonly() -> None:
    """Route dependency: fail a write route early, before the body is read.

    The UX half of the guard. :func:`_assert_corpus_writable` is the half
    that actually protects the corpus; this one exists so the user gets a
    clean 403 instead of uploading 40 MB and then being refused.
    """
    _assert_corpus_writable()


# ── Upstream helpers ────────────────────────────────────────────────

async def _create_remote_document(
    file_bytes: bytes,
    filename: str,
    content_type: str,
    *,
    owner_id: int | str,
    conversation_id: int | str | None = None,
) -> dict:
    """Upload file binary to AI ingest service.

    ``owner_id`` is not optional: the ingestion service scopes both dedup tiers
    to an owner and reads it from the query string, treating its absence as
    "never deduplicate". Uploading without it silently disables dedup for every
    file that comes through the UI.

    ``conversation_id`` narrows tier-0 dedup to this conversation, read from the
    same query string. Without it the service matches on owner alone and can
    answer with a document that belongs to a different conversation — an id this
    gateway cannot store, because its own table is keyed on it.
    """
    _assert_corpus_writable()
    params = {"user_id": str(owner_id)}
    if conversation_id is not None:
        params["conversation_id"] = str(conversation_id)
    async with httpx.AsyncClient(timeout=600, follow_redirects=True) as client:
        resp = await client.post(
            f"{settings.effective_ai_ingest_host}/documents",
            params=params,
            files={"file": (filename, file_bytes, content_type or "application/octet-stream")},
        )
        resp.raise_for_status()
        return resp.json()


async def _process_remote_document(
    document_id: str, *, conversation_id: int | None = None
) -> dict:
    """Start processing on the AI ingest service."""
    _assert_corpus_writable()
    params: dict = {}
    if conversation_id is not None:
        params["conversation_id"] = str(conversation_id)
    async with httpx.AsyncClient(timeout=600, follow_redirects=True) as client:
        resp = await client.post(
            f"{settings.effective_ai_ingest_host}/documents/{document_id}/process",
            params=params,
        )
        resp.raise_for_status()
        return resp.json()


async def _process_repo_document(
    doc_repo: "DocumentRepository",
    principal: "Principal",
    document_id: str,
    conv_id: int,
) -> None:
    """Story 21: kick off AI processing for a repository document and record the
    resulting status (chunks + page images).

    The file is already stored at this point, so a processing failure is recorded
    as ``ERROR`` and NOT raised — the admin can replace the file to retry instead
    of the whole upload failing and leaving the doc stuck on ``PENDING``. Mirrors
    the chat ``process_document`` flow.

    The read-only check is deliberately OUTSIDE the try: the except arm writes
    ``ERROR`` onto the document row, and a Dev Space refusal is not a property
    of the document.
    """
    _assert_corpus_writable()
    try:
        processed = await _process_remote_document(
            document_id, conversation_id=conv_id
        )
        proc_status = (
            processed.get("status") or ProcessingStatus.PENDING
        ).upper()
        await doc_repo.update(principal, document_id, {
            "status": proc_status,
            "chunk_count": processed.get("chunk_count", 0),
            "task_id": processed.get("task_id"),
        })
        logger.info(
            "[repositoryProcess] processing started for %s: status=%s",
            document_id, proc_status,
        )
    except Exception as exc:
        await doc_repo.update(principal, document_id, {
            "status": ProcessingStatus.ERROR,
            "message": str(exc),
        })
        logger.error(
            "[repositoryProcess] processing failed for %s: %s",
            document_id, exc,
        )


async def _read_remote_task_status(task_id: str) -> str:
    """Read an AI ingest Celery task's status (story 46).

    Mirrors the chat task poll (``llm.document_status``): GET
    ``{ai_ingest}/documents/task/{task_id}`` → upstream status string
    (``UpstreamStatus``: PENDING/PROCESSING/SUCCESS/FAILURE).

    Raises:
        httpx.HTTPStatusError / httpx error on a non-2xx or unreachable upstream.
    """
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        resp = await client.get(
            f"{settings.effective_ai_ingest_host}/documents/task/{task_id}"
        )
        resp.raise_for_status()
        return (resp.json().get("status") or UpstreamStatus.PROCESSING).upper()


def _map_upstream_status(upstream: str | None) -> str | None:
    """Map an upstream status to a TERMINAL app status, or None if not terminal.

    SUCCESS/COMPLETED → COMPLETED; FAILED/FAILURE/ERROR → ERROR; anything else
    (PENDING/PROCESSING) → None (still in flight, do not write back).

    ``FAILED`` is the word ``/documents/{id}/status`` actually returns for a
    document whose processing raised — ``UpstreamStatus.FAILURE`` is the Celery
    task state, which is what ``/documents/task/{id}`` returns. Only the latter
    was handled, so a failed document read as "still in flight" and its row was
    never written back.
    """
    up = (upstream or "").upper()
    if up in (UpstreamStatus.SUCCESS, ProcessingStatus.COMPLETED):
        return ProcessingStatus.COMPLETED
    if up in (UpstreamStatus.FAILURE, UpstreamStatus.FAILED, ProcessingStatus.ERROR):
        return ProcessingStatus.ERROR
    return None


async def _preview_remote_document(document_id: str) -> dict:
    """Preview parsing & chunking on the AI ingest service.

    Args:
        document_id: The UUID of the document to preview.

    Returns:
        A dictionary containing the document preview data.
    """
    _assert_corpus_writable()
    async with httpx.AsyncClient(
        timeout=600, follow_redirects=True
    ) as client:
        url = (
            f"{settings.effective_ai_ingest_host}"
            f"/documents/{document_id}/preview"
        )
        resp = await client.post(url)
        resp.raise_for_status()
        return resp.json()


async def _fetch_remote_document_detail(document_id: str) -> dict:
    """Fetch full document detail from the AI ingest service (story 22).

    ``GET /documents/{id}`` returns ``pages[].page_content`` (the FULL digitized
    text per page), unlike ``/preview`` which only returns a truncated
    ``content_preview``.

    Raises:
        httpx.HTTPStatusError: on a non-2xx upstream status.
    """
    async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
        resp = await client.get(
            f"{settings.effective_ai_ingest_host}/documents/{document_id}"
        )
        resp.raise_for_status()
        return resp.json()


async def _fetch_remote_document_file(
    document_id: str,
) -> tuple[bytes, str]:
    """Fetch the original file (e.g. PDF) from the AI ingest service (story 22).

    Returns a ``(bytes, content_type)`` tuple for the "File gốc" tab.

    Raises:
        httpx.HTTPStatusError: on a non-2xx upstream status.
    """
    async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
        resp = await client.get(
            f"{settings.effective_ai_ingest_host}"
            f"/documents/{document_id}/file"
        )
        resp.raise_for_status()
        content_type = resp.headers.get(
            "content-type", "application/octet-stream"
        )
        return resp.content, content_type


async def _fetch_remote_page_image(
    document_id: str, page_no: int
) -> tuple[bytes, str]:
    """Fetch an original page image from the AI ingest service (MinIO-backed).

    Args:
        document_id: The document UUID.
        page_no: 1-based page number.

    Returns:
        A ``(bytes, content_type)`` tuple for the page image.

    Raises:
        httpx.HTTPStatusError: if the upstream returns a non-2xx status.
    """
    async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
        resp = await client.get(
            f"{settings.effective_ai_ingest_host}"
            f"/documents/{document_id}/pages/{page_no}/image"
        )
        resp.raise_for_status()
        # Story 30: do NOT default to "image/png". A missing/empty content-type
        # used to masquerade as a real image, so a non-image body slipped through
        # to the FE as a blank <img>. Pass the raw content-type through and let
        # the route decide whether it is actually an image.
        content_type = resp.headers.get("content-type", "")
        return resp.content, content_type


async def _delete_remote_document(document_id: str) -> None:
    """Delete from AI ingest service (404 = success).

    Under ``DEV_READONLY_CORPUS`` this raises before any request is sent. The
    chat delete route already wraps this call in ``try/except: pass``, so the
    net effect there is exactly what Dev Space wants: the gateway's own row
    goes away, the real document stays in the real index. The rollback call
    sites are unreachable in read-only mode — their create is refused first.
    """
    _assert_corpus_writable()
    async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
        resp = await client.delete(
            f"{settings.effective_ai_ingest_host}/documents/{document_id}"
        )
        if resp.status_code not in (200, 204, 404):
            resp.raise_for_status()


@dataclass(frozen=True)
class RemoteDocumentState:
    """What the ingest service says about a document, or that it did not say.

    ``reachable`` is the distinction the previous probe lacked. It returned a
    bare bool and folded "BE answered 404" together with "BE did not answer",
    so a 502 from a restarting service was indistinguishable from a deleted
    document — and the caller wrote ERROR for both.
    """

    reachable: bool
    exists: bool = False
    status: str | None = None


async def _fetch_remote_status(document_id: str) -> RemoteDocumentState:
    """Ask the ingest service what state a document is in.

    Uses ``/documents/{id}/status`` rather than ``/documents/{id}``: the latter
    attaches every page's OCR text to the response, which is megabytes per
    scanned document, for an answer this reads one field of.
    """
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
            resp = await client.get(
                f"{settings.effective_ai_ingest_host}/documents/{document_id}/status"
            )
    except Exception:
        return RemoteDocumentState(reachable=False)

    if resp.status_code == 404:
        return RemoteDocumentState(reachable=True, exists=False)
    if resp.status_code != 200:
        # A server error says nothing about the document. Treating it as absence
        # is what turned a rolling restart into a conversation of dead rows.
        return RemoteDocumentState(reachable=False)

    try:
        status_value = (resp.json() or {}).get("status")
    except Exception:
        return RemoteDocumentState(reachable=False)
    return RemoteDocumentState(reachable=True, exists=True, status=status_value)


async def _check_remote_document(document_id: str) -> bool:
    """Whether the ingest service currently holds this document.

    Kept for the pre-flight checks that only need a yes/no. Note the asymmetry
    with :func:`_fetch_remote_status`: an unreachable service answers False here,
    which is safe for "may this query run" but never safe for "write ERROR".
    """
    state = await _fetch_remote_status(document_id)
    return state.reachable and state.exists


# ── Sync logic ──────────────────────────────────────────────────────

async def sync_documents_internal(
    principal: Principal,
    conv_repo: ConversationRepository,
    doc_repo: DocumentRepository,
    conv_id: int,
    probe=_fetch_remote_status,
) -> dict:
    """Reconcile a conversation's document rows against the ingest service.

    This is the only server-side writer of a document's terminal status. The
    browser also writes one, from the SSE listener, but a tab that is closed
    when processing finishes never does — which left rows PROCESSING for weeks
    while the documents behind them were fully indexed and answerable.

    Two rules keep the reconciliation from doing harm of its own. A row is only
    written when the service actually answered: silence is not a verdict. And
    APPROVED is left alone, because a human set it.

    The probes fan out concurrently, but the writes they decide on are applied one
    at a time: every repository here shares the request's single AsyncSession, and
    two overlapping `session.commit()` calls raise IllegalStateChangeError — which
    surfaced as a 500 on the whole listing, hiding every document in the
    conversation.
    """
    row = await conv_repo.find_visible(principal, conv_id)
    if not row:
        return {"missing_count": 0}

    docs = await doc_repo.find_by_conversation(principal, conv_id)
    if not docs:
        await conv_repo.update_field(
            principal, conv_id, "last_synced_at", utcnow()
        )
        return {"missing_count": 0}

    missing_count = 0

    async def _check_one(doc: dict) -> tuple[str, dict, bool] | None:
        """Probe one document and return ``(id, fields, is_missing)`` for the write
        it needs, or None. Touches no repository — see the note above on the
        shared session."""
        if doc["status"] == ProcessingStatus.APPROVED:
            return None
        try:
            state = await probe(doc["id"])
        except Exception:
            return None

        if not state.reachable:
            return None

        if not state.exists:
            if doc["status"] != ProcessingStatus.ERROR:
                return doc["id"], {
                    "status": ProcessingStatus.ERROR,
                    "message": "Document missing from AI service",
                }, True
            return None

        # ERROR is not skipped here on purpose: a row marked ERROR by an earlier
        # transient fault must be able to recover once the service answers again.
        terminal = _map_upstream_status(state.status)
        if terminal and terminal != doc["status"]:
            return doc["id"], {
                "status": terminal,
                "message": None if terminal == ProcessingStatus.COMPLETED
                else "Xử lý tài liệu thất bại",
            }, False
        return None

    writes = await asyncio.gather(*[_check_one(d) for d in docs])

    for write in writes:
        if write is None:
            continue
        document_id, fields, is_missing = write
        missing_count += is_missing
        await doc_repo.update(principal, document_id, fields)

    await conv_repo.update_field(
        principal, conv_id, "last_synced_at", utcnow()
    )
    return {"missing_count": missing_count}


async def sync_documents_background(principal: Principal, conv_id: int) -> None:
    """Run a sync from a fire-and-forget task using its own DB session.

    Request-scoped repositories must not be used after the request ends, so
    background callers open a fresh session here.
    """
    from app.db import get_session_factory
    from app.repositories.factory import (
        make_conversation_repository,
        make_document_repository,
    )

    factory = get_session_factory()
    async with factory() as session:
        await sync_documents_internal(
            principal,
            make_conversation_repository(session),
            make_document_repository(session),
            conv_id,
        )


def _to_doc_out(d: dict) -> DocumentOut:
    return DocumentOut(**d)


async def _resolve_viewable_doc(
    principal: Principal,
    conv_id: int,
    document_id: str,
    doc_repo: DocumentRepository,
) -> dict | None:
    """Resolve a document the caller may VIEW within a conversation (story 20).

    A document is viewable if it is a document of this conversation, OR a
    repository document linked into this conversation by reference (story 16).
    The latter has its own ``conversation_id`` (the repository conversation) and
    is owner-scoped away from a regular user's ``find_visible``, so it is read
    via the conversation's linked-repo list instead.

    Returns the document row, or ``None`` when it is neither — callers map that
    to 404. WRITE routes must NOT use this helper; they keep the strict
    conversation check.
    """
    doc = await doc_repo.find_visible(principal, document_id)
    if doc and doc["conversation_id"] == conv_id:
        return doc
    for linked in await doc_repo.find_linked_repo_documents(conv_id):
        if str(linked["id"]) == str(document_id):
            return linked
    return None


# ── Routes ──────────────────────────────────────────────────────────


@router.get(
    "/users/{user_id}/conversations/{conv_id}/documents/events",
)
async def document_events_proxy(
    request: Request,
    user_id: int,
    conv_id: int,
    doc_ids: Optional[str] = Query(
        None, description="Comma-separated document IDs for initial snapshot"
    ),
    token: Optional[str] = Query(
        None, description="JWT token (EventSource cannot set headers)"
    ),
    _user: dict = Depends(get_current_user_sse),
    conv_repo: ConversationRepository = Depends(get_conversation_repository),
):
    """Proxy SSE events from the AI ingest service's Redis pub/sub stream.

    The ingest service uses ``conversation_id`` as the pub/sub channel key
    (``session_id``).  We forward it so the FE receives real-time status
    updates for all documents in this conversation.

    Accepts JWT via either ``Authorization: Bearer <token>`` header or
    ``?token=<token>`` query param (``EventSource`` cannot set headers) —
    see :func:`get_current_user_sse`, which verifies it the same way every
    other route does.
    """
    if _user.get("id") != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=ErrorMessages.PERMISSION_DENIED,
        )

    # The upstream is keyed purely on session_id=conv_id, so it will serve any
    # conversation asked of it. Matching the token to the path user proves
    # nothing about the conversation — the caller picked both.
    if not await conv_repo.find_visible(Principal.from_user(_user), conv_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessages.NOT_FOUND,
        )

    upstream_url = (
        f"{settings.effective_ai_ingest_host}/documents/events"
    )
    params: dict = {"session_id": str(conv_id)}
    if doc_ids:
        params["doc_ids"] = doc_ids

    async def _stream():
        async with httpx.AsyncClient(
            timeout=None, follow_redirects=True
        ) as client:
            async with client.stream(
                "GET", upstream_url, params=params
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    yield line + "\n"

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.get(
    "/users/{user_id}/conversations/{conv_id}/documents",
    response_model=DocumentListResponse,
)
async def get_documents(
    user_id: int,
    conv_id: int,
    _user: dict = Depends(get_current_user),
    conv_repo: ConversationRepository = Depends(get_conversation_repository),
    doc_repo: DocumentRepository = Depends(get_document_repository),
):
    principal = Principal.from_user(_user)
    row = await conv_repo.find_visible(principal, conv_id)
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessages.NOT_FOUND,
        )

    # Lazy sync
    last_sync = row.get("last_synced_at")
    should_sync = not last_sync or (
        datetime.now(timezone.utc) - last_sync.replace(tzinfo=timezone.utc)
    ).total_seconds() > 60

    sync_result = None
    if should_sync:
        sync_result = await sync_documents_internal(
            principal, conv_repo, doc_repo, conv_id
        )

    docs = await doc_repo.find_by_conversation(principal, conv_id)
    # Story 16: repository documents linked into this conversation by reference
    # are shown alongside the conversation's own documents so the user can see
    # and select them. They are not conversation rows, so they are appended here
    # (not via find_by_conversation, which the upload/delete flows rely on).
    seen = {str(d["id"]) for d in docs}
    linked = [
        {**d, "from_repository": True}
        for d in await doc_repo.find_linked_repo_documents(conv_id)
        if str(d["id"]) not in seen
    ]
    docs = docs + linked
    final_row = await conv_repo.find_visible(principal, conv_id)

    return DocumentListResponse(
        documents=[_to_doc_out(d) for d in docs],
        last_synced_at=final_row["last_synced_at"] if final_row else None,
        syncResult=sync_result,
    )


@router.post(
    "/users/{user_id}/conversations/{conv_id}/documents/upload",
    response_model=DocumentsResponse,
    dependencies=[Depends(forbid_readonly)],
)
async def upload_document(
    request: Request,
    user_id: int,
    conv_id: int,
    file: UploadFile = File(...),
    _user: dict = Depends(get_current_user),
    conv_repo: ConversationRepository = Depends(get_conversation_repository),
    doc_repo: DocumentRepository = Depends(get_document_repository),
):
    principal = Principal.from_user(_user)
    row = await conv_repo.find_visible(principal, conv_id)
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessages.NOT_FOUND,
        )

    file_bytes = await file.read()
    sha = hashlib.sha256(file_bytes).hexdigest()
    safe_name = fix_filename_encoding(file.filename) or file.filename

    # A re-upload into this conversation is settled here, without ingestion.
    # This table already records the content hash of every document in it, and
    # that hash is scoped to the conversation by construction — whereas ingestion
    # answers with an id, and an id it minted for a different conversation is
    # exactly what collided with this table's primary key and made every
    # re-upload a 500. It also spares the network a second copy of the bytes.
    twin = await doc_repo.find_by_sha256(principal, conv_id, sha)
    if twin is not None:
        logger.info(
            "[uploadDocument] Conversation %s already holds this file as %s; "
            "reusing it instead of uploading again", conv_id, twin["id"],
        )
        docs_after = await doc_repo.find_by_conversation(principal, conv_id)
        return DocumentsResponse(
            documents=[_to_doc_out(d) for d in docs_after],
            document_id=twin["id"],
        )

    # Upload to AI service (storage only — no processing)
    created = await _create_remote_document(
        file_bytes, safe_name, file.content_type,
        owner_id=principal.id, conversation_id=conv_id,
    )
    document_id = created.get("document_id")
    if not document_id:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=ErrorMessages.UPSTREAM_ERROR,
        )

    # Ingestion deduplicates: re-uploading a file this conversation already has
    # answers with the id of the existing document rather than a new one. That id
    # is this table's primary key, so inserting it again is a UniqueViolation —
    # which is what made every re-upload a 500. Treat it as the idempotent path.
    existing = await doc_repo.find_visible(principal, document_id)
    if existing is not None:
        if existing["conversation_id"] != conv_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=ErrorMessages.DOC_CONVERSATION_CONFLICT,
            )
        logger.info(
            "[uploadDocument] Ingestion deduplicated %s into conversation %s; "
            "reusing the existing row", document_id, conv_id,
        )
    else:
        # Insert into normalized document table with UPLOADED status. The document
        # is owned by the authenticated uploader (used by unit-tree scoping).
        await doc_repo.create({
            "id": document_id,
            "conversation_id": conv_id,
            "user_id": principal.id,
            "name": safe_name,
            "sha256": sha,
            "status": ProcessingStatus.UPLOADED,
            "chunk_count": 0,
            "task_id": None,
        })

    docs_after = await doc_repo.find_by_conversation(principal, conv_id)

    audit_log(
        request,
        AuditActions.DOCUMENT_UPLOAD,
        AuditEntityTypes.CONVERSATION,
        entity_id=conv_id,
        conversation_id=conv_id,
        metadata={"added": 1, "name": safe_name},
    )

    return DocumentsResponse(
        documents=[_to_doc_out(d) for d in docs_after],
        document_id=document_id,
    )


@router.post(
    "/users/{user_id}/conversations/{conv_id}/documents/{document_id}/process",
    response_model=ProcessResponse,
    dependencies=[Depends(forbid_readonly)],
)
async def process_document(
    request: Request,
    user_id: int,
    conv_id: int,
    document_id: str,
    _user: dict = Depends(get_current_user),
    conv_repo: ConversationRepository = Depends(get_conversation_repository),
    doc_repo: DocumentRepository = Depends(get_document_repository),
):
    """Trigger AI processing for a previously uploaded document."""
    principal = Principal.from_user(_user)
    row = await conv_repo.find_visible(principal, conv_id)
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessages.NOT_FOUND,
        )

    doc = await doc_repo.find_visible(principal, document_id)
    if not doc or doc["conversation_id"] != conv_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessages.DOC_NOT_FOUND,
        )

    try:
        processed = await _process_remote_document(
            document_id, conversation_id=conv_id
        )
        proc_status = (processed.get("status") or ProcessingStatus.PENDING).upper()
        await doc_repo.update(principal, document_id, {
            "status": proc_status,
            "chunk_count": processed.get("chunk_count", 0),
            "task_id": processed.get("task_id"),
        })
        logger.info(
            "[processDocument] Processing started for %s: status=%s, task_id=%s",
            document_id, proc_status, processed.get("task_id"),
        )
    except Exception as exc:
        await doc_repo.update(principal, document_id, {
            "status": ProcessingStatus.ERROR,
            "message": str(exc),
        })
        logger.error(
            "[processDocument] Processing failed for %s: %s",
            document_id, exc,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=ErrorMessages.UPSTREAM_ERROR,
        )

    audit_log(
        request,
        AuditActions.DOCUMENT_STATUS,
        AuditEntityTypes.DOCUMENT,
        entity_id=document_id,
        conversation_id=conv_id,
        metadata={"action": "process", "status": proc_status},
    )

    return ProcessResponse(
        document_id=document_id,
        status=proc_status,
        task_id=processed.get("task_id"),
    )


@router.delete(
    "/users/{user_id}/conversations/{conv_id}/documents/{document_id}",
    response_model=DocumentsResponse,
)
async def delete_document(
    request: Request,
    user_id: int,
    conv_id: int,
    document_id: str,
    _user: dict = Depends(get_current_user),
    conv_repo: ConversationRepository = Depends(get_conversation_repository),
    doc_repo: DocumentRepository = Depends(get_document_repository),
):
    principal = Principal.from_user(_user)
    row = await conv_repo.find_visible(principal, conv_id)
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessages.NOT_FOUND,
        )

    doc = await doc_repo.find_visible(principal, document_id)
    if not doc or doc["conversation_id"] != conv_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessages.DOC_NOT_FOUND,
        )

    try:
        await _delete_remote_document(document_id)
    except Exception:
        pass

    await doc_repo.delete(principal, document_id)

    docs_after = await doc_repo.find_by_conversation(principal, conv_id)

    audit_log(
        request,
        AuditActions.DOCUMENT_DELETE,
        AuditEntityTypes.DOCUMENT,
        entity_id=document_id,
        conversation_id=conv_id,
        metadata={"name": doc["name"]},
    )
    return DocumentsResponse(documents=[_to_doc_out(d) for d in docs_after])


@router.patch(
    "/users/{user_id}/conversations/{conv_id}/documents/{document_id}",
    response_model=DocumentsResponse,
)
async def update_document(
    request: Request,
    user_id: int,
    conv_id: int,
    document_id: str,
    body: UpdateDocumentRequest,
    _user: dict = Depends(get_current_user),
    conv_repo: ConversationRepository = Depends(get_conversation_repository),
    doc_repo: DocumentRepository = Depends(get_document_repository),
):
    principal = Principal.from_user(_user)
    row = await conv_repo.find_visible(principal, conv_id)
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessages.NOT_FOUND,
        )

    patch: dict = {}
    if body.name:
        patch["name"] = body.name
    if body.status:
        patch["status"] = body.status.upper()
    if body.chunk_count is not None:
        patch["chunk_count"] = body.chunk_count
    if body.task_id is not None:
        patch["task_id"] = body.task_id

    if not patch:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=ErrorMessages.NO_FIELDS_UPDATE,
        )

    result = await doc_repo.update(principal, document_id, patch)
    if result["changes"] == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessages.DOC_NOT_FOUND,
        )

    docs_after = await doc_repo.find_by_conversation(principal, conv_id)

    if body.name or body.status == ProcessingStatus.COMPLETED:
        audit_log(
            request,
            AuditActions.DOCUMENT_RENAME if body.name else AuditActions.DOCUMENT_STATUS,
            AuditEntityTypes.DOCUMENT,
            entity_id=document_id,
            conversation_id=conv_id,
            metadata={"changes": body.model_dump(exclude_none=True)},
        )

    return DocumentsResponse(documents=[_to_doc_out(d) for d in docs_after])


@router.post(
    "/users/{user_id}/conversations/{conv_id}"
    "/documents/{document_id}/preview",
    response_model=DocumentPreviewResponse,
    dependencies=[Depends(forbid_readonly)],
)
async def preview_document(
    request: Request,
    user_id: int,
    conv_id: int,
    document_id: str,
    body: Optional[DocumentPreviewRequest] = None,
    _user: dict = Depends(get_current_user),
    conv_repo: ConversationRepository = Depends(get_conversation_repository),
    doc_repo: DocumentRepository = Depends(get_document_repository),
) -> DocumentPreviewResponse:
    """Preview a document's extracted content and chunks.

    Args:
        request: The FastAPI request object.
        user_id: The ID of the user.
        conv_id: The ID of the conversation.
        document_id: The UUID of the document to preview.
        body: The preview request body.
        _user: The currently authenticated user.

    Returns:
        The preview response containing summary and first page.
    """
    principal = Principal.from_user(_user)
    row = await conv_repo.find_visible(principal, conv_id)
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessages.NOT_FOUND,
        )

    doc = await _resolve_viewable_doc(
        principal, conv_id, document_id, doc_repo
    )
    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessages.DOC_NOT_FOUND,
        )

    try:
        preview_data = await _preview_remote_document(document_id)
        doc_info = preview_data.get("document", {})
        name = doc["name"]
        page_count = doc_info.get("page_count") or 0
        summary = doc_info.get("summary")

        pages = doc_info.get("pages", [])
        first_5_pages = []
        for p in pages[:5]:
            first_5_pages.append(
                PagePreview(
                    page_number=p.get("page_number", 1),
                    content=p.get("content_preview") or p.get(
                        "page_content"
                    ),
                )
            )

        if not first_5_pages and doc_info.get("doc_content_preview"):
            first_5_pages.append(
                PagePreview(
                    page_number=1,
                    content=doc_info["doc_content_preview"],
                )
            )

        return DocumentPreviewResponse(
            name=name,
            page_count=page_count,
            summary=summary,
            first_5_pages=first_5_pages,
        )
    except Exception as exc:
        logger.error(
            "[previewDocument] Preview failed for %s: %s",
            document_id,
            exc,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=ErrorMessages.UPSTREAM_ERROR,
        )


# ── Document viewer (story 15): per-page text + original page image ─────
#
# The viewer has two tabs:
#   • "Nội dung số hoá" — digitized OCR text per page, already produced at
#     process time and reachable via the existing preview proxy.
#   • "File gốc" — the original page image (MinIO-backed) served by the AI
#     ingest service at GET /documents/{id}/pages/{n}/image. This route proxies
#     it. If the upstream errors (it may, while that service is being fixed),
#     we return 502 and the FE shows a graceful fallback instead of a broken
#     image.


@router.get(
    "/users/{user_id}/conversations/{conv_id}"
    "/documents/{document_id}/pages",
    response_model=DocumentPagesResponse,
)
async def get_document_pages(
    user_id: int,
    conv_id: int,
    document_id: str,
    _user: dict = Depends(get_current_user),
    conv_repo: ConversationRepository = Depends(get_conversation_repository),
    doc_repo: DocumentRepository = Depends(get_document_repository),
) -> DocumentPagesResponse:
    """Return every page's digitized text for the viewer.

    Reuses the upstream preview proxy. Returns as many pages as the upstream
    provides (today that may be capped — see story 15 deferred note).
    """
    principal = Principal.from_user(_user)
    row = await conv_repo.find_visible(principal, conv_id)
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessages.NOT_FOUND,
        )

    doc = await _resolve_viewable_doc(
        principal, conv_id, document_id, doc_repo
    )
    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessages.DOC_NOT_FOUND,
        )

    # Story 22: source the FULL per-page text from GET /documents/{id}
    # (``pages[].page_content``) instead of /preview (truncated content_preview).
    try:
        detail = await _fetch_remote_document_detail(document_id)
    except Exception as exc:
        logger.error(
            "[getDocumentPages] Upstream failed for %s: %s", document_id, exc
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=ErrorMessages.UPSTREAM_ERROR,
        )

    pages = []
    for p in detail.get("pages", []):
        pages.append(
            PagePreview(
                page_number=p.get("page_number", 1),
                content=p.get("page_content") or p.get("content_preview"),
                char_start=p.get("char_start"),
                char_end=p.get("char_end"),
            )
        )
    return DocumentPagesResponse(
        name=doc["name"],
        page_count=detail.get("page_count") or len(pages),
        pages=pages,
    )


@router.get(
    "/users/{user_id}/conversations/{conv_id}"
    "/documents/{document_id}/pages/{page_no}/image",
)
async def get_document_page_image(
    user_id: int,
    conv_id: int,
    document_id: str,
    page_no: int,
    _user: dict = Depends(get_current_user),
    conv_repo: ConversationRepository = Depends(get_conversation_repository),
    doc_repo: DocumentRepository = Depends(get_document_repository),
) -> Response:
    """Proxy the original page image for the "File gốc" tab.

    Enforces visibility (404 for invisible docs), then streams the page image
    from the AI ingest service. Distinguishes the two upstream failure modes so
    the FE can react correctly:
      * upstream 404 (the document has no page image yet) → 404, the FE shows a
        "no image" fallback;
      * any other upstream failure (5xx / timeout / network) → 502, a real error.
    """
    principal = Principal.from_user(_user)
    row = await conv_repo.find_visible(principal, conv_id)
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessages.NOT_FOUND,
        )

    doc = await _resolve_viewable_doc(
        principal, conv_id, document_id, doc_repo
    )
    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessages.DOC_NOT_FOUND,
        )

    try:
        image_bytes, content_type = await _fetch_remote_page_image(
            document_id, page_no
        )
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == status.HTTP_404_NOT_FOUND:
            # The document simply has no page image yet — not an error.
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=ErrorMessages.PAGE_IMAGE_NOT_FOUND,
            )
        logger.error(
            "[getDocumentPageImage] Upstream %s for %s p%s",
            exc.response.status_code,
            document_id,
            page_no,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=ErrorMessages.PAGE_IMAGE_UNAVAILABLE,
        )
    except Exception as exc:
        logger.error(
            "[getDocumentPageImage] Upstream failed for %s p%s: %s",
            document_id,
            page_no,
            exc,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=ErrorMessages.PAGE_IMAGE_UNAVAILABLE,
        )

    # Story 30: the upstream can answer 200 with an empty / non-image body for a
    # page it cannot render (e.g. some docx pages). That would reach the FE as a
    # blank <img> and defeat both viewer fallbacks. Treat "not actually an image"
    # as "no page image" (404) so the FE falls back to the page-number/text card
    # and the whole-file renderer.
    if not image_bytes or not content_type.lower().startswith("image/"):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessages.PAGE_IMAGE_NOT_FOUND,
        )

    return Response(
        content=image_bytes,
        media_type=content_type,
        headers={"Content-Disposition": "inline"},
    )


@router.get(
    "/users/{user_id}/conversations/{conv_id}"
    "/documents/{document_id}/file",
)
async def get_document_file(
    user_id: int,
    conv_id: int,
    document_id: str,
    _user: dict = Depends(get_current_user),
    conv_repo: ConversationRepository = Depends(get_conversation_repository),
    doc_repo: DocumentRepository = Depends(get_document_repository),
) -> Response:
    """Proxy the original document file (PDF/…) for the "File gốc" tab (story 22).

    Streams the original file from the AI ingest service. Upstream 404 (the
    document has no file yet — e.g. not processed) → 404 so the FE shows a
    fallback; any other upstream failure → 502.
    """
    principal = Principal.from_user(_user)
    row = await conv_repo.find_visible(principal, conv_id)
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessages.NOT_FOUND,
        )

    doc = await _resolve_viewable_doc(
        principal, conv_id, document_id, doc_repo
    )
    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessages.DOC_NOT_FOUND,
        )

    try:
        file_bytes, content_type = await _fetch_remote_document_file(
            document_id
        )
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == status.HTTP_404_NOT_FOUND:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=ErrorMessages.PAGE_IMAGE_NOT_FOUND,
            )
        # Story 129 (diagnostics): the AI ingest returns a non-404 (5xx) for
        # SOME docs whose original file is missing/unreadable in MinIO while
        # their OCR text (Mongo) is intact. Log the upstream STATUS + BODY so
        # ops can tell "original missing" from a real infra error. Status
        # mapping is unchanged (upstream non-404 → 502).
        logger.error(
            "[getDocumentFile] upstream %s doc=%s body=%.300s",
            exc.response.status_code,
            document_id,
            exc.response.text,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=ErrorMessages.PAGE_IMAGE_UNAVAILABLE,
        )
    except Exception as exc:
        logger.error(
            "[getDocumentFile] upstream failed doc=%s type=%s err=%s",
            document_id,
            type(exc).__name__,
            exc,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=ErrorMessages.PAGE_IMAGE_UNAVAILABLE,
        )

    return Response(
        content=file_bytes,
        media_type=content_type,
        headers={"Content-Disposition": "inline"},
    )


# ── Chat-side repository access (story 16): browse + reference repo docs ─
#
# A regular (non-admin) user browses their OWN unit's repository from chat and
# "uses" repo documents by REFERENCE (the AI retrieval keys on document_id; no
# upstream copy/attach exists). Selected docs are LINKED to the conversation so
# the chat-query gate (llm.py) accepts them.


@router.get("/repository/documents", response_model=UnitRepoListResponse)
async def list_unit_repository(
    unit_id: int | None = Query(default=None),
    _user: dict = Depends(get_current_user),
    doc_repo: DocumentRepository = Depends(get_document_repository),
) -> UnitRepoListResponse:
    """List a unit's repository as a 2-level tree (no admin required).

    Story 35: a super-admin (unit-less / root) MUST pass ``unit_id`` to focus a
    unit (400 otherwise); a unit user/admin omits it and uses their own unit —
    targeting a foreign unit is rejected (403). Resolved via the same
    ``_resolve_repo_unit`` rule as the admin repository.
    """
    principal = Principal.from_user(_user)
    target_unit_id = _resolve_repo_unit(principal, unit_id)
    result = await doc_repo.list_unit_repository_for_user(
        principal, target_unit_id=target_unit_id
    )
    return UnitRepoListResponse(**result)


def _parse_search_document_ids(data: object) -> list[str]:
    """Extract ranked document ids from an AI ``/search/documents`` response.

    Tolerant of the exact response shape (the inference-service contract was not
    reachable when this was written — story 107): accepts a bare list, or a dict
    wrapping the list under ``results`` / ``documents`` / ``data`` / ``hits``;
    each item may be a bare id or an object carrying ``document_id`` / ``id`` /
    ``doc_id``. Anything unrecognised yields an empty list.

    Args:
        data: The decoded JSON body from the AI search endpoint.

    Returns:
        Ranked document ids as strings.
    """
    if isinstance(data, dict):
        for key in ("results", "documents", "data", "hits"):
            value = data.get(key)
            if isinstance(value, list):
                data = value
                break
        else:
            return []
    if not isinstance(data, list):
        return []
    ids: list[str] = []
    for item in data:
        if isinstance(item, dict):
            raw = item.get("document_id") or item.get("id") or item.get("doc_id")
        else:
            raw = item
        if raw is not None:
            ids.append(str(raw))
    return ids


async def _search_remote_documents(
    query: str, document_ids: list[str], top_k: int
) -> list[str]:
    """Return AI-ranked document ids for a semantic CONTENT search (story 107).

    Calls the inference service ``/search/documents`` (top-k distinct documents
    matching the query, grouped natively on the chunk index). Scoped by passing
    the caller's candidate ``document_ids``. Returns ``[]`` on any upstream error
    so the filename-match branch of the search route still works (partial, never
    full, degradation).

    Args:
        query: The user's search text.
        document_ids: Candidate repository document ids to scope the search to.
        top_k: Maximum number of distinct documents to return.

    Returns:
        Ranked document ids, or ``[]`` on any upstream/parse error.
    """
    payload = {"query": query, "top_k": top_k, "document_ids": document_ids}
    headers = {"Content-Type": "application/json"}
    if settings.llm_api_key:
        headers["Authorization"] = f"Bearer {settings.llm_api_key}"
    try:
        async with httpx.AsyncClient(
            timeout=30, follow_redirects=True
        ) as client:
            resp = await client.post(
                f"{settings.ai_service_host}/search/documents",
                json=payload,
                headers=headers,
            )
            resp.raise_for_status()
            data = resp.json()
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("AI search/documents failed: %s", exc)
        return []
    return _parse_search_document_ids(data)


@router.post("/repository/documents/search", response_model=UnitRepoListResponse)
async def search_unit_repository(
    body: RepoSearchRequest,
    _user: dict = Depends(get_current_user),
    doc_repo: DocumentRepository = Depends(get_document_repository),
) -> UnitRepoListResponse:
    """Search a unit's repository by NAME + CONTENT (story 107).

    Merges two sources over the caller's OWN unit repository:
      (a) a filename substring match computed here on the candidate list, and
      (b) a semantic CONTENT match from the AI ``/search/documents`` endpoint
          (top-k distinct documents grouped on the chunk index).

    The result is the union (name hits first, then content-ranked), de-duplicated
    by id, and intersected with the caller's visible repository so a foreign id
    from the AI can never leak. Scope is resolved by the same ``_resolve_repo_unit``
    rule as the list route (super-admin must focus a unit → 400; a non-super
    foreign unit → 403). An empty/whitespace query returns the full candidate
    list (the client normally shows the tree instead of calling this).
    """
    principal = Principal.from_user(_user)
    target_unit_id = _resolve_repo_unit(principal, body.unit_id)
    tree = await doc_repo.list_unit_repository_for_user(
        principal, target_unit_id=target_unit_id
    )
    candidates: list[dict] = tree.get("documents", [])

    query = (body.query or "").strip()
    if not query:
        return UnitRepoListResponse(groups=[], documents=candidates)

    # (a) NAME match — filename substring, case-insensitive, on the already
    # fetched candidates (no extra DB query, independent of the AI service).
    needle = query.lower()
    name_hits = [
        d for d in candidates if needle in (d.get("name") or "").lower()
    ]

    # (b) CONTENT match — AI semantic search, scoped by the candidate ids.
    by_id = {str(d["id"]): d for d in candidates}
    content_ids = await _search_remote_documents(
        query, list(by_id.keys()), body.top_k
    )

    # Union: name hits first, then AI content order; de-dupe by id; keep only ids
    # that belong to the caller's own repository (no cross-unit leak).
    ordered = [*name_hits, *(by_id[i] for i in content_ids if i in by_id)]
    seen: set[str] = set()
    results: list[dict] = []
    for d in ordered:
        did = str(d["id"])
        if did not in seen:
            seen.add(did)
            results.append(d)

    return UnitRepoListResponse(groups=[], documents=results)


@router.post(
    "/users/{user_id}/conversations/{conv_id}/documents/link-repository",
    response_model=DocumentListResponse,
)
async def link_repository_documents(
    request: Request,
    user_id: int,
    conv_id: int,
    body: LinkRepoDocsRequest,
    _user: dict = Depends(get_current_user),
    conv_repo: ConversationRepository = Depends(get_conversation_repository),
    doc_repo: DocumentRepository = Depends(get_document_repository),
) -> DocumentListResponse:
    """Link selected repository documents into a conversation by reference.

    No copy: the documents stay in the unit repository. Each id must belong to
    the caller's own unit repository (else 403). The chat-query gate then
    accepts these ids for this conversation.
    """
    principal = Principal.from_user(_user)
    row = await conv_repo.find_visible(principal, conv_id)
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessages.NOT_FOUND,
        )

    if not body.document_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=ErrorMessages.MISSING_FIELDS,
        )

    # Story 35: resolve which unit's repository the docs come from (super-admin
    # sends the focused unit; non-super is locked to their own — foreign → 403).
    target_unit_id = _resolve_repo_unit(principal, body.unit_id)

    try:
        linked = await doc_repo.link_repository_docs(
            principal, conv_id, body.document_ids, target_unit_id=target_unit_id
        )
    except PermissionError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=ErrorMessages.FORBIDDEN,
        )

    audit_log(
        request,
        AuditActions.DOCUMENT_UPLOAD,
        AuditEntityTypes.CONVERSATION,
        entity_id=conv_id,
        conversation_id=conv_id,
        metadata={"linked_repository": linked},
    )

    docs = await doc_repo.find_by_conversation(principal, conv_id)
    return DocumentListResponse(documents=[_to_doc_out(d) for d in docs])


@router.delete(
    "/users/{user_id}/conversations/{conv_id}"
    "/documents/{document_id}/link-repository",
    response_model=DocumentListResponse,
)
async def unlink_repository_document(
    request: Request,
    user_id: int,
    conv_id: int,
    document_id: str,
    _user: dict = Depends(get_current_user),
    conv_repo: ConversationRepository = Depends(get_conversation_repository),
    doc_repo: DocumentRepository = Depends(get_document_repository),
) -> DocumentListResponse:
    """Remove a repository document's link from a conversation (story 19).

    "Gỡ khỏi hội thoại": deletes only the reference link — the repository
    document itself is untouched. Anyone who can see the conversation may unlink
    (it only affects their conversation). Returns the updated document list
    (own conversation docs + any still-linked repository docs).
    """
    principal = Principal.from_user(_user)
    row = await conv_repo.find_visible(principal, conv_id)
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessages.NOT_FOUND,
        )

    await doc_repo.unlink_repository_doc(conv_id, document_id)

    audit_log(
        request,
        AuditActions.DOCUMENT_DELETE,
        AuditEntityTypes.CONVERSATION,
        entity_id=conv_id,
        conversation_id=conv_id,
        metadata={"unlinked_repository": document_id},
    )

    docs = await doc_repo.find_by_conversation(principal, conv_id)
    seen = {str(d["id"]) for d in docs}
    linked = [
        {**d, "from_repository": True}
        for d in await doc_repo.find_linked_repo_documents(conv_id)
        if str(d["id"]) not in seen
    ]
    return DocumentListResponse(documents=[_to_doc_out(d) for d in docs + linked])


# ── Admin document repository ("Quản lý kho tài liệu") ──────────────────
#
# Lists/edits ALL documents in the caller's unit subtree (not by conversation).
# Uploaded files attach to a hidden per-admin "repository" conversation, since
# ``document.conversation_id`` is NOT NULL. Upload stores only — no AI
# processing is triggered.

# Story 24: the allowed upload extensions are NOT hardcoded — they come from
# config (``settings.allowed_upload_extensions``, env UPLOAD_ALLOWED_EXTENSIONS),
# kept in sync with the FE upload ``accept`` list (REACT_APP_FILE_EXT). Anything
# outside is still rejected with INVALID_FILE_TYPE — no silent widening to all.

# A unit-less admin is the structural super-admin (see access.py). They have no
# "own" repository unit, so they must pass ``unit_id`` to focus one before
# listing/uploading. A unit admin operates on their own unit and may not target
# another unit's repository.
ROOT_UNIT_ID = 1


def _resolve_repo_unit(principal: Principal, unit_id: int | None) -> int:
    """Resolve the unit whose repository the caller operates on.

    Args:
        principal: The authenticated admin.
        unit_id: Optional focus unit from the request (super-admin only).

    Returns:
        The effective unit id.

    Raises:
        HTTPException: 400 if a super-admin did not focus a unit; 403 if a unit
            admin targets a unit other than their own.
    """
    is_super = principal.unit_id is None or principal.unit_id == ROOT_UNIT_ID
    if is_super:
        if unit_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=ErrorMessages.UNIT_FOCUS_REQUIRED,
            )
        return unit_id
    # Unit admin: own unit only. A foreign target is forbidden.
    if unit_id is not None and unit_id != principal.unit_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=ErrorMessages.FORBIDDEN,
        )
    return principal.unit_id


@router.get("/admin/documents", response_model=DocRepoListResponse)
async def list_repository_documents(
    search: str | None = Query(default=None),
    group_ids: list[int] | None = Query(default=None),
    unit_id: int | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=15, ge=1, le=100),
    current_user: dict = Depends(require_permission("documents:read")),
    doc_repo: DocumentRepository = Depends(get_document_repository),
) -> DocRepoListResponse:
    """List repository documents (search/group filter).

    Story 78: a super-admin/commander with NO ``unit_id`` lists EVERY unit's
    documents (each row carries ``unit_name``); with a ``unit_id`` they focus that
    one unit. A unit admin always lists their own unit (foreign focus → 403).
    """
    principal = Principal.from_user(current_user)
    is_super = (
        principal.unit_id is None or principal.unit_id == ROOT_UNIT_ID
    )
    all_units = is_super and unit_id is None
    # When focusing one unit (or a unit admin), resolve+validate the unit; in
    # all-units mode there is no single target.
    target_unit_id = None if all_units else _resolve_repo_unit(principal, unit_id)
    result = await doc_repo.list_documents_by_unit(
        principal,
        search=search,
        group_ids=group_ids,
        target_unit_id=target_unit_id,
        all_units=all_units,
        page=page,
        page_size=page_size,
        # Story 54: flag each row unread/read for THIS admin so the screen can
        # highlight unread documents.
        viewer_user_id=principal.id,
    )
    return DocRepoListResponse(**result)


@router.get("/admin/documents/unread-count")
async def repository_unread_count(
    current_user: dict = Depends(require_permission("documents:read")),
    doc_repo: DocumentRepository = Depends(get_document_repository),
) -> dict:
    """Story 54/115: unread repository-document notifications (role-aware badge).

    Drives the unread badge on the "Kho tài liệu" header button. Story 115: the
    count is role-scoped by ``count_repo_notifications`` — admins → 0, commander
    → only super-admin uploads, regular member → their own unit repository.
    """
    principal = Principal.from_user(current_user)
    count = await doc_repo.count_repo_notifications(principal)
    return {"count": count}


@router.post(
    "/repository/documents/{document_id}/read",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def mark_repository_document_read(
    document_id: str,
    _user: dict = Depends(get_current_user),
    doc_repo: DocumentRepository = Depends(get_document_repository),
) -> Response:
    """Story 54: mark a repository document as read by the CURRENT user.

    Any authenticated user: an admin opening it in "Quản lý kho tài liệu", or a
    regular user opening a linked repository document in chat. Visibility is
    gated in the repository layer (not viewable → 404). Idempotent.
    """
    principal = Principal.from_user(_user)
    ok = await doc_repo.mark_repo_document_read(principal, document_id)
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessages.DOC_NOT_FOUND,
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── Story 82: user-facing repository (read-only) — badge + view + read ────────
# A regular user sees how many documents in THEIR unit's repository they have not
# read yet (badge) and can view them read-only. ``get_current_user`` (no admin)
# + ``count_unread_repo_documents`` / ``find_visible`` already scope by
# ``_repo_conv_ids_for`` (regular → own unit repo only), so this never widens
# access across units. The viewer routes mirror the admin ones (story 39) but are
# open to any authenticated user; visibility is enforced by ``find_visible``.


@router.get("/repository/documents/unread-count")
async def repository_unread_count_for_user(
    _user: dict = Depends(get_current_user),
    doc_repo: DocumentRepository = Depends(get_document_repository),
) -> dict:
    """Story 82/115: unread repository notifications for the CURRENT user.

    This is the endpoint the FE badge actually calls. Story 115: role-aware via
    ``count_repo_notifications`` — admins → 0, commander → only super-admin
    uploads, regular member → their OWN unit's repository (unchanged). Same
    method as the admin route, so both return the same value for the same caller.
    """
    principal = Principal.from_user(_user)
    count = await doc_repo.count_repo_notifications(principal)
    return {"count": count}


@router.get(
    "/repository/documents/{document_id}/pages",
    response_model=DocumentPagesResponse,
)
async def user_get_repository_document_pages(
    document_id: str,
    _user: dict = Depends(get_current_user),
    doc_repo: DocumentRepository = Depends(get_document_repository),
) -> DocumentPagesResponse:
    """Story 82: digitized text of a repo doc the user may access (own unit)."""
    principal = Principal.from_user(_user)
    doc = await doc_repo.find_visible(principal, document_id)
    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessages.DOC_NOT_FOUND,
        )
    try:
        detail = await _fetch_remote_document_detail(document_id)
    except Exception as exc:
        logger.error("[userRepoPages] Upstream failed for %s: %s", document_id, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=ErrorMessages.UPSTREAM_ERROR,
        )
    pages = [
        PagePreview(
            page_number=p.get("page_number", 1),
            content=p.get("page_content") or p.get("content_preview"),
        )
        for p in detail.get("pages", [])
    ]
    return DocumentPagesResponse(
        name=doc["name"],
        page_count=detail.get("page_count") or len(pages),
        pages=pages,
    )


@router.get("/repository/documents/{document_id}/file")
async def user_get_repository_document_file(
    document_id: str,
    _user: dict = Depends(get_current_user),
    doc_repo: DocumentRepository = Depends(get_document_repository),
) -> Response:
    """Story 82: proxy the original file of a repo doc the user may access."""
    principal = Principal.from_user(_user)
    doc = await doc_repo.find_visible(principal, document_id)
    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessages.DOC_NOT_FOUND,
        )
    try:
        file_bytes, content_type = await _fetch_remote_document_file(document_id)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == status.HTTP_404_NOT_FOUND:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=ErrorMessages.PAGE_IMAGE_NOT_FOUND,
            )
        # Story 129 (diagnostics): this branch was previously SILENT — a repo
        # /file 5xx returned 502 with no log at all. Emit the upstream status +
        # body so the AI-side failure is diagnosable. Status mapping unchanged.
        logger.error(
            "[userRepoFile] upstream %s doc=%s body=%.300s",
            exc.response.status_code,
            document_id,
            exc.response.text,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=ErrorMessages.PAGE_IMAGE_UNAVAILABLE,
        )
    except Exception as exc:
        logger.error(
            "[userRepoFile] upstream failed doc=%s type=%s err=%s",
            document_id,
            type(exc).__name__,
            exc,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=ErrorMessages.PAGE_IMAGE_UNAVAILABLE,
        )
    return Response(
        content=file_bytes,
        media_type=content_type,
        headers={"Content-Disposition": "inline"},
    )


@router.get("/repository/documents/{document_id}/pages/{page_no}/image")
async def user_get_repository_document_page_image(
    document_id: str,
    page_no: int,
    _user: dict = Depends(get_current_user),
    doc_repo: DocumentRepository = Depends(get_document_repository),
) -> Response:
    """Story 82: proxy a repo doc's page image for the user's read-only viewer."""
    principal = Principal.from_user(_user)
    doc = await doc_repo.find_visible(principal, document_id)
    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessages.DOC_NOT_FOUND,
        )
    try:
        image_bytes, content_type = await _fetch_remote_page_image(
            document_id, page_no
        )
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == status.HTTP_404_NOT_FOUND:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=ErrorMessages.PAGE_IMAGE_NOT_FOUND,
            )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=ErrorMessages.PAGE_IMAGE_UNAVAILABLE,
        )
    except Exception as exc:
        logger.error("[userRepoImage] Upstream failed for %s: %s", document_id, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=ErrorMessages.PAGE_IMAGE_UNAVAILABLE,
        )
    if not image_bytes or not content_type.lower().startswith("image/"):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessages.PAGE_IMAGE_NOT_FOUND,
        )
    return Response(
        content=image_bytes,
        media_type=content_type,
        headers={"Content-Disposition": "inline"},
    )


@router.post(
    "/admin/documents/upload",
    response_model=DocRepoItem,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(forbid_readonly)],
)
async def upload_repository_document(
    request: Request,
    file: UploadFile = File(...),
    group_id: int | None = None,
    unit_id: int | None = None,
    current_user: dict = Depends(require_permission("documents:manage")),
    conv_repo: ConversationRepository = Depends(get_conversation_repository),
    doc_repo: DocumentRepository = Depends(get_document_repository),
) -> DocRepoItem:
    """Upload a file into a unit's repository (store only, no processing).

    Unit admins upload to their own unit; super-admins must focus a unit via
    ``unit_id``.
    """
    principal = Principal.from_user(current_user)
    target_unit_id = _resolve_repo_unit(principal, unit_id)
    safe_name = fix_filename_encoding(file.filename) or file.filename or ""
    if not safe_name.lower().endswith(settings.allowed_upload_extensions):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=ErrorMessages.INVALID_FILE_TYPE,
        )

    conv_id = await conv_repo.find_repository_conversation(
        principal, target_unit_id=target_unit_id
    )

    file_bytes = await file.read()
    sha = hashlib.sha256(file_bytes).hexdigest()

    # A unit's repository is a conversation of its own, so it gets the same
    # treatment as a chat one: a file this repository already holds is settled
    # here, and ingestion is told which conversation it is uploading into so its
    # own dedup stays inside that unit rather than reaching across every unit.
    twin = await doc_repo.find_by_sha256(principal, conv_id, sha)
    if twin is not None:
        logger.info(
            "[uploadRepositoryDocument] Unit %s's repository already holds this "
            "file as %s; reusing it", target_unit_id, twin["id"],
        )
        return DocRepoItem(
            id=twin["id"],
            name=twin.get("name") or safe_name,
            doc_number=twin.get("doc_number"),
            summary=twin.get("summary"),
            group_id=twin.get("group_id"),
            group_name=None,
            created_at=twin.get("created_at"),
        )

    created = await _create_remote_document(
        file_bytes, safe_name, file.content_type,
        owner_id=principal.id, conversation_id=conv_id,
    )
    document_id = created.get("document_id")
    if not document_id:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=ErrorMessages.UPSTREAM_ERROR,
        )

    # Same net as the chat route: ingestion may still answer with an id already
    # in this table (a legacy row hashed differently, a race between two admins).
    # Its primary key is that id, so inserting it again is the 500 this closes.
    existing = await doc_repo.find_visible(principal, document_id)
    if existing is not None:
        if existing["conversation_id"] != conv_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=ErrorMessages.DOC_CONVERSATION_CONFLICT,
            )
        logger.info(
            "[uploadRepositoryDocument] Ingestion deduplicated %s into unit %s's "
            "repository; reusing the existing row", document_id, target_unit_id,
        )
    else:
        await doc_repo.create({
            "id": document_id,
            "conversation_id": conv_id,
            "user_id": principal.id,
            "group_id": group_id,
            "name": safe_name,
            "sha256": sha,
            "status": ProcessingStatus.UPLOADED,
            "chunk_count": 0,
            "task_id": None,
        })

    # Story 21: process the repository document so it is chunked (AI retrieval)
    # and gets page images ("Xem File gốc"). Without this the doc stays PENDING
    # with chunk_count=0 and page-image 404. Errors are recorded, not raised.
    await _process_repo_document(doc_repo, principal, document_id, conv_id)

    audit_log(
        request,
        AuditActions.DOCUMENT_UPLOAD,
        AuditEntityTypes.DOCUMENT,
        entity_id=document_id,
        metadata={"name": safe_name, "repository": True},
    )
    return DocRepoItem(
        id=document_id,
        name=safe_name,
        doc_number=None,
        summary=None,
        group_id=group_id,
        group_name=None,
        created_at=None,
    )


@router.post(
    "/admin/documents/{document_id}/replace",
    response_model=DocRepoItem,
    dependencies=[Depends(forbid_readonly)],
)
async def replace_repository_document_file(
    request: Request,
    document_id: str,
    file: UploadFile = File(...),
    current_user: dict = Depends(require_permission("documents:manage")),
    doc_repo: DocumentRepository = Depends(get_document_repository),
) -> DocRepoItem:
    """Overwrite a repository document's file content (ghi đè), keeping metadata.

    The remote ingest service mints a new id per upload, so this deletes the old
    remote+row and re-creates with the new file while carrying over the existing
    metadata (name/số/trích yếu/nhóm). The list refetches afterwards.
    """
    principal = Principal.from_user(current_user)
    existing = await doc_repo.find_visible(principal, document_id)
    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessages.DOC_NOT_FOUND,
        )

    safe_name = fix_filename_encoding(file.filename) or file.filename or ""
    if not safe_name.lower().endswith(settings.allowed_upload_extensions):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=ErrorMessages.INVALID_FILE_TYPE,
        )

    file_bytes = await file.read()
    sha = hashlib.sha256(file_bytes).hexdigest()
    created = await _create_remote_document(
        file_bytes, safe_name, file.content_type, owner_id=principal.id
    )
    new_id = created.get("document_id")
    if not new_id:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=ErrorMessages.UPSTREAM_ERROR,
        )

    # Best-effort remove the old remote binary; ignore upstream failures so a
    # stale remote doc never blocks the overwrite.
    try:
        await _delete_remote_document(document_id)
    except Exception:
        pass

    await doc_repo.create({
        "id": new_id,
        "conversation_id": existing["conversation_id"],
        "user_id": existing["user_id"],
        "group_id": existing.get("group_id"),
        "name": safe_name,
        "doc_number": existing.get("doc_number"),
        "summary": existing.get("summary"),
        "sha256": sha,
        "status": ProcessingStatus.UPLOADED,
        "chunk_count": 0,
        "task_id": None,
    })
    await doc_repo.delete(principal, document_id)

    # Story 21: the replacement is a brand-new remote document — process it too so
    # the overwritten file is chunked and gets page images (errors recorded).
    await _process_repo_document(
        doc_repo, principal, new_id, existing["conversation_id"]
    )

    audit_log(
        request,
        AuditActions.DOCUMENT_UPDATE,
        AuditEntityTypes.DOCUMENT,
        entity_id=new_id,
        metadata={"replaced": document_id, "name": safe_name, "repository": True},
    )
    return DocRepoItem(
        id=new_id,
        name=safe_name,
        doc_number=existing.get("doc_number"),
        summary=existing.get("summary"),
        group_id=existing.get("group_id"),
        group_name=None,
        created_at=None,
    )


@router.put("/admin/documents/{document_id}", response_model=DocumentOut)
async def update_repository_document(
    request: Request,
    document_id: str,
    body: UpdateDocRepoRequest,
    current_user: dict = Depends(require_permission("documents:manage")),
    doc_repo: DocumentRepository = Depends(get_document_repository),
) -> DocumentOut:
    """Edit a repository document's metadata (name/số/trích yếu/nhóm)."""
    principal = Principal.from_user(current_user)
    # ``exclude_unset`` keeps only the fields the client actually sent — including
    # an explicit ``group_id: null`` (un-group). ``exclude_none`` would silently
    # drop it, so clearing a document's group never persisted.
    patch = body.model_dump(exclude_unset=True)
    if not patch:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=ErrorMessages.NO_FIELDS_UPDATE,
        )
    result = await doc_repo.update(principal, document_id, patch)
    if result.get("changes", 0) == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessages.DOC_NOT_FOUND,
        )
    doc = await doc_repo.find_visible(principal, document_id)
    audit_log(
        request,
        AuditActions.DOCUMENT_UPDATE,
        AuditEntityTypes.DOCUMENT,
        entity_id=document_id,
        metadata={"changes": list(patch.keys())},
    )
    return _to_doc_out(doc)


@router.delete(
    "/admin/documents/{document_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_repository_document(
    request: Request,
    document_id: str,
    current_user: dict = Depends(require_permission("documents:manage")),
    doc_repo: DocumentRepository = Depends(get_document_repository),
) -> Response:
    """Delete a repository document (proxy-delete remote, then local)."""
    principal = Principal.from_user(current_user)
    doc = await doc_repo.find_visible(principal, document_id)
    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessages.DOC_NOT_FOUND,
        )
    try:
        await _delete_remote_document(document_id)
    except Exception:
        pass
    await doc_repo.delete(principal, document_id)
    audit_log(
        request,
        AuditActions.DOCUMENT_DELETE,
        AuditEntityTypes.DOCUMENT,
        entity_id=document_id,
        metadata={"name": doc.get("name"), "repository": True},
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/admin/documents/{document_id}/process",
    response_model=DocumentOut,
    dependencies=[Depends(forbid_readonly)],
)
async def process_repository_document(
    request: Request,
    document_id: str,
    current_user: dict = Depends(require_permission("documents:manage")),
    doc_repo: DocumentRepository = Depends(get_document_repository),
) -> DocumentOut:
    """Story 34: (re)process a repository document that is already stored — e.g.
    one stuck at ``UPLOADED`` (uploaded before story-21 auto-processing) so it
    never got chunked or page images. Reuses the story-21 helper, so it is
    idempotent (safe to rerun on a COMPLETED doc) and a processing failure is
    recorded as ``ERROR`` rather than raised. Returns the document with its new
    status. Admin-only; scoped via ``find_visible`` like replace/delete.
    """
    principal = Principal.from_user(current_user)
    doc = await doc_repo.find_visible(principal, document_id)
    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessages.DOC_NOT_FOUND,
        )

    await _process_repo_document(
        doc_repo, principal, document_id, doc["conversation_id"]
    )

    audit_log(
        request,
        AuditActions.DOCUMENT_UPDATE,
        AuditEntityTypes.DOCUMENT,
        entity_id=document_id,
        metadata={"reprocess": True, "repository": True},
    )
    updated = await doc_repo.find_visible(principal, document_id)
    return _to_doc_out(updated or doc)


@router.post(
    "/admin/documents/{document_id}/approve",
    response_model=DocumentOut,
)
async def approve_repository_document(
    request: Request,
    document_id: str,
    current_user: dict = Depends(require_permission("documents:manage")),
    doc_repo: DocumentRepository = Depends(get_document_repository),
) -> DocumentOut:
    """Story 48: mark a repository document as APPROVED ("Đã duyệt").

    A manual admin review gate: ONLY a document that is already COMPLETED (auto-
    digitized, story 46) may be approved — any other status is rejected (409) so
    a doc still processing / errored cannot be approved. Admin-only; scoped via
    ``find_visible`` (foreign doc → 404). The approved status is terminal and is
    not touched by the AI ingest status sync.
    """
    principal = Principal.from_user(current_user)
    doc = await doc_repo.find_visible(principal, document_id)
    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessages.DOC_NOT_FOUND,
        )
    if (doc.get("status") or "").upper() != ProcessingStatus.COMPLETED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Chỉ duyệt được tài liệu đã số hoá xong.",
        )

    await doc_repo.update(
        principal, document_id, {"status": ProcessingStatus.APPROVED}
    )
    audit_log(
        request,
        AuditActions.DOCUMENT_UPDATE,
        AuditEntityTypes.DOCUMENT,
        entity_id=document_id,
        metadata={"approve": True, "repository": True},
    )
    updated = await doc_repo.find_visible(principal, document_id)
    return _to_doc_out(updated or {**doc, "status": ProcessingStatus.APPROVED})


@router.get(
    "/admin/documents/{document_id}/status",
    response_model=DocumentOut,
)
async def repository_document_status(
    document_id: str,
    current_user: dict = Depends(require_permission("documents:read")),
    doc_repo: DocumentRepository = Depends(get_document_repository),
) -> DocumentOut:
    """Story 46: sync a repository document's processing status from AI ingest.

    Upload/reprocess kicks off an async Celery task and stores ``PROCESSING`` +
    ``task_id`` immediately; nothing writes the terminal status back, so the
    admin list stays stuck on "Đang xử lý". This reads the upstream task (or,
    for older docs without a task_id, the document detail) and, when terminal,
    writes COMPLETED/ERROR back to Postgres — then returns the document.

    Idempotent: a doc already terminal returns without any upstream call. A
    transient upstream error leaves the stored status untouched (the FE poll
    retries). Admin-only; scoped via ``find_visible`` (foreign doc → 404).
    """
    principal = Principal.from_user(current_user)
    doc = await doc_repo.find_visible(principal, document_id)
    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessages.DOC_NOT_FOUND,
        )

    current = (doc.get("status") or "").upper()
    # Already terminal → idempotent no-op, skip the upstream round-trip. Story 48:
    # APPROVED is also terminal (admin-set) and must NOT be reverted by a sync.
    if current in (
        ProcessingStatus.COMPLETED,
        ProcessingStatus.ERROR,
        ProcessingStatus.APPROVED,
    ):
        return _to_doc_out(doc)

    terminal: str | None = None
    try:
        task_id = doc.get("task_id")
        if task_id:
            terminal = _map_upstream_status(
                await _read_remote_task_status(task_id)
            )
        else:
            detail = await _fetch_remote_document_detail(document_id)
            terminal = _map_upstream_status(detail.get("status"))
    except Exception as exc:
        # Transient upstream failure → keep the current status; FE retries.
        logger.warning(
            "[repositoryStatus] sync failed for %s: %s", document_id, exc
        )
        return _to_doc_out(doc)

    if terminal:
        await doc_repo.update(principal, document_id, {"status": terminal})
        updated = await doc_repo.find_visible(principal, document_id)
        return _to_doc_out(updated or {**doc, "status": terminal})
    return _to_doc_out(doc)


# ── Admin document VIEWER (story 39): view a repo doc in "Quản lý kho tài liệu" ─
#
# The chat viewer reads through ``/users/{u}/conversations/{c}/...`` (conversation
# scoped). Repository docs live under a hidden per-unit conversation that is not
# "visible" to an admin in that sense, so these admin routes mirror the existing
# admin repo pattern (replace/delete/process): ``require_admin`` +
# ``find_visible(document_id)`` (a unit admin sees only their subtree → foreign
# doc 404; super-admin/root sees all). They reuse the same upstream proxy helpers
# as the chat viewer, so the FE can drive the SAME DocumentViewer component.


@router.get(
    "/admin/documents/{document_id}/pages",
    response_model=DocumentPagesResponse,
)
async def admin_get_document_pages(
    document_id: str,
    current_user: dict = Depends(require_permission("documents:read")),
    doc_repo: DocumentRepository = Depends(get_document_repository),
) -> DocumentPagesResponse:
    """Every page's digitized text for the repo viewer ("Nội dung đã số hóa")."""
    principal = Principal.from_user(current_user)
    doc = await doc_repo.find_visible(principal, document_id)
    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessages.DOC_NOT_FOUND,
        )

    try:
        detail = await _fetch_remote_document_detail(document_id)
    except Exception as exc:
        logger.error(
            "[adminGetDocumentPages] Upstream failed for %s: %s",
            document_id, exc,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=ErrorMessages.UPSTREAM_ERROR,
        )

    pages = []
    for p in detail.get("pages", []):
        pages.append(
            PagePreview(
                page_number=p.get("page_number", 1),
                content=p.get("page_content") or p.get("content_preview"),
                char_start=p.get("char_start"),
                char_end=p.get("char_end"),
            )
        )
    return DocumentPagesResponse(
        name=doc["name"],
        page_count=detail.get("page_count") or len(pages),
        pages=pages,
    )


@router.get("/admin/documents/{document_id}/file")
async def admin_get_document_file(
    document_id: str,
    current_user: dict = Depends(require_permission("documents:read")),
    doc_repo: DocumentRepository = Depends(get_document_repository),
) -> Response:
    """Proxy the original repo document file ("File gốc"). 404 if no file yet."""
    principal = Principal.from_user(current_user)
    doc = await doc_repo.find_visible(principal, document_id)
    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessages.DOC_NOT_FOUND,
        )

    try:
        file_bytes, content_type = await _fetch_remote_document_file(
            document_id
        )
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == status.HTTP_404_NOT_FOUND:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=ErrorMessages.PAGE_IMAGE_NOT_FOUND,
            )
        # Story 129 (diagnostics): log upstream STATUS + BODY (see chat route).
        logger.error(
            "[adminGetDocumentFile] upstream %s doc=%s body=%.300s",
            exc.response.status_code,
            document_id,
            exc.response.text,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=ErrorMessages.PAGE_IMAGE_UNAVAILABLE,
        )
    except Exception as exc:
        logger.error(
            "[adminGetDocumentFile] upstream failed doc=%s type=%s err=%s",
            document_id,
            type(exc).__name__,
            exc,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=ErrorMessages.PAGE_IMAGE_UNAVAILABLE,
        )

    return Response(
        content=file_bytes,
        media_type=content_type,
        headers={"Content-Disposition": "inline"},
    )


@router.get("/admin/documents/{document_id}/pages/{page_no}/image")
async def admin_get_document_page_image(
    document_id: str,
    page_no: int,
    current_user: dict = Depends(require_permission("documents:read")),
    doc_repo: DocumentRepository = Depends(get_document_repository),
) -> Response:
    """Proxy a repo document's page image (thumbnail rail). Non-image/empty/404
    upstream → 404 (FE falls back to a text card); other failures → 502."""
    principal = Principal.from_user(current_user)
    doc = await doc_repo.find_visible(principal, document_id)
    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessages.DOC_NOT_FOUND,
        )

    try:
        image_bytes, content_type = await _fetch_remote_page_image(
            document_id, page_no
        )
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == status.HTTP_404_NOT_FOUND:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=ErrorMessages.PAGE_IMAGE_NOT_FOUND,
            )
        logger.error(
            "[adminGetDocumentPageImage] Upstream %s for %s p%s",
            exc.response.status_code, document_id, page_no,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=ErrorMessages.PAGE_IMAGE_UNAVAILABLE,
        )
    except Exception as exc:
        logger.error(
            "[adminGetDocumentPageImage] Upstream failed for %s p%s: %s",
            document_id, page_no, exc,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=ErrorMessages.PAGE_IMAGE_UNAVAILABLE,
        )

    if not image_bytes or not content_type.lower().startswith("image/"):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessages.PAGE_IMAGE_NOT_FOUND,
        )

    return Response(
        content=image_bytes,
        media_type=content_type,
        headers={"Content-Disposition": "inline"},
    )
