"""LLM proxy routes — stream queries, tool proxy, status polling."""

from __future__ import annotations

import logging
import time
import urllib.parse

import httpx
from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
    status,
)
from fastapi.responses import StreamingResponse

from app.config import settings
from app.constants.audit import AuditActions, AuditEntityTypes
from app.constants.errors import ErrorMessages
from app.constants.status import UpstreamStatus
from app.middlewares.auth import get_current_user
from app.models.access import Principal
from app.repositories.base import ConversationRepository, DocumentRepository
from app.repositories.factory import (
    get_conversation_repository,
    get_document_repository,
)
from app.models.schemas import StreamQueryRequest, ToolStatusResponse
from app.utils.audit import audit_log
from app.utils.helpers import parse_json_safe

logger = logging.getLogger(__name__)
router = APIRouter()


# Per-message ceiling on anything leaving this service for the AI. Measured over
# this store: questions are trivial (p50 36 chars) but answers run p50 770, p90
# 15,921 and max 46,908 — that one answer is 13,762 Gemma tokens, and the whole
# window is re-sent on every query.
#
# Nothing downstream reads that much. The rewrite prompt is the only consumer of
# the forwarded window, and it takes the last 4 messages at 90 words each
# (`compact_assistant_for_rewrite`); generation never sees raw history at all,
# only `carried_context` through `select_generation_history`. So an uncapped
# answer is serialised, transmitted and JSON-parsed purely to be discarded — for
# conv 52 that is ~95% of a 51,700-char payload, on every single query.
#
# 600 words is ~7x what the rewriter reads, so the cap cannot change an answer,
# and it leaves p50 answers untouched. Mongo keeps the full text either way:
# this bounds the wire, not the record.
_FORWARD_MAX_MESSAGE_WORDS = 600


def _cap_words(text: str, max_words: int) -> str:
    """Trim ``text`` to ``max_words``, marking it when something was dropped."""
    words = (text or "").split()
    if len(words) <= max_words:
        return text
    return " ".join(words[:max_words]) + "..."


def _recent_history(messages: list[dict], window: int) -> list[dict]:
    """Map the last ``window`` stored turns to role/content pairs.

    Args:
        messages: Stored turns, each ``{"q": ..., "a": ...}``.
        window: Trailing turns to forward (``<= 0`` yields none).

    Returns:
        Flat ``[{"role", "content"}]`` list (user then assistant per
        turn) for the stateless AI service, each message capped at
        ``_FORWARD_MAX_MESSAGE_WORDS``.
    """
    if window <= 0:
        return []
    history: list[dict] = []
    for msg in (messages or [])[-window:]:
        question, answer = msg.get("q"), msg.get("a")
        # Only forward complete turns; a half-turn (e.g. an errored stream
        # that stored an empty answer) would emit a lone message and break
        # strict user/assistant alternation on the stateless AI side.
        if question and answer:
            history.append({
                "role": "user",
                "content": _cap_words(question, _FORWARD_MAX_MESSAGE_WORDS),
            })
            history.append({
                "role": "assistant",
                "content": _cap_words(answer, _FORWARD_MAX_MESSAGE_WORDS),
            })
    return history


def _forwarded_context(ds: dict, window: int) -> tuple[str, list[dict]]:
    """Return ``(summary, recent_turns)`` to forward for this conversation.

    Turns already folded into ``summary`` (everything before ``absorbed_upto``)
    are dropped rather than re-sent as raw text — sending both would hand the AI
    the same content twice, once compacted and once not. ``window`` still caps
    what remains, so a lagging or failed compaction can never let the forwarded
    payload grow without bound.
    """
    messages = ds.get("messages") or []
    absorbed = ds.get("absorbed_upto") or 0
    if not isinstance(absorbed, int) or absorbed < 0:
        absorbed = 0
    summary = ds.get("summary") or ""
    return summary, _recent_history(messages[absorbed:], window)


