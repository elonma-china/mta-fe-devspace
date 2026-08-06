"""User management routes (admin only).

Authorization is unit-tree based (see :mod:`app.models.access`): an admin may
manage users and roles within their own unit and all descendant units. The
admin of the root unit therefore manages everyone (structural super-admin).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy.exc import IntegrityError

from app.constants.audit import AuditActions, AuditEntityTypes
from app.constants.errors import ErrorMessages
from app.middlewares.auth import require_admin, require_permission
from app.models.access import Principal
from app.models.schemas import (
    AdminCandidate,
    CreateDocGroupRequest,
    CreateUnitRequest,
    CreateUserRequest,
    CreateUserResponse,
    DocGroupItem,
    DocGroupListResponse,
    LockUserRequest,
    LockUserResponse,
    RoleInfo,
    SuccessResponse,
    UnitListItem,
    UnitListResponse,
    UpdateDocGroupRequest,
    UpdateUnitRequest,
    UpdateUserRequest,
    UserDeleteImpact,
    UserInfo,
)
from app.repositories.base import UserRepository
from app.repositories.factory import get_user_repository
from app.utils.audit import audit_log

router = APIRouter()

ROOT_UNIT_ID = 1


def _is_root_admin(principal: Principal) -> bool:
    """Whether the principal administers the whole tree (root or unit-less)."""
    return principal.is_admin and (
        principal.unit_id is None or principal.unit_id == ROOT_UNIT_ID
    )


_UNIT_BAD_REQUEST_ERRORS = frozenset(
    {
        ErrorMessages.UNIT_NAME_REQUIRED,
        ErrorMessages.USERNAME_INVALID,
    }
)


def _unit_value_error_status(message: str) -> int:
    """Map a unit ValueError message to 400 (validation) or 409 (conflict)."""
    if message in _UNIT_BAD_REQUEST_ERRORS:
        return status.HTTP_400_BAD_REQUEST
    return status.HTTP_409_CONFLICT


def _doc_group_value_error_status(message: str) -> int:
    """Map a doc-group ValueError to 400 (validation) or 409 (conflict)."""
    if message == ErrorMessages.DOC_GROUP_NAME_REQUIRED:
        return status.HTTP_400_BAD_REQUEST
    return status.HTTP_409_CONFLICT


def _resolve_group_unit(principal: Principal, unit_id: int | None) -> int:
    """Resolve which unit's groups the caller operates on (story 77).

    Mirrors ``_resolve_repo_unit`` (document routes): a super-admin/commander
    (root or unit-less) MUST focus a unit; a unit admin always uses their own
    unit and may not target a foreign one.
    """
    is_super = principal.unit_id is None or principal.unit_id == ROOT_UNIT_ID
    if is_super:
        if unit_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=ErrorMessages.UNIT_FOCUS_REQUIRED,
            )
        return unit_id
    if unit_id is not None and unit_id != principal.unit_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=ErrorMessages.FORBIDDEN,
        )
    return principal.unit_id


def _group_unit_restriction(principal: Principal) -> int | None:
    """Unit a caller is restricted to for group update/delete (story 77).

    ``None`` for a super-admin/commander (may touch any unit's group via its id);
    the own unit id for a unit admin (foreign groups are 404).
    """
    is_super = principal.unit_id is None or principal.unit_id == ROOT_UNIT_ID
    return None if is_super else principal.unit_id


async def _validate_target_unit(
    repo: UserRepository, principal: Principal, body: CreateUserRequest | UpdateUserRequest
) -> None:
    """Ensure the caller may place a user in the requested unit.

    A unit referenced by id must be within the caller's subtree. Creating a
    brand-new named unit is restricted to root admins.
    """
    if body.unit_id is not None:
        if not await repo.is_unit_accessible(principal, body.unit_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=ErrorMessages.PERMISSION_DENIED,
            )
    elif body.unit_name and not _is_root_admin(principal):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=ErrorMessages.PERMISSION_DENIED,
        )


async def _validate_role(
    repo: UserRepository, principal: Principal, role_id: int | None
) -> None:
    """Ensure an explicitly-chosen role belongs to an accessible unit."""
    if role_id is None:
        return
    role = await repo.find_role_by_id(role_id)
    if not role:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=ErrorMessages.ROLE_NOT_FOUND,
        )
    unit_id = role.get("unit_id")
    if unit_id is not None and not await repo.is_unit_accessible(
        principal, unit_id
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=ErrorMessages.PERMISSION_DENIED,
        )


@router.post("/users", response_model=CreateUserResponse)
async def create_user(
    request: Request,
    body: CreateUserRequest,
    current_user: dict = Depends(require_admin),
    repo: UserRepository = Depends(get_user_repository),
) -> CreateUserResponse:
    """Create a new user within the caller's accessible unit subtree."""
    principal = Principal.from_user(current_user)
    await _validate_target_unit(repo, principal, body)
    await _validate_role(repo, principal, body.role_id)

    payload = body.model_dump()
    if payload.get("unit_name") is not None:
        payload["unit_name"] = payload["unit_name"].strip()
        if not payload["unit_name"]:
            payload["unit_name"] = None

    # Default to the caller's unit when none was specified.
    if payload.get("unit_id") is None and not payload.get("unit_name"):
        payload["unit_id"] = principal.unit_id

    # Every user must belong to a unit; only the bootstrap super-admin may be
    # unit-less. The caller must therefore supply a unit (the super-admin, who
    # has no unit of their own, must name one explicitly).
    if payload.get("unit_id") is None and not payload.get("unit_name"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=ErrorMessages.UNIT_REQUIRED,
        )

    try:
        info = await repo.create(payload)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )

    audit_log(
        request,
        AuditActions.USER_CREATE,
        AuditEntityTypes.USER,
        entity_id=info["id"],
        metadata={"username": body.username},
    )
    return CreateUserResponse(id=info["id"])


