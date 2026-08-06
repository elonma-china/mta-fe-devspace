"""Info Table routes — CRUD for the normalized info_table table.

Access is scoped through the owning conversation (see :mod:`app.models.access`).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.constants.audit import AuditActions, AuditEntityTypes
from app.constants.errors import ErrorMessages
from app.constants.status import ProcessingStatus
from app.middlewares.auth import get_current_user
from app.models.access import Principal
from app.models.schemas import (
    CreateInfoTableRequest,
    CreateInfoTableResponse,
    DeleteInfoTableResponse,
    InfoTableListResponse,
    InfoTableOut,
    UpdateInfoTableRequest,
    UpdateInfoTableResponse,
)
from app.repositories.base import ConversationRepository, InfoTableRepository
from app.repositories.factory import (
    get_conversation_repository,
    get_info_table_repository,
)
from app.utils.audit import audit_log

router = APIRouter()

VALID_TYPES = {"summary", "mindmap", "report", "directive_review"}


async def _conv_or_fail(
    repo: ConversationRepository, principal: Principal, conv_id: int
) -> None:
    if not await repo.find_visible(principal, conv_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessages.NOT_FOUND,
        )


@router.get(
    "/users/{user_id}/conversations/{conv_id}/info-tables",
    response_model=InfoTableListResponse,
)
async def list_info_tables(
    user_id: int,
    conv_id: int,
    _user: dict = Depends(get_current_user),
    conv_repo: ConversationRepository = Depends(get_conversation_repository),
    info_repo: InfoTableRepository = Depends(get_info_table_repository),
):
    principal = Principal.from_user(_user)
    await _conv_or_fail(conv_repo, principal, conv_id)
    items = await info_repo.find_by_conversation(principal, conv_id)
    return InfoTableListResponse(info_tables=[InfoTableOut(**i) for i in items])


@router.post(
    "/users/{user_id}/conversations/{conv_id}/info-tables",
    response_model=CreateInfoTableResponse,
)
async def create_info_table(
    request: Request,
    user_id: int,
    conv_id: int,
    body: CreateInfoTableRequest,
    _user: dict = Depends(get_current_user),
    conv_repo: ConversationRepository = Depends(get_conversation_repository),
    info_repo: InfoTableRepository = Depends(get_info_table_repository),
):
    if body.type not in VALID_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=ErrorMessages.INVALID_TYPE,
        )
    if not body.name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=ErrorMessages.MISSING_FIELDS,
        )

    principal = Principal.from_user(_user)
    await _conv_or_fail(conv_repo, principal, conv_id)

    item = await info_repo.create({
        "conversation_id": conv_id,
        "type": body.type,
        "name": body.name,
        "content": body.content,
        "selected": body.selected,
        "status": body.status or ProcessingStatus.PENDING,
        "task_id": body.task_id,
    })

    audit_log(
        request,
        AuditActions.INFO_TABLE_CREATE,
        AuditEntityTypes.INFO_TABLE,
        entity_id=item["id"],
        conversation_id=conv_id,
        metadata={"type": body.type, "name": body.name},
    )
    return CreateInfoTableResponse(info=InfoTableOut(**item))


@router.delete(
    "/users/{user_id}/conversations/{conv_id}/info-tables/{info_id}",
    response_model=DeleteInfoTableResponse,
)
async def delete_info_table(
    request: Request,
    user_id: int,
    conv_id: int,
    info_id: str,
    _user: dict = Depends(get_current_user),
    conv_repo: ConversationRepository = Depends(get_conversation_repository),
    info_repo: InfoTableRepository = Depends(get_info_table_repository),
):
    principal = Principal.from_user(_user)
    await _conv_or_fail(conv_repo, principal, conv_id)

    removed = await info_repo.delete(principal, info_id)
    if not removed:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessages.ITEM_NOT_FOUND,
        )

    audit_log(
        request,
        AuditActions.INFO_TABLE_DELETE,
        AuditEntityTypes.INFO_TABLE,
        entity_id=info_id,
        conversation_id=conv_id,
        metadata={"name": removed.get("name")},
    )
    return DeleteInfoTableResponse(removed=InfoTableOut(**removed))


@router.patch(
    "/users/{user_id}/conversations/{conv_id}/info-tables/{info_id}",
    response_model=UpdateInfoTableResponse,
)
async def update_info_table(
    request: Request,
    user_id: int,
    conv_id: int,
    info_id: str,
    body: UpdateInfoTableRequest,
    _user: dict = Depends(get_current_user),
    conv_repo: ConversationRepository = Depends(get_conversation_repository),
    info_repo: InfoTableRepository = Depends(get_info_table_repository),
):
    principal = Principal.from_user(_user)
    await _conv_or_fail(conv_repo, principal, conv_id)

    patch = body.model_dump(exclude_none=True)
    if not patch:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=ErrorMessages.NO_FIELDS_UPDATE,
        )

    result = await info_repo.update(principal, info_id, patch)
    if result["changes"] == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessages.ITEM_NOT_FOUND,
        )

    items = await info_repo.find_by_conversation(principal, conv_id)
    return UpdateInfoTableResponse(info_tables=[InfoTableOut(**i) for i in items])