def _turns_to_absorb(messages: list[dict], absorbed_upto: int, window: int) -> list[dict]:
    """Turns that have aged out of the forwarded window and are not yet summarised.

    Returned in the same flat ``[{"role", "content"}]`` shape the AI's fold
    endpoint takes. Empty while the window still covers everything unabsorbed,
    which is the common case early in a conversation.
    """
    if window <= 0:
        return []
    cutoff = len(messages or []) - window
    if cutoff <= absorbed_upto:
        return []
    return _recent_history(messages[absorbed_upto:cutoff], cutoff - absorbed_upto)


def _query_string_without_user_id(raw: str) -> str:
    """Return ``raw`` query string with any ``user_id`` param removed.

    The AI service reads ``user_id`` query-param-first, so stripping it
    lets the gateway-injected, JWT-verified ``user_id`` in the body win.
    """
    pairs = urllib.parse.parse_qsl(raw, keep_blank_values=True)
    return urllib.parse.urlencode(
        [(k, v) for k, v in pairs if k != "user_id"]
    )


def _apply_verified_identity(
    body_dict: dict,
    principal: Principal,
    history: list[dict],
    summary: str = "",
) -> None:
    """Overwrite client-controlled identity/history with trusted values.

    ``StreamQueryRequest`` allows extra fields, so a client can smuggle
    ``user_id``, ``unit_id``, ``conversation_history`` or ``history_summary``
    into the body. Replace them in place with the JWT-verified identity, the
    gateway-owned recent window and the gateway-owned summary, so the stateless
    AI cannot be spoofed or fed fabricated context.

    Args:
        body_dict: The forwarded request body, mutated in place.
        principal: The authenticated caller (verified identity).
        history: Gateway-computed recent turns (empty forwards none).
        summary: Gateway-owned compacted history (empty forwards none).
    """
    body_dict["user_id"] = str(principal.id)
    if principal.unit_id is not None:
        body_dict["unit_id"] = str(principal.unit_id)
    else:
        body_dict.pop("unit_id", None)
    if history:
        body_dict["conversation_history"] = history
    else:
        body_dict.pop("conversation_history", None)
    if summary:
        body_dict["history_summary"] = summary
    else:
        body_dict.pop("history_summary", None)


# ── Context extractors ──────────────────────────────────────────────

def _extract_stream_context(request: Request, body: StreamQueryRequest) -> dict:
    q = dict(request.query_params)
    doc_ids = q.get("document_ids", [])
    if isinstance(doc_ids, str):
        doc_ids = [doc_ids]
    return {
        "conversation_id": q.get("conversation_id") or q.get("conv_id"),
        "user_id": q.get("user_id"),
        "document_ids": doc_ids,
        "query": body.query,
        "k": body.k,
        "language": body.language,
        "include_sources": body.include_sources,
        "temperature": body.temperature,
        "max_tokens": body.max_tokens,
    }


def _extract_tool_context(body: dict) -> dict:
    return {
        "conversation_id": body.get("conversation_id"),
        "document_id": body.get("document_id"),
        "language": body.get("language"),
        "summary_type": body.get("summary_type"),
        "max_length": body.get("max_length"),
        "temperature": body.get("temperature"),
        "output_format": body.get("output_format"),
    }


def _apply_zombie_check(data: dict, start_time: str | None) -> dict:
    """Return a FAILURE result if a task has been stuck longer than the timeout."""
    timeout_ms = settings.zombie_task_timeout_ms
    status_str = str(data.get("status", "")).lower()
    is_stuck = status_str in (
        UpstreamStatus.PROCESSING.lower(),
        UpstreamStatus.PENDING.lower(),
    ) or not data.get("status")

    if not start_time or not is_stuck:
        return data

    try:
        start_ts = int(start_time)
    except (ValueError, TypeError):
        return data

    if (time.time() * 1000) - start_ts > timeout_ms:
        return {
            "status": UpstreamStatus.FAILURE,
            "message": f"Task exceeded the {timeout_ms // 60000} minute processing limit.",
        }
    return data


# ── Helper: check remote doc ────────────────────────────────────────

async def _check_remote_document(doc_id: str) -> bool:
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
            resp = await client.get(
                f"{settings.effective_ai_ingest_host}/documents/{doc_id}"
            )
            return resp.status_code == 200
    except Exception:
        return True  # Assume exists on error to avoid false positives