@router.get("/users", response_model=list[UserInfo])
async def list_users(
    current_user: dict = Depends(require_admin),
    repo: UserRepository = Depends(get_user_repository),
) -> list[UserInfo]:
    """List users within the caller's accessible unit subtree."""
    rows = await repo.list_visible(Principal.from_user(current_user))
    return [UserInfo(**r) for r in rows]


@router.get("/users/{user_id}", response_model=UserInfo)
async def get_user(
    user_id: int,
    current_user: dict = Depends(require_admin),
    repo: UserRepository = Depends(get_user_repository),
) -> UserInfo:
    """Get a user the caller may access."""
    row = await repo.find_visible(Principal.from_user(current_user), user_id)
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessages.USER_NOT_FOUND,
        )
    return UserInfo(**dict(row))


@router.put("/users/{user_id}", response_model=SuccessResponse)
async def update_user(
    request: Request,
    user_id: int,
    body: UpdateUserRequest,
    current_user: dict = Depends(require_admin),
    repo: UserRepository = Depends(get_user_repository),
) -> SuccessResponse:
    """Update an accessible user's details."""
    principal = Principal.from_user(current_user)
    if not await repo.find_visible(principal, user_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessages.USER_NOT_FOUND,
        )
    await _validate_target_unit(repo, principal, body)
    await _validate_role(repo, principal, body.role_id)

    if body.unit_name is not None and not body.unit_name.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=ErrorMessages.UNIT_REQUIRED,
        )

    data = body.model_dump(exclude_none=True)
    try:
        info = await repo.update(user_id, data)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
    if info["changes"] == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessages.USER_NOT_FOUND,
        )
    audit_log(
        request,
        AuditActions.USER_UPDATE,
        AuditEntityTypes.USER,
        entity_id=user_id,
        metadata={"changes": list(data.keys())},
    )
    return SuccessResponse()


