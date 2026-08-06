"""Conversation routes.

Access is scoped by the authenticated caller's position in the unit tree (see
:mod:`app.models.access`), not by the path ``user_id``: a non-admin sees only
their own conversations; an admin sees their unit subtree.
"""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status

from app.constants.audit import AuditActions, AuditEntityTypes
from app.constants.errors import ErrorMessages
from app.middlewares.auth import get_current_user
from app.services.conversation_compaction import compact_conversation
from app.models.access import Principal
from app.models.schemas import (
    AddMessageRequest,
    AddMessageResponse,
    CreateConversationRequest,
    CreateConversationResponse,
    DataSourceResponse,
    RenameRequest,
    SuccessResponse,
    UpdateSummaryRequest,
)
from app.repositories.base import (
    ConversationRepository,
    DocumentRepository,
    InfoTableRepository,
)
from app.repositories.factory import (
    get_conversation_repository,
    get_document_repository,
    get_info_table_repository,
)
from app.utils.audit import audit_log

router = APIRouter()


async def _find_or_fail(
    repo: ConversationRepository, principal: Principal, conv_id: int
):
    row = await repo.find_visible(principal, conv_id)
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessages.NOT_FOUND,
        )
    return row


@router.get("/users/{user_id}/conversations")
async def list_conversations(
    user_id: int,
    _user: dict = Depends(get_current_user),
    repo: ConversationRepository = Depends(get_conversation_repository),
):
    return await repo.list_visible(Principal.from_user(_user))


@router.post(
    "/users/{user_id}/conversations",
    response_model=CreateConversationResponse,
)
async def create_conversation(
    request: Request,
    user_id: int,
    body: CreateConversationRequest,
    _user: dict = Depends(get_current_user),
    repo: ConversationRepository = Depends(get_conversation_repository),
):
    owner_id = _user["id"]
    result = await repo.create(
        {
            "name": body.name.strip(),
            "user_id": owner_id,
            "initial_summary": body.initialSummary or "",
        }
    )
    conv_id = result["id"]
    audit_log(
        request,
        AuditActions.CONVERSATION_CREATE,
        AuditEntityTypes.CONVERSATION,
        entity_id=conv_id,
        conversation_id=conv_id,
        metadata={"name": body.name.strip()},
    )
    return CreateConversationResponse(
        id=conv_id, name=body.name.strip(), user_id=owner_id
    )


@router.get("/users/{user_id}/conversations/{conv_id}")
async def get_conversation(
    user_id: int,
    conv_id: int,
    _user: dict = Depends(get_current_user),
    repo: ConversationRepository = Depends(get_conversation_repository),
    doc_repo: DocumentRepository = Depends(get_document_repository),
    info_repo: InfoTableRepository = Depends(get_info_table_repository),
):
    principal = Principal.from_user(_user)
    row = await _find_or_fail(repo, principal, conv_id)
    result = dict(row)

    result["data_source"] = await repo.get_data_source(principal, conv_id)
    result.pop("mongo_key", None)

    result["documents"] = await doc_repo.find_by_conversation(
        principal, conv_id
    )
    result["info_tables"] = await info_repo.find_by_conversation(
        principal, conv_id
    )
    return result


@router.delete(
    "/users/{user_id}/conversations/{conv_id}",
    response_model=SuccessResponse,
)
async def delete_conversation(
    request: Request,
    user_id: int,
    conv_id: int,
    _user: dict = Depends(get_current_user),
    repo: ConversationRepository = Depends(get_conversation_repository),
    doc_repo: DocumentRepository = Depends(get_document_repository),
):
    principal = Principal.from_user(_user)
    row = await _find_or_fail(repo, principal, conv_id)

    docs = await doc_repo.find_by_conversation(principal, conv_id)

    # This also deletes the MongoDB data_source document.
    await repo.delete(principal, conv_id)

    audit_log(
        request,
        AuditActions.CONVERSATION_DELETE,
        AuditEntityTypes.CONVERSATION,
        entity_id=conv_id,
        conversation_id=conv_id,
        metadata={"name": row["name"]},
    )

    # Fire-and-forget: cleanup remote documents.
    import asyncio

    import httpx

    from app.config import settings

    async def _cleanup_remote(doc_id: str):
        try:
            async with httpx.AsyncClient(
                timeout=60, follow_redirects=True
            ) as client:
                await client.delete(
                    f"{settings.effective_ai_ingest_host}/documents/{doc_id}"
                )
        except Exception:
            pass

    for doc in docs:
        asyncio.create_task(_cleanup_remote(doc["id"]))

    return SuccessResponse()