# ── Routes ──────────────────────────────────────────────────────────

@router.post("/query/stream")
async def stream_query(
    request: Request,
    body: StreamQueryRequest,
    _user: dict = Depends(get_current_user),
    conv_repo: ConversationRepository = Depends(get_conversation_repository),
    doc_repo: DocumentRepository = Depends(get_document_repository),
):
    principal = Principal.from_user(_user)
    ctx = _extract_stream_context(request, body)
    effective_user_id = ctx.get("user_id") or _user.get("id")
    if effective_user_id is not None:
        effective_user_id = int(effective_user_id)
    conv_id_num = (
        int(ctx["conversation_id"])
        if ctx.get("conversation_id")
        else None
    )

    # Forward the full body as dict (including extra fields) to AI service
    body_dict = body.model_dump(exclude_none=True)

    audit_log(
        request,
        AuditActions.LLM_QUERY_STREAM_REQUEST,
        AuditEntityTypes.LLM,
        metadata={**ctx, "url_path": str(request.url)},
        user_id=effective_user_id,
        conversation_id=conv_id_num,
    )

    # Validate documents belong to conversation and are healthy
    if conv_id_num:
        row = await conv_repo.find_visible(principal, conv_id_num)
        if row:
            docs = await doc_repo.find_by_conversation(principal, conv_id_num)
            doc_id_set = {str(d["id"]) for d in docs}
            # Story 16: repository documents linked to this conversation by
            # reference are also usable here (the AI retrieval keys on
            # document_id; there is no upstream copy). They are not rows in this
            # conversation, so widen the accepted set — but ONLY with ids the
            # user explicitly linked, never arbitrary foreign documents.
            linked_repo_ids = set(
                await doc_repo.linked_repo_doc_ids(conv_id_num)
            )
            doc_id_set |= linked_repo_ids

            body_ids = body.documents or body.document_ids or []
            query_ids = ctx.get("document_ids") or []
            selected_ids = list({str(i) for i in [*body_ids, *query_ids]})

            # Story 134: when the client selected NO document, refuse the query
            # instead of forwarding it with no restriction. An empty selection
            # falls through to the AI service as `document_ids: []`, and both
            # qdrant.py and elasticsearch.py gate on `if document_ids:` — so an
            # empty list means "no filter", i.e. answer from the ENTIRE corpus.
            #
            # The original rule only fired when the conversation already had
            # documents (`doc_id_set and ...`), leaving an empty conversation as
            # "general chat". Đo được 2026-07-30 trên VPS: đó là một đường RÒ DỮ
            # LIỆU XUYÊN ĐƠN VỊ — user thường (is_admin=false, permissions=[])
            # thuộc đơn vị 3 hỏi trong hội thoại trống và nhận trọn nội dung tài
            # liệu riêng của admin đơn vị 1, citation trỏ sang 5 tài liệu của
            # người khác. Tier AI không có tầng lọc theo người dùng/đơn vị nào cả
            # — gateway LÀ chỗ duy nhất biết ai được đọc gì, nên nó phải chặn.
            # Hệ quả sản phẩm đã chấp nhận: muốn hỏi thì phải chọn tài liệu.
            if not selected_ids:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=ErrorMessages.NO_DOCUMENT_SELECTED,
                )

            # Check 1: Every selected ID must belong to this conversation
            # (or be a linked repository document).
            foreign_ids = [i for i in selected_ids if i not in doc_id_set]
            if foreign_ids:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=ErrorMessages.DOC_FOREIGN,
                )

            # Check 2: No selected conversation document should be in ERROR
            # status. Linked repository docs (story 16) are processed in the
            # repository, not rows of this conversation, so they bypass this
            # per-conversation status check; Check 3 still verifies they exist
            # remotely.
            doc_map = {str(d["id"]): d for d in docs}
            invalid = [
                i
                for i in selected_ids
                if i not in linked_repo_ids
                and (not doc_map.get(i) or doc_map[i]["status"] == "ERROR")
            ]

            # Check 3: Verify docs still exist on AI service
            if not invalid and selected_ids:
                for sid in selected_ids:
                    exists = await _check_remote_document(sid)
                    if not exists:
                        invalid.append(sid)
                if invalid:
                    from app.routes.document import sync_documents_background
                    import asyncio
                    asyncio.create_task(
                        sync_documents_background(principal, conv_id_num)
                    )

            if invalid:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=ErrorMessages.DOC_INVALID,
                )

    # Stateless STM + verified identity: this gateway owns the durable
    # conversation, so compute the recent window here and hand the AI a body
    # whose identity + history are trusted. Any client-supplied user_id /
    # unit_id / conversation_history is overwritten or dropped below, so a
    # client cannot spoof identity or inject fabricated context — including
    # when there is no conversation_id, the window is empty, or the read fails.
    history: list[dict] = []
    history_summary = ""
    if conv_id_num is not None and settings.stm_forward_window > 0:
        try:
            ds = await conv_repo.get_data_source(principal, conv_id_num)
            history_summary, history = _forwarded_context(
                ds, settings.stm_forward_window
            )
        except Exception:  # noqa: BLE001 — history is best-effort context
            logger.warning(
                "Failed to forward conversation history for conv_id=%s",
                conv_id_num,
                exc_info=True,
            )
    _apply_verified_identity(body_dict, principal, history, history_summary)

    # Forward to AI service (verified user_id in the body is authoritative).
    raw_qs = _query_string_without_user_id(str(request.url.query))
    url = f"{settings.ai_service_host}/query/stream"
    if raw_qs:
        url += f"?{raw_qs}"

    headers = {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
    }
    llm_api_key = settings.llm_api_key
    if llm_api_key:
        headers["Authorization"] = f"Bearer {llm_api_key}"

    try:
        client = httpx.AsyncClient(timeout=None, follow_redirects=True)
        upstream = await client.send(
            client.build_request("POST", url, json=body_dict, headers=headers),
            stream=True,
        )

        if upstream.status_code >= 400:
            text = await upstream.aread()
            await upstream.aclose()
            await client.aclose()
            audit_log(
                request,
                AuditActions.LLM_QUERY_STREAM_UPSTREAM_ERROR,
                AuditEntityTypes.LLM,
                user_id=effective_user_id,
                metadata={"status": upstream.status_code, "body_preview": text.decode()[:500]},
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=ErrorMessages.UPSTREAM_ERROR,
            )

        async def _stream():
            try:
                async for chunk in upstream.aiter_bytes(4096):
                    yield chunk
            finally:
                await upstream.aclose()
                await client.aclose()

        return StreamingResponse(
            _stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache, no-transform",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )
    except HTTPException:
        raise
    except Exception as exc:
        audit_log(
            request,
            AuditActions.LLM_QUERY_STREAM_ERROR,
            AuditEntityTypes.LLM,
            user_id=effective_user_id,
            metadata={"error": str(exc)},
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=ErrorMessages.UPSTREAM_ERROR,
        )


@router.post("/tools/draft/export")
async def draft_export_proxy(
    request: Request,
    _user: dict = Depends(get_current_user),
):
    """Proxy DOCX export to the AI service and stream the binary response."""
    body = await request.json()
    url = f"{settings.ai_service_host}/tools/draft/export"
    headers: dict = {"Content-Type": "application/json"}
    llm_api_key = settings.llm_api_key
    if llm_api_key:
        headers["Authorization"] = f"Bearer {llm_api_key}"

    try:
        async with httpx.AsyncClient(timeout=120, follow_redirects=True) as client:
            upstream = await client.post(url, json=body, headers=headers)

        if upstream.status_code >= 400:
            err_text = upstream.text
            err_json = parse_json_safe(err_text, None)
            detail = err_json.get("detail") if err_json else err_text
            raise HTTPException(status_code=upstream.status_code, detail=detail)

        content_disp = upstream.headers.get("content-disposition", "")
        media_type = upstream.headers.get(
            "content-type",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )

        audit_log(
            request,
            AuditActions.TOOL_INVOKE,
            AuditEntityTypes.TOOL,
            metadata={"tool_name": "draft/export", "upstream_status": upstream.status_code},
        )

        return StreamingResponse(
            iter([upstream.content]),
            media_type=media_type,
            headers={"Content-Disposition": content_disp} if content_disp else {},
        )
    except HTTPException:
        raise
    except Exception as exc:
        audit_log(
            request,
            AuditActions.TOOL_PROXY_ERROR,
            AuditEntityTypes.TOOL,
            metadata={"tool_name": "draft/export", "error": str(exc)},
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=ErrorMessages.UPSTREAM_ERROR,
        )



# ── Directive review ────────────────────────────────────────────────
# These MUST be declared before the /tools/{tool_name} catch-all: the
# catch-all does `await request.json()`, which cannot read a multipart
# body.

_DOCX_MEDIA_TYPE = (
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
)
# Matches the AI service's directive_review_max_upload_size (50 MB),
# checked here so an oversize file fails before the upstream round-trip.
_DIRECTIVE_REVIEW_MAX_UPLOAD = 50 * 1024 * 1024


@router.post("/tools/directive-review")
async def directive_review_submit_proxy(
    request: Request,
    file: UploadFile = File(...),
    payload: str = Form("{}"),
    _user: dict = Depends(get_current_user),
):
    """Forward a draft .docx + reference-doc payload to the AI service
    as multipart.

    The draft is transient — it is never indexed, so there is no
    document row to validate here (unlike the generic tool proxy,
    which checks document_id).
    """
    if not file.filename or not file.filename.lower().endswith(".docx"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Chỉ hỗ trợ file .docx",
        )

    content = await file.read()
    if len(content) > _DIRECTIVE_REVIEW_MAX_UPLOAD:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="File vượt quá dung lượng cho phép",
        )

    url = f"{settings.ai_service_host}/tools/directive-review"
    headers: dict = {}
    llm_api_key = settings.llm_api_key
    if llm_api_key:
        headers["Authorization"] = f"Bearer {llm_api_key}"

    try:
        async with httpx.AsyncClient(
            timeout=600, follow_redirects=True
        ) as client:
            upstream = await client.post(
                url,
                files={"file": (file.filename, content, _DOCX_MEDIA_TYPE)},
                data={"payload": payload},
                headers=headers,
            )

        text = upstream.text
        parsed = parse_json_safe(text, None)

        if upstream.status_code >= 400:
            detail = parsed.get("detail") if parsed else text
            raise HTTPException(
                status_code=upstream.status_code, detail=detail
            )

        audit_log(
            request,
            AuditActions.TOOL_INVOKE,
            AuditEntityTypes.TOOL,
            entity_id=parsed.get("task_id") if parsed else None,
            metadata={
                "tool_name": "directive-review",
                "upstream_status": upstream.status_code,
                "filename": file.filename,
            },
        )
        return parsed if parsed else {}
    except HTTPException:
        raise
    except Exception as exc:
        audit_log(
            request,
            AuditActions.TOOL_PROXY_ERROR,
            AuditEntityTypes.TOOL,
            metadata={"tool_name": "directive-review", "error": str(exc)},
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=ErrorMessages.UPSTREAM_ERROR,
        )