@router.delete("/users/{user_id}", response_model=SuccessResponse)
async def delete_user(
    request: Request,
    user_id: int,
    current_user: dict = Depends(require_admin),
    repo: UserRepository = Depends(get_user_repository),
) -> SuccessResponse:
    """Delete an accessible user."""
    principal = Principal.from_user(current_user)
    if not await repo.find_visible(principal, user_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessages.USER_NOT_FOUND,
        )
    try:
        info = await repo.delete(user_id)
    except IntegrityError as exc:
        # Story 108: defensive — any residual FK conflict → clear 409, not a 500.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=ErrorMessages.USER_DELETE_CONFLICT,
        ) from exc
    if info["changes"] == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessages.USER_NOT_FOUND,
        )
    audit_log(
        request,
        AuditActions.USER_DELETE,
        AuditEntityTypes.USER,
        entity_id=user_id,
    )
    return SuccessResponse()


@router.get("/users/{user_id}/delete-impact", response_model=UserDeleteImpact)
async def get_user_delete_impact(
    user_id: int,
    current_user: dict = Depends(require_admin),
    repo: UserRepository = Depends(get_user_repository),
) -> UserDeleteImpact:
    """Summarise a user's related data for a delete warning (story 108).

    Returns how many documents the user uploaded (deleted for clean data), how
    many personal conversations they have (cascade-deleted), and the names of
    units whose repository they own (the kho is kept — reassigned).
    """
    principal = Principal.from_user(current_user)
    if not await repo.find_visible(principal, user_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessages.USER_NOT_FOUND,
        )
    impact = await repo.delete_impact(user_id)
    return UserDeleteImpact(**impact)


@router.post("/users/{user_id}/force-logout")
async def force_logout(
    request: Request,
    user_id: int,
    current_user: dict = Depends(require_admin),
    repo: UserRepository = Depends(get_user_repository),
) -> dict[str, bool]:
    """Force log out an accessible user."""
    principal = Principal.from_user(current_user)
    if not await repo.find_visible(principal, user_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessages.USER_NOT_FOUND,
        )
    info = await repo.increment_token_version(user_id)
    if info["changes"] == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessages.USER_NOT_FOUND,
        )
    audit_log(
        request,
        AuditActions.USER_FORCE_LOGOUT,
        AuditEntityTypes.USER,
        entity_id=user_id,
    )
    return {"ok": True}


@router.patch("/users/{user_id}/lock", response_model=LockUserResponse)
async def lock_user(
    request: Request,
    user_id: int,
    body: LockUserRequest,
    current_user: dict = Depends(require_admin),
    repo: UserRepository = Depends(get_user_repository),
) -> LockUserResponse:
    """Lock/unlock an accessible user (admins cannot be locked)."""
    principal = Principal.from_user(current_user)
    target = await repo.find_visible(principal, user_id)
    if not target:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=ErrorMessages.USER_NOT_FOUND,
        )
    if target.get("is_admin") and body.lock:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=ErrorMessages.LOCK_ADMIN_DENIED,
        )

    await repo.set_lock_status(user_id, body.lock)
    if body.lock:
        await repo.increment_token_version(user_id)

    audit_log(
        request,
        AuditActions.USER_LOCK if body.lock else AuditActions.USER_UNLOCK,
        AuditEntityTypes.USER,
        entity_id=user_id,
    )
    return LockUserResponse(lock_status=body.lock)


@router.get("/units", response_model=UnitListResponse)
async def list_units(
    search: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=12, ge=1, le=100),
    # Story 70: the commander ("Chỉ huy") must list units to pick a repository
    # focus, so this read is gated on the units:read capability (admins pass via
    # the is_admin fallback). The unit WRITE routes below keep require_admin.
    current_user: dict = Depends(require_permission("units:read")),
    repo: UserRepository = Depends(get_user_repository),
) -> UnitListResponse:
    """List units (caller's subtree) with search, pagination and admin info."""
    result = await repo.list_units_paginated(
        Principal.from_user(current_user),
        search=search,
        page=page,
        page_size=page_size,
    )
    return UnitListResponse(**result)


