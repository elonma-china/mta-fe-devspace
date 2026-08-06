"""JWT authentication middleware and helpers."""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from fastapi import Depends, HTTPException, Request, status

from app.config import settings
from app.constants.errors import ErrorMessages
from app.db import get_pool


def _parse_expires_in(value: str) -> timedelta:
    """Convert a human-friendly duration string (e.g. '24h', '30m') to timedelta."""
    match = re.fullmatch(r"(\d+)\s*([smhd])", value.strip().lower())
    if not match:
        return timedelta(hours=24)
    amount = int(match.group(1))
    unit = match.group(2)
    mapping = {"s": "seconds", "m": "minutes", "h": "hours", "d": "days"}
    return timedelta(**{mapping[unit]: amount})


def sign_token(payload: dict[str, Any]) -> str:
    """Create a signed JWT with expiration."""
    exp = datetime.now(timezone.utc) + _parse_expires_in(settings.jwt_expires_in)
    data = {**payload, "exp": exp}
    return jwt.encode(data, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def _decode_token(token: str) -> dict[str, Any]:
    """Decode and verify a JWT.  Raises HTTPException on failure."""
    try:
        return jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
            options={"require": ["exp"]},
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=ErrorMessages.TOKEN_EXPIRED,
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=ErrorMessages.TOKEN_INVALID,
        )


def _bearer_token(request: Request) -> str | None:
    """The token from ``Authorization: Bearer <t>``, or None if absent."""
    parts = request.headers.get("authorization", "").split(" ", 1)
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1]
    return None


async def get_current_user(request: Request) -> dict[str, Any]:
    """FastAPI dependency: extract and verify user from Bearer token.

    Also checks token_version against the database to support forced logout.
    Sets ``request.state.user`` for downstream use.
    """
    token = _bearer_token(request)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=ErrorMessages.TOKEN_MISSING,
        )
    return await _verified_user(request, token)


async def get_current_user_sse(request: Request) -> dict[str, Any]:
    """As :func:`get_current_user`, but the token may arrive as ``?token=``.

    ``EventSource`` cannot set request headers, which is why the query parameter
    is accepted at all. It is a different way to *carry* the token, not a weaker
    way to check it: the route this serves previously decoded the JWT inline and
    proxied on a signature alone, so a locked account or a token invalidated by a
    forced logout kept streaming.
    """
    token = _bearer_token(request) or request.query_params.get("token")
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=ErrorMessages.TOKEN_MISSING,
        )
    return await _verified_user(request, token)


async def _verified_user(request: Request, token: str) -> dict[str, Any]:
    """Decode ``token`` and check it against the database.

    Shared by both dependencies so there is exactly one place that decides a
    caller is who they claim to be — the duplication is what let the SSE route
    drift into checking less.
    """
    decoded = _decode_token(token)

    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            'SELECT u.token_version, u.lock_status, u.unit_id, '
            'COALESCE(r.is_admin, FALSE) AS is_admin, '
            # Story 66: the set of capability actions granted by the user's role,
            # resolved alongside is_admin so the per-action gates (require_
            # permission) work without a second round-trip.
            'COALESCE(ARRAY('
            '  SELECT p.action FROM role_permission rp '
            '  JOIN permission p ON p.id = rp.permission_id '
            '  WHERE rp.role_id = u.role_id'
            "), '{}') AS permissions "
            'FROM "user" u '
            'LEFT JOIN role r ON u.role_id = r.id '
            'WHERE u.id = $1',
            decoded.get("id"),
        )

    if row is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=ErrorMessages.USER_INVALID,
        )

    if row["lock_status"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=ErrorMessages.ACCOUNT_LOCKED,
        )

    if row["token_version"] != decoded.get("token_version", 0):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=ErrorMessages.TOKEN_REVOKED,
        )

    user_info = {
        "id": decoded["id"],
        "username": decoded.get("username"),
        "unit_id": row["unit_id"],
        "is_admin": bool(row["is_admin"]),
        # Story 66: capability action strings from the role's permission set.
        "permissions": list(row["permissions"] or ()),
    }
    request.state.user = user_info
    return user_info


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    """FastAPI dependency: ensures the current user is an admin."""
    if not user.get("is_admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=ErrorMessages.ADMIN_ONLY,
        )
    return user


def require_permission(action: str):
    """FastAPI dependency factory: ensure the caller holds ``action`` (story 66).

    Used for the repository-document gates so the "Chỉ huy" role (``is_admin``
    false) can pass while a regular user cannot. Administration gates keep using
    :func:`require_admin`. Returns 403 when the capability is absent.

    Args:
        action: The required capability action string (e.g. ``documents:manage``).

    Returns:
        A FastAPI dependency callable resolving the user dict on success.
    """

    async def _dep(user: dict = Depends(get_current_user)) -> dict:
        # Pass when the caller holds the capability OR is an admin. Admins keep
        # their permission set backfilled to all/most actions, so the is_admin
        # fallback is consistent with reality and keeps the gate from depending
        # on a complete backfill; the commander role (is_admin FALSE) passes via
        # the explicit capability, while a regular user (is_admin FALSE, no such
        # capability) is still rejected. No longer is_admin ALONE (story 66).
        if action in (user.get("permissions") or ()) or user.get("is_admin"):
            return user
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=ErrorMessages.ADMIN_ONLY,
        )

    # Marker so an authz-coverage test can recognise a guarded route.
    _dep.__authz__ = action
    return _dep