@router.post("/tools/directive-review/export")
async def directive_review_export_proxy(
    request: Request,
    _user: dict = Depends(get_current_user),
):
    """Proxy the advisory-report DOCX export and stream the binary
    response."""
    body = await request.json()
    url = f"{settings.ai_service_host}/tools/directive-review/export"
    headers: dict = {"Content-Type": "application/json"}
    llm_api_key = settings.llm_api_key
    if llm_api_key:
        headers["Authorization"] = f"Bearer {llm_api_key}"

    try:
        async with httpx.AsyncClient(
            timeout=120, follow_redirects=True
        ) as client:
            upstream = await client.post(url, json=body, headers=headers)

        if upstream.status_code >= 400:
            err_text = upstream.text
            err_json = parse_json_safe(err_text, None)
            detail = err_json.get("detail") if err_json else err_text
            raise HTTPException(
                status_code=upstream.status_code, detail=detail
            )

        content_disp = upstream.headers.get("content-disposition", "")
        media_type = upstream.headers.get("content-type", _DOCX_MEDIA_TYPE)

        audit_log(
            request,
            AuditActions.TOOL_INVOKE,
            AuditEntityTypes.TOOL,
            metadata={
                "tool_name": "directive-review/export",
                "upstream_status": upstream.status_code,
            },
        )

        return StreamingResponse(
            iter([upstream.content]),
            media_type=media_type,
            headers=(
                {"Content-Disposition": content_disp}
                if content_disp
                else {}
            ),
        )
    except HTTPException:
        raise
    except Exception as exc:
        audit_log(
            request,
            AuditActions.TOOL_PROXY_ERROR,
            AuditEntityTypes.TOOL,
            metadata={
                "tool_name": "directive-review/export",
                "error": str(exc),
            },
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=ErrorMessages.UPSTREAM_ERROR,
        )