@router.get(
    "/units/{unit_id}/admin-candidates",
    response_model=list[AdminCandidate],
)
async def list_admin_candidates(
    unit_id: int,
    current_user: dict = Depends(require_admin),
    repo: UserRepository = Depends(get_user_repository),
) -> list[AdminCandidate]:
    """List users eligible to administer the given unit."""
    try:
        rows = await repo.list_admin_candidates(
            Principal.from_user(current_user), unit_id
        )
    except LookupError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(e)
        )
    return [AdminCandidate(**r) for r in rows]


@router.post(
    "/units",
    response_model=UnitListItem,
    status_code=status.HTTP_201_CREATED,
)
async def create_unit(
    request: Request,
    body: CreateUnitRequest,
    current_user: dict = Depends(require_admin),
    repo: UserRepository = Depends(get_user_repository),
) -> UnitListItem:
    """Create a unit, optionally assigning or creating its administrator."""
    if not body.name.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=ErrorMessages.UNIT_NAME_REQUIRED,
        )
    try:
        unit = await repo.create_unit(
            Principal.from_user(current_user), body.model_dump()
        )
    except ValueError as e:
        raise HTTPException(
            status_code=_unit_value_error_status(str(e)), detail=str(e)
        )
    audit_log(
        request,
        AuditActions.UNIT_CREATE,
        AuditEntityTypes.UNIT,
        entity_id=unit["id"],
        metadata={"name": unit["name"]},
    )
    return UnitListItem(**unit)


@router.put("/units/{unit_id}", response_model=UnitListItem)
async def update_unit(
    request: Request,
    unit_id: int,
    body: UpdateUnitRequest,
    current_user: dict = Depends(require_admin),
    repo: UserRepository = Depends(get_user_repository),
) -> UnitListItem:
    """Update a unit's name and/or administrator."""
    try:
        unit = await repo.update_unit(
            Principal.from_user(current_user),
            unit_id,
            body.model_dump(exclude_none=True),
        )
    except LookupError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(e)
        )
    except ValueError as e:
        raise HTTPException(
            status_code=_unit_value_error_status(str(e)), detail=str(e)
        )
    audit_log(
        request,
        AuditActions.UNIT_UPDATE,
        AuditEntityTypes.UNIT,
        entity_id=unit_id,
        metadata={"changes": list(body.model_dump(exclude_none=True).keys())},
    )
    return UnitListItem(**unit)