@router.patch(
    "/users/{user_id}/conversations/{conv_id}/rename",
    response_model=SuccessResponse,
)
async def rename_conversation(
    request: Request,
    user_id: int,
    conv_id: int,
    body: RenameRequest,
    _user: dict = Depends(get_current_user),
    repo: ConversationRepository = Depends(get_conversation_repository),
):
    principal = Principal.from_user(_user)
    row = await _find_or_fail(repo, principal, conv_id)
    await repo.update_name(principal, conv_id, body.name.strip())

    audit_log(
        request,
        AuditActions.CONVERSATION_RENAME,
        AuditEntityTypes.CONVERSATION,
        entity_id=conv_id,
        conversation_id=conv_id,
        metadata={"old": row["name"], "new": body.name},
    )
    return SuccessResponse()


@router.patch(
    "/users/{user_id}/conversations/{conv_id}/initial-summary",
    response_model=SuccessResponse,
)
async def update_initial_summary(
    request: Request,
    user_id: int,
    conv_id: int,
    body: UpdateSummaryRequest,
    _user: dict = Depends(get_current_user),
    repo: ConversationRepository = Depends(get_conversation_repository),
):
    principal = Principal.from_user(_user)
    info = await repo.update_field(
        principal, conv_id, "initial_summary", body.summary.strip()
    )
    if info["changes"] == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessages.NOT_FOUND,
        )
    return SuccessResponse()


@router.patch(
    "/users/{user_id}/conversations/{conv_id}/messages",
    response_model=AddMessageResponse,
)
async def add_message(
    request: Request,
    user_id: int,
    conv_id: int,
    body: AddMessageRequest,
    background_tasks: BackgroundTasks,
    _user: dict = Depends(get_current_user),
    repo: ConversationRepository = Depends(get_conversation_repository),
):
    principal = Principal.from_user(_user)
    await _find_or_fail(repo, principal, conv_id)

    ds = await repo.get_data_source(principal, conv_id)
    if not isinstance(ds.get("messages"), list):
        ds["messages"] = []

    # Clean sources — use document_id instead of document_name.
    cleaned_sources = None
    if body.sources:
        cleaned = []
        for s in body.sources:
            content = s.enriched_content or s.content or ""
            if not content:
                continue
            item = {
                "enriched_content": content,
                "document_id": s.document_id or "",
                "metadata": s.metadata,
            }
            # The chunk itself, and where it sits in the document's source
            # text. `enriched_content` is the retrieval window around it, too
            # wide to highlight; these let the viewer mark the exact passage.
            if s.content:
                item["content"] = s.content
            if s.char_start is not None:
                item["char_start"] = s.char_start
            if s.char_end is not None:
                item["char_end"] = s.char_end
            if s.context_metadata:
                item["context_metadata"] = s.context_metadata
            cleaned.append(item)
        if cleaned:
            cleaned_sources = cleaned

    msg: dict = {"q": body.question, "a": body.answer}
    if cleaned_sources:
        msg["sources"] = cleaned_sources
    ds["messages"].append(msg)

    await repo.update_data_source(principal, conv_id, ds)

    # Fold whatever just aged out of the forwarded window, after the turn is
    # stored and off the response path. The user never waits for it, and if it
    # fails the turns stay in `messages` and are absorbed on a later call — the
    # marker only advances on a successful fold.
    background_tasks.add_task(compact_conversation, principal, conv_id)

    return AddMessageResponse(data_source=ds)


@router.get(
    "/users/{user_id}/conversations/{conv_id}/data-source",
    response_model=DataSourceResponse,
)
async def get_data_source(
    user_id: int,
    conv_id: int,
    _user: dict = Depends(get_current_user),
    repo: ConversationRepository = Depends(get_conversation_repository),
):
    principal = Principal.from_user(_user)
    await _find_or_fail(repo, principal, conv_id)
    ds = await repo.get_data_source(principal, conv_id)
    return DataSourceResponse(data_source=ds)