# ── Audio overview (Dev Space) ──────────────────────────────────────
# Submit and status already work through the generic proxies below:
# `/tools/{tool_name}` forwards the JSON body untouched, and
# `ToolStatusResponse` sets extra="allow" so object_key / transcript /
# duration_sec / audio_format / size_bytes survive the round trip.
#
# These three do not, and each for its own reason: the file route returns
# binary, and cancel/delete are three-segment paths the catch-all's shape
# does not cover. Declared here, above the catch-all, per the invariant
# stated at the top of the directive-review block.
#
# CALLER WARNING — do not send `startTime` when polling audio-overview
# status. A finished AudioOverviewResponse carries no `status` field, and
# `_apply_zombie_check` reads a status-less body as "stuck": past
# ZOMBIE_TASK_TIMEOUT_MS it rewrites a perfectly good episode into
# {status: FAILURE}. Omitting startTime takes the early-out at its top.

_AUDIO_OVERVIEW_MEDIA_TYPE = "audio/mpeg"


@router.get("/tools/audio-overview/{task_id}/file")
async def audio_overview_file_proxy(
    request: Request,
    task_id: str,
    _user: dict = Depends(get_current_user),
):
    """Stream a finished podcast episode from the AI service.

    Streamed rather than buffered on purpose. An episode is tens of MB —
    and larger still on hosts without ffmpeg, where the AI service falls
    back from mp3 to wav — so the ``iter([upstream.content])`` shape used
    by the DOCX export would hold the whole file in this process's memory.

    Upstream statuses are passed through verbatim because each is a
    distinct UI state: 409 (still rendering), 404 (deleted or expired),
    502 (object store unreachable).

    Args:
        request: The incoming request, for audit context.
        task_id: The Celery task id returned by the submit call.
        _user: Authenticated user, injected.

    Returns:
        A ``StreamingResponse`` carrying the audio bytes.

    Raises:
        HTTPException: the upstream status on an upstream error, or 502
            when the AI service is unreachable.
    """
    url = (
        f"{settings.ai_service_host}/tools/audio-overview/"
        f"{urllib.parse.quote(task_id, safe='')}/file"
    )
    headers: dict = {}
    llm_api_key = settings.llm_api_key
    if llm_api_key:
        headers["Authorization"] = f"Bearer {llm_api_key}"

    client = httpx.AsyncClient(timeout=None, follow_redirects=True)
    try:
        upstream = await client.send(
            client.build_request("GET", url, headers=headers), stream=True
        )
    except Exception as exc:
        await client.aclose()
        audit_log(
            request,
            AuditActions.TOOL_PROXY_ERROR,
            AuditEntityTypes.TOOL,
            entity_id=task_id,
            metadata={"tool_name": "audio-overview/file", "error": str(exc)},
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=ErrorMessages.UPSTREAM_ERROR,
        )

    if upstream.status_code >= 400:
        err_text = (await upstream.aread()).decode(errors="replace")
        await upstream.aclose()
        await client.aclose()
        err_json = parse_json_safe(err_text, None)
        raise HTTPException(
            status_code=upstream.status_code,
            detail=err_json.get("detail") if err_json else err_text,
        )

    audit_log(
        request,
        AuditActions.TOOL_INVOKE,
        AuditEntityTypes.TOOL,
        entity_id=task_id,
        metadata={
            "tool_name": "audio-overview/file",
            "upstream_status": upstream.status_code,
        },
    )

    async def _stream():
        try:
            async for chunk in upstream.aiter_bytes(65536):
                yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    # Content-Length lets the browser show a real progress bar and lets
    # <audio> seek. Both node proxies must be told NOT to strip it for this
    # path — see the audio-overview entry in server.js / setupProxy.js.
    passthrough = (
        ("Content-Length", upstream.headers.get("content-length")),
        ("Content-Disposition", upstream.headers.get("content-disposition")),
    )
    return StreamingResponse(
        _stream(),
        media_type=upstream.headers.get(
            "content-type", _AUDIO_OVERVIEW_MEDIA_TYPE
        ),
        headers={k: v for k, v in passthrough if v},
    )