@router.delete("/units/{unit_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_unit(
    request: Request,
    unit_id: int,
    transfer_to_unit_id: int | None = Query(None),
    current_user: dict = Depends(require_admin),
    repo: UserRepository = Depends(get_user_repository),
) -> Response:
    """Delete a unit, optionally transferring its data to another unit first."""
    try:
        await repo.delete_unit(
            Principal.from_user(current_user),
            unit_id,
            transfer_to_unit_id=transfer_to_unit_id,
        )
    except LookupError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(e)
        )
    except PermissionError as e:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=str(e)
        )
    except ValueError as e:
        # Transfer-target validation failures are bad requests; a non-empty
        # unit without a transfer target is a conflict.
        if str(e) == ErrorMessages.UNIT_NOT_EMPTY:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail=str(e)
            )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)
        )
    audit_log(
        request,
        AuditActions.UNIT_DELETE,
        AuditEntityTypes.UNIT,
        entity_id=unit_id,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── Document groups (nhóm tài liệu) ────────────────────────────────────


@router.get("/document-groups", response_model=DocGroupListResponse)
async def list_document_groups(
    unit_id: int | None = Query(default=None),
    search: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
    # Story 101: LISTing groups is a READ → gated on ``documents:read`` so the
    # VIEW-ONLY commander (which no longer holds ``docgroups:manage``) can still
    # see groups. create/update/delete below keep ``docgroups:manage`` (write).
    # Regular users hold no capability → still 403 (no widening).
    current_user: dict = Depends(require_permission("documents:read")),
    repo: UserRepository = Depends(get_user_repository),
) -> DocGroupListResponse:
    """List document groups (story 77 unit-scoped; story 80 all-units).

    Story 80: a super-admin/commander with NO ``unit_id`` lists EVERY unit's
    groups (each row carries ``unit_name``); with a ``unit_id`` they focus that
    unit. A unit admin always lists their own unit.
    """
    principal = Principal.from_user(current_user)
    is_super = (
        principal.unit_id is None or principal.unit_id == ROOT_UNIT_ID
    )
    all_units = is_super and unit_id is None
    target_unit_id = None if all_units else _resolve_group_unit(principal, unit_id)
    result = await repo.list_doc_groups_paginated(
        unit_id=target_unit_id,
        search=search,
        all_units=all_units,
        page=page,
        page_size=page_size,
    )
    return DocGroupListResponse(**result)


@router.post(
    "/document-groups",
    response_model=DocGroupItem,
    status_code=status.HTTP_201_CREATED,
)
async def create_document_group(
    request: Request,
    body: CreateDocGroupRequest,
    current_user: dict = Depends(require_permission("docgroups:manage")),
    repo: UserRepository = Depends(get_user_repository),
) -> DocGroupItem:
    """Create a document group owned by the caller's unit (story 77)."""
    if not body.name.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=ErrorMessages.DOC_GROUP_NAME_REQUIRED,
        )
    principal = Principal.from_user(current_user)
    target_unit_id = _resolve_group_unit(principal, body.unit_id)
    try:
        group = await repo.create_doc_group(body.name, unit_id=target_unit_id)
    except ValueError as e:
        raise HTTPException(
            status_code=_doc_group_value_error_status(str(e)), detail=str(e)
        )
    audit_log(
        request,
        AuditActions.DOCUMENT_GROUP_CREATE,
        AuditEntityTypes.DOCUMENT_GROUP,
        entity_id=group["id"],
        metadata={"name": group["name"]},
    )
    return DocGroupItem(**group)


@router.put("/document-groups/{group_id}", response_model=DocGroupItem)
async def update_document_group(
    request: Request,
    group_id: int,
    body: UpdateDocGroupRequest,
    current_user: dict = Depends(require_permission("docgroups:manage")),
    repo: UserRepository = Depends(get_user_repository),
) -> DocGroupItem:
    """Rename a document group (story 77 — scoped to the caller's unit)."""
    principal = Principal.from_user(current_user)
    try:
        group = await repo.update_doc_group(
            group_id,
            body.name,
            restrict_unit_id=_group_unit_restriction(principal),
        )
    except LookupError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(e)
        )
    except ValueError as e:
        raise HTTPException(
            status_code=_doc_group_value_error_status(str(e)), detail=str(e)
        )
    audit_log(
        request,
        AuditActions.DOCUMENT_GROUP_UPDATE,
        AuditEntityTypes.DOCUMENT_GROUP,
        entity_id=group_id,
        metadata={"name": group["name"]},
    )
    return DocGroupItem(**group)


@router.delete(
    "/document-groups/{group_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_document_group(
    request: Request,
    group_id: int,
    current_user: dict = Depends(require_permission("docgroups:manage")),
    repo: UserRepository = Depends(get_user_repository),
) -> Response:
    """Delete a document group (documents detached; scoped to caller's unit)."""
    principal = Principal.from_user(current_user)
    try:
        await repo.delete_doc_group(
            group_id, restrict_unit_id=_group_unit_restriction(principal)
        )
    except LookupError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(e)
        )
    audit_log(
        request,
        AuditActions.DOCUMENT_GROUP_DELETE,
        AuditEntityTypes.DOCUMENT_GROUP,
        entity_id=group_id,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/roles", response_model=list[RoleInfo])
async def list_roles(
    current_user: dict = Depends(require_admin),
    repo: UserRepository = Depends(get_user_repository),
) -> list[RoleInfo]:
    """List roles belonging to units in the caller's subtree."""
    rows = await repo.list_roles_visible(Principal.from_user(current_user))
    return [RoleInfo(**r) for r in rows]
