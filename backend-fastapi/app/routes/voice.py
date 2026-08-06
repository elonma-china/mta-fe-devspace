"""Voice routes — speech-to-text proxy to the AI service.

Separate from ``llm.py`` for one structural reason: ``llm.py`` ends in a
``POST /tools/{tool_name}`` catch-all that reads ``await request.json()``,
which cannot read a multipart body. Anything multipart has to be declared
before it, and a file of its own is cheaper to reason about than another
"must be above line N" comment.
"""

from __future__ import annotations

import logging

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

from app.config import settings
from app.constants.audit import AuditActions, AuditEntityTypes
from app.constants.errors import ErrorMessages
from app.middlewares.auth import get_current_user
from app.utils.audit import audit_log
from app.utils.helpers import parse_json_safe

logger = logging.getLogger(__name__)
router = APIRouter()


# Mirrors the AI service's stt_max_upload_size (25 MB), which in turn mirrors
# the serving tier's STT_MAX_AUDIO_BYTES. Checked here so an oversize clip
# fails before the upstream round-trip.
_STT_MAX_UPLOAD = 26_214_400

_STT_TIMEOUT_SECONDS = 120


@router.post("/stt/transcribe")
async def stt_transcribe_proxy(
    request: Request,
    file: UploadFile = File(...),
    language: str = Form("vi"),
    _user: dict = Depends(get_current_user),
):
    """Forward a recorded audio clip to the AI service for transcription.

    The clip is transient — never indexed, never stored — so unlike the
    generic tool proxy there is no document row to validate.

    Upstream statuses are propagated verbatim rather than collapsed to 502.
    Each one carries a distinct meaning the UI acts on differently: 403
    (``ENABLE_STT=false``), 413 (too large), 415 (unsupported extension),
    422 (empty/undecodable audio), 503 (engine or ffmpeg missing). Folding
    them into "Lỗi kết nối" would make a disabled feature and a corrupt
    upload indistinguishable.

    Args:
        request: The incoming request, for audit context.
        file: The uploaded audio clip. The **filename extension matters** —
            the AI service gates on it (``.wav``, ``.webm``, ``.ogg``,
            ``.opus``, ``.m4a``, ``.mp3``, ``.flac``, ``.aac``), so the
            client must name the blob, not send an anonymous one.
        language: ``vi`` or ``en``; selects the STT engine.
        _user: Authenticated user, injected.

    Returns:
        The AI service's transcription payload: ``text``, ``language``,
        ``duration_ms`` and ``segments``.

    Raises:
        HTTPException: 413 when over the size cap, the upstream status on an
            upstream error, or 502 when the AI service is unreachable.
    """
    content = await file.read()
    if len(content) > _STT_MAX_UPLOAD:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Đoạn ghi âm vượt quá dung lượng cho phép",
        )
    if not content:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Đoạn ghi âm rỗng",
        )

    url = f"{settings.ai_service_host}/stt/transcribe"
    headers: dict = {}
    llm_api_key = settings.llm_api_key
    if llm_api_key:
        headers["Authorization"] = f"Bearer {llm_api_key}"

    try:
        async with httpx.AsyncClient(
            timeout=_STT_TIMEOUT_SECONDS, follow_redirects=True
        ) as client:
            upstream = await client.post(
                url,
                files={
                    "file": (
                        file.filename or "voice.wav",
                        content,
                        file.content_type or "audio/wav",
                    )
                },
                data={"language": language},
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
            metadata={
                "tool_name": "stt/transcribe",
                "upstream_status": upstream.status_code,
                "language": language,
                "bytes": len(content),
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
            metadata={"tool_name": "stt/transcribe", "error": str(exc)},
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=ErrorMessages.UPSTREAM_ERROR,
        )