async def _audio_overview_action(
    request: Request,
    task_id: str,
    method: str,
    suffix: str,
    tool_label: str,
) -> dict:
    """Proxy a JSON audio-overview control call, preserving its status.

    Shared by cancel and delete: same auth, same audit shape, same
    requirement that 409 ("task is still running") reaches the client as
    409 rather than being flattened into a generic gateway error.
    """
    url = (
        f"{settings.ai_service_host}/tools/audio-overview/"
        f"{urllib.parse.quote(task_id, safe='')}{suffix}"
    )
    headers: dict = {}
    llm_api_key = settings.llm_api_key
    if llm_api_key:
        headers["Authorization"] = f"Bearer {llm_api_key}"

    try:
        async with httpx.AsyncClient(
            timeout=30, follow_redirects=True
        ) as client:
            upstream = await client.request(method, url, headers=headers)

        text = upstream.text
        parsed = parse_json_safe(text, None)

        if upstream.status_code >= 400:
            raise HTTPException(
                status_code=upstream.status_code,
                detail=parsed.get("detail") if parsed else text,
            )

        audit_log(
            request,
            AuditActions.TOOL_INVOKE,
            AuditEntityTypes.TOOL,
            entity_id=task_id,
            metadata={
                "tool_name": tool_label,
                "upstream_status": upstream.status_code,
            },
        )
        return parsed if parsed else {}
    except HTTPException:
        raise
    except Exception as exc:
        audit_log(
            request,
            AuditActions.TOOL_PROXY_ERROR,
            AuditEntityTypes.TOOL,
            entity_id=task_id,
            metadata={"tool_name": tool_label, "error": str(exc)},
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=ErrorMessages.UPSTREAM_ERROR,
        )


