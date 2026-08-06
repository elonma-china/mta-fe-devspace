"""Auth routes — login and /me."""

from __future__ import annotations

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.constants.audit import AuditActions, AuditEntityTypes
from app.constants.errors import ErrorMessages
from app.middlewares.auth import get_current_user, sign_token
from app.models.schemas import LoginRequest, LoginResponse, MeResponse, UserInfo
from app.repositories.base import UserRepository
from app.repositories.factory import get_user_repository
from app.utils.audit import audit_log
from app.utils.helpers import extract_client

router = APIRouter()


@router.post("/login", response_model=LoginResponse)
async def login(
    request: Request,
    body: LoginRequest,
    repo: UserRepository = Depends(get_user_repository),
):
    client = extract_client(request)
    request.state.client_info = client

    if not body.username or not body.password:
        audit_log(
            request,
            AuditActions.AUTH_LOGIN_FAILED,
            AuditEntityTypes.USER,
            metadata={"username": body.username, "reason": "missing_credentials"},
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=ErrorMessages.CREDENTIALS_MISSING,
        )

    user = await repo.find_by_username(body.username)
    is_matched = False
    if user:
        is_matched = bcrypt.checkpw(
            body.password.encode(), user["password"].encode()
        )

    if not user or not is_matched:
        audit_log(
            request,
            AuditActions.AUTH_LOGIN_FAILED,
            AuditEntityTypes.USER,
            entity_id=user["id"] if user else None,
            metadata={"username": body.username, "reason": "invalid_credentials"},
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=ErrorMessages.CREDENTIALS_INVALID,
        )

    if user["lock_status"]:
        audit_log(
            request,
            AuditActions.AUTH_LOGIN_FAILED,
            AuditEntityTypes.USER,
            entity_id=user["id"],
            metadata={"username": body.username, "reason": "locked"},
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=ErrorMessages.ACCOUNT_LOCKED,
        )

    token = sign_token(
        {
            "id": user["id"],
            "username": user["username"],
            "is_admin": bool(user["is_admin"]),
            "token_version": user.get("token_version", 0),
        }
    )

    audit_log(
        request,
        AuditActions.AUTH_LOGIN_SUCCESS,
        AuditEntityTypes.USER,
        entity_id=user["id"],
        metadata={"username": body.username},
    )

    user_dict = dict(user)
    user_dict.pop("password", None)
    return LoginResponse(token=token, user=UserInfo(**user_dict))


@router.get("/me", response_model=MeResponse)
async def get_me(
    user: dict = Depends(get_current_user),
    repo: UserRepository = Depends(get_user_repository),
):
    # Resolve the unit name so the admin "kho tài liệu" header ("- đơn vị <tên>")
    # survives a page refresh. ``find_by_id`` already joins the unit, so this
    # reuses the existing query rather than adding a new one to every request.
    full = await repo.find_by_id(user["id"])
    return MeResponse(
        id=user["id"],
        username=user["username"],
        is_admin=user["is_admin"],
        unit_id=(full or {}).get("unit_id"),
        unit_name=(full or {}).get("unit_name"),
        # Story 66: capabilities resolved by get_current_user from the role's
        # permission set; the FE gates the kho/document domain on these.
        permissions=user.get("permissions", []),
    )