@router.post("/tools/audio-overview/{task_id}/cancel")
async def audio_overview_cancel_proxy(
    request: Request,
    task_id: str,
    _user: dict = Depends(get_current_user),
):
    """Ask the AI service to stop rendering an episode.

    Cancellation is cooperative and asynchronous: this returns
    ``cancel_requested``, and the task's status becomes ``cancelled`` on a
    later poll. It is not a synchronous kill.
    """
    return await _audio_overview_action(
        request, task_id, "POST", "/cancel", "audio-overview/cancel"
    )


@router.delete("/tools/audio-overview/{task_id}")
async def audio_overview_delete_proxy(
    request: Request,
    task_id: str,
    _user: dict = Depends(get_current_user),
):
    """Delete a finished episode and its stored audio.

    Returns 409 while the task is still running — cancel it first.
    """
    return await _audio_overview_action(
        request, task_id, "DELETE", "", "audio-overview/delete"
    )


@router.post("/tools/{tool_name}")
async def tool_proxy(
    request: Request,
    tool_name: str,
    _user: dict = Depends(get_current_user),
    conv_repo: ConversationRepository = Depends(get_conversation_repository),
    doc_repo: DocumentRepository = Depends(get_document_repository),
):
    principal = Principal.from_user(_user)
    body = await request.json()
    ctx = _extract_tool_context(body)

    # Validate document status
    if ctx.get("document_id") and ctx.get("conversation_id"):
        conv_id = int(ctx["conversation_id"])
        row = await conv_repo.find_visible(principal, conv_id)
        if row:
            doc = await doc_repo.find_visible(principal, ctx["document_id"])
            exists = True
            if doc and doc["status"] != "ERROR":
                exists = await _check_remote_document(ctx["document_id"])
                if not exists:
                    from app.routes.document import sync_documents_background
                    import asyncio
                    asyncio.create_task(
                        sync_documents_background(principal, conv_id)
                    )

            if not doc or doc["status"] == "ERROR" or not exists:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=ErrorMessages.DOC_INVALID,
                )

    url = f"{settings.ai_service_host}/tools/{urllib.parse.quote(tool_name, safe='')}"
    headers: dict = {"Content-Type": "application/json"}
    llm_api_key = settings.llm_api_key
    if llm_api_key:
        headers["Authorization"] = f"Bearer {llm_api_key}"

    try:
        async with httpx.AsyncClient(timeout=600, follow_redirects=True) as client:
            upstream = await client.post(url, json=body, headers=headers)

        text = upstream.text
        parsed = parse_json_safe(text, None)

        audit_log(
            request,
            AuditActions.TOOL_INVOKE,
            AuditEntityTypes.TOOL,
            entity_id=parsed.get("task_id") if parsed else None,
            metadata={"tool_name": tool_name, "upstream_status": upstream.status_code, **ctx},
        )

        if parsed:
            return parsed
        from fastapi.responses import PlainTextResponse
        return PlainTextResponse(text, status_code=upstream.status_code)
    except HTTPException:
        raise
    except Exception as exc:
        audit_log(
            request,
            AuditActions.TOOL_PROXY_ERROR,
            AuditEntityTypes.TOOL,
            metadata={"tool_name": tool_name, "error": str(exc)},
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=ErrorMessages.UPSTREAM_ERROR,
        )


@router.get("/tools/{tool_name}/status/{task_id}", response_model=ToolStatusResponse)
async def tool_status(
    request: Request, tool_name: str, task_id: str, _user: dict = Depends(get_current_user)
):
    start_time = request.query_params.get("startTime")

    url = (
        f"{settings.ai_service_host}/tools/"
        f"{urllib.parse.quote(tool_name, safe='')}/status/"
        f"{urllib.parse.quote(task_id, safe='')}"
    )
    headers: dict = {}
    llm_api_key = settings.llm_api_key
    if llm_api_key:
        headers["Authorization"] = f"Bearer {llm_api_key}"

    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            upstream = await client.get(url, headers=headers)

        if upstream.status_code >= 400:
            err_text = upstream.text
            err_json = parse_json_safe(err_text, None)
            return ToolStatusResponse(
                status=UpstreamStatus.FAILURE,
                message=err_json.get("detail") if err_json else err_text,
            )

        data = upstream.json()
        data = _apply_zombie_check(data, start_time)

        conv_id = request.query_params.get("conversation_id")
        audit_log(
            request,
            AuditActions.TOOL_STATUS,
            AuditEntityTypes.TOOL,
            entity_id=task_id,
            conversation_id=int(conv_id) if conv_id else None,
            metadata={"status": data.get("status"), "tool": tool_name},
        )
        return ToolStatusResponse(**data)
    except Exception as exc:
        return ToolStatusResponse(status=UpstreamStatus.FAILURE, error=str(exc))


@router.get("/task/{task_id}", response_model=ToolStatusResponse)
async def document_status(
    request: Request, task_id: str, _user: dict = Depends(get_current_user)
):
    start_time = request.query_params.get("startTime")

    url = f"{settings.effective_ai_ingest_host}/documents/task/{task_id}"
    headers: dict = {}
    llm_api_key = settings.llm_api_key
    if llm_api_key:
        headers["Authorization"] = f"Bearer {llm_api_key}"

    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            resp = await client.get(url, headers=headers)
        if resp.status_code >= 400:
            raise Exception(f"Upstream status {resp.status_code}")

        data = resp.json()
        data = _apply_zombie_check(data, start_time)
        return ToolStatusResponse(**data)
    except Exception as exc:
        return ToolStatusResponse(status=UpstreamStatus.FAILURE, error=str(exc))
