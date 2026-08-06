"""SQLAlchemy 2.0 async implementations of the repository contracts.

Every access-scoped query funnels through :func:`app.models.access.scope_condition`
so the unit-tree rule is enforced in one place.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

import bcrypt
from bson import ObjectId
from sqlalchemy import String, and_, cast, or_
from sqlalchemy import delete as sa_delete
from sqlalchemy import func, select, true, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.constants.errors import ErrorMessages
from app.constants.status import ProcessingStatus
from app.db import get_mongo_db
from app.models.access import (
    ROOT_UNIT_ID,
    Principal,
    accessible_unit_ids,
    scope_condition,
)
from app.models.orm import (
    Conversation,
    ConversationRepoDoc,
    Document,
    DocumentGroup,
    DocumentRead,
    InfoTable,
    Permission,
    Role,
    RolePermission,
    Unit,
    User,
)
from app.repositories.base import (
    ConversationRepository,
    DocumentRepository,
    InfoTableRepository,
    UserRepository,
)
from app.utils.helpers import utcnow

logger = logging.getLogger(__name__)

# Story 66: permission grants for the default per-unit roles, mirroring
# migrate_007.sql / seed.py. A unit created at runtime must give its admin/member
# roles a permission set consistent with the rest of the system — otherwise the
# new roles would be empty and the permission gates (require_permission) would
# deny them (forward-compat for the backfill that ran at migration time only).
_UNIT_ADMIN_GRANTS = [
    ("users:manage", "unit_subtree"),
    ("units:read", "unit_subtree"),
    ("roles:read", "unit_subtree"),
    ("documents:read", "unit_subtree"),
    ("documents:manage", "unit_subtree"),
    ("docgroups:manage", "unit_subtree"),
]
# Member holds NO capabilities — own-document access flows through
# scope_condition (is_admin-based), not the permission gates (story 66).
_UNIT_MEMBER_GRANTS: list[tuple[str, str]] = []

SALT_ROUNDS = 10

# Story 54: a far-past instant used when a user's read baseline is unexpectedly
# NULL, so the "created_at > baseline" filter treats everything as a candidate
# (fail-open to showing unread) rather than swallowing the comparison to NULL.
_READ_EPOCH = datetime(1970, 1, 1)

# Reserved name prefix for a unit's hidden "document repository" conversation.
# The repository (admin "Quản lý kho tài liệu") is keyed PER UNIT, not per admin,
# so a unit admin and a super-admin focusing that unit share one hidden
# conversation. This is the single source of truth for that name — both the
# upload path and the list path must agree on it, so it is NOT hardcoded inline.
REPOSITORY_CONV_NAME = "__document_repository__"


def repository_conversation_name(unit_id: int | None) -> str:
    """Return the reserved conversation name for a unit's document repository."""
    return f"{REPOSITORY_CONV_NAME}u{unit_id}"


def _hash_password(password: str | None) -> str | None:
    """Hash a plaintext password with bcrypt, leaving existing hashes intact."""
    if not password:
        return password
    if password.startswith(("$2a$", "$2b$", "$2y$")):
        return password
    return bcrypt.hashpw(
        password.encode(), bcrypt.gensalt(rounds=SALT_ROUNDS)
    ).decode()


def _pick_username_match(
    input_username: str | None, rows: list[dict]
) -> dict | None:
    """Story 83: choose the login user for a typed username.

    ``rows`` are the users whose username matches the (trimmed) input
    case-insensitively — the repository runs that single query. The rule:

    * an EXACT (case-sensitive) match always wins, so when both ``User1`` and
      ``user1`` exist each logs into its own account;
    * otherwise the SOLE case-insensitive match is returned (the common "wrong
      case / stray whitespace" situation);
    * an ambiguous set (≥2 case-variants, none exact) → ``None``, so login fails
      safely (401) instead of authenticating the wrong account.

    Pure (no DB) so the rule is unit-tested directly.
    """
    uname = (input_username or "").strip()
    if not uname or not rows:
        return None
    for row in rows:
        if row["username"] == uname:
            return row
    return rows[0] if len(rows) == 1 else None


def _is_one_admin_violation(exc: IntegrityError) -> bool:
    """True if ``exc`` is the one-admin-per-unit trigger firing.

    The ``trg_one_admin_per_unit`` trigger raises with SQLSTATE 23505, same as
    a real unique constraint, so it is distinguished by its message signature.
    """
    return "only one admin per unit" in str(exc.orig).lower()


def _is_username_taken_violation(exc: IntegrityError) -> bool:
    """True if ``exc`` is the unique-username constraint firing (story 85).

    A duplicate username raises ``UniqueViolationError`` on
    ``user_username_key``; without this, the user create/update paths let it
    bubble up as a raw 500 instead of a clean ``USERNAME_TAKEN`` (400).
    """
    return "user_username_key" in str(exc.orig).lower()


# ── User ──────────────────────────────────────────────────────────────────


class SqlAlchemyUserRepository(UserRepository):
    """User/unit/role access via SQLAlchemy."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    @staticmethod
    def _user_columns(include_password: bool = False):
        cols = [
            User.id,
            User.name,
            User.username,
            User.unit_id,
            Unit.name.label("unit_name"),
            User.role_id,
            Role.name.label("role_name"),
            func.coalesce(Role.is_admin, False).label("is_admin"),
            User.lock_status,
            User.created_at,
            User.token_version,
        ]
        if include_password:
            cols.insert(3, User.password)
        return cols

    def _base_user_select(self, include_password: bool = False):
        return (
            select(*self._user_columns(include_password))
            .select_from(User)
            .outerjoin(Unit, User.unit_id == Unit.id)
            .outerjoin(Role, User.role_id == Role.id)
        )

    async def find_by_username(self, username: str) -> dict | None:
        # Story 83: tolerant lookup so an account created with one casing/spacing
        # still logs in. Trim the input + match case-insensitively in ONE query,
        # then let ``_pick_username_match`` apply the exact-first / single-CI /
        # ambiguous→None rule. Password matching stays exact (in the route).
        uname = (username or "").strip()
        if not uname:
            return None
        stmt = self._base_user_select(include_password=True).where(
            func.lower(User.username) == uname.lower()
        )
        rows = [dict(r) for r in (await self._session.execute(stmt)).mappings().all()]
        return _pick_username_match(uname, rows)

    async def find_by_id(self, user_id: int) -> dict | None:
        stmt = self._base_user_select().where(User.id == user_id)
        row = (await self._session.execute(stmt)).mappings().first()
        return dict(row) if row else None

    async def list_visible(self, principal: Principal) -> list[dict]:
        # Story 88: newest-touched first so a just created/edited user surfaces
        # at the top (the FE paginates client-side, so a stable order also stops
        # rows from "jumping pages" after an edit). id DESC breaks ties.
        stmt = (
            self._base_user_select()
            .where(scope_condition(principal, User.id, User.unit_id))
            .order_by(User.updated_at.desc(), User.id.desc())
        )
        rows = (await self._session.execute(stmt)).mappings().all()
        return [dict(r) for r in rows]

    async def find_visible(
        self, principal: Principal, user_id: int
    ) -> dict | None:
        stmt = self._base_user_select().where(
            User.id == user_id,
            scope_condition(principal, User.id, User.unit_id),
        )
        row = (await self._session.execute(stmt)).mappings().first()
        return dict(row) if row else None

    async def find_role_by_id(self, role_id: int) -> dict | None:
        stmt = select(
            Role.id, Role.name, Role.unit_id, Role.is_admin
        ).where(Role.id == role_id)
        row = (await self._session.execute(stmt)).mappings().first()
        return dict(row) if row else None

    async def is_unit_accessible(
        self, principal: Principal, unit_id: int
    ) -> bool:
        if principal.is_admin and principal.unit_id is None:
            return True  # admin without a unit (legacy super-admin) manages all
        if principal.unit_id is None:
            return False
        member = select(Unit.id).where(
            Unit.id == unit_id,
            Unit.id.in_(accessible_unit_ids(principal.unit_id)),
        )
        return (await self._session.execute(member)).first() is not None

    # Unit / role bootstrap ------------------------------------------------
    async def _grant_role_permissions(
        self, role_id: int, grants: list[tuple[str, str]]
    ) -> None:
        """Grant each ``(action, scope)`` to ``role_id`` (idempotent, story 66).

        Resolves the permission by its action string. Skips grants already
        present so a re-created role keeps any tuned scope.
        """
        actions = [action for action, _ in grants]
        id_by_action = {
            action: pid
            for pid, action in (
                await self._session.execute(
                    select(Permission.id, Permission.action).where(
                        Permission.action.in_(actions)
                    )
                )
            )
        }
        existing = {
            pid
            for (pid,) in (
                await self._session.execute(
                    select(RolePermission.permission_id).where(
                        RolePermission.role_id == role_id
                    )
                )
            )
        }
        for action, scope in grants:
            pid = id_by_action.get(action)
            if pid is None or pid in existing:
                continue
            self._session.add(
                RolePermission(
                    role_id=role_id, permission_id=pid, scope=scope
                )
            )
        await self._session.flush()

    async def _ensure_unit_roles(self, unit_id: int) -> dict[str, int]:
        """Ensure a unit has its default admin/member roles; return their ids."""
        existing = {
            r.name: r.id
            for r in (
                await self._session.execute(
                    select(Role.id, Role.name).where(Role.unit_id == unit_id)
                )
            )
        }
        admin_id = existing.get("Quản trị viên")
        member_id = existing.get("Người dùng")
        if admin_id is None:
            admin = Role(name="Quản trị viên", unit_id=unit_id, is_admin=True)
            self._session.add(admin)
            await self._session.flush()
            admin_id = admin.id
            # Story 66: forward-compat — give the new role its permission set.
            await self._grant_role_permissions(admin_id, _UNIT_ADMIN_GRANTS)
        if member_id is None:
            member = Role(name="Người dùng", unit_id=unit_id, is_admin=False)
            self._session.add(member)
            await self._session.flush()
            member_id = member.id
            await self._grant_role_permissions(member_id, _UNIT_MEMBER_GRANTS)
        return {"admin": admin_id, "member": member_id}

    async def _resolve_unit(self, data: dict) -> int | None:
        """Resolve a unit id from ``unit_id`` or ``unit_name`` (find-or-create)."""
        if data.get("unit_id") is not None:
            return data["unit_id"]
        name = (data.get("unit_name") or "").strip()
        if not name:
            return None
        found = (
            await self._session.execute(select(Unit.id).where(Unit.name == name))
        ).scalar_one_or_none()
        if found is not None:
            return found
        unit = Unit(name=name, parent_id=1)  # default: under the root unit
        self._session.add(unit)
        await self._session.flush()
        await self._ensure_unit_roles(unit.id)
        return unit.id

    async def _resolve_role(
        self, unit_id: int | None, data: dict
    ) -> int | None:
        """Pick a role id: explicit role_id, else the unit's admin/member role."""
        if data.get("role_id") is not None:
            return data["role_id"]
        if "is_admin" not in data or unit_id is None:
            return None
        roles = await self._ensure_unit_roles(unit_id)
        return roles["admin"] if data.get("is_admin") else roles["member"]

    async def _assert_single_admin(
        self,
        unit_id: int | None,
        role_id: int | None,
        exclude_user_id: int | None = None,
    ) -> None:
        """Reject a 2nd admin user in a unit (mirrors the DB trigger).

        Raises ``ValueError`` when ``role_id`` is an admin role and another
        user (other than ``exclude_user_id``) in ``unit_id`` already holds an
        admin role. No-op for non-admin roles or when either id is missing.
        """
        if unit_id is None or role_id is None:
            return
        is_admin = (
            await self._session.execute(
                select(Role.is_admin).where(Role.id == role_id)
            )
        ).scalar_one_or_none()
        if not is_admin:
            return
        stmt = (
            select(User.id)
            .join(Role, Role.id == User.role_id)
            .where(User.unit_id == unit_id, Role.is_admin.is_(True))
        )
        if exclude_user_id is not None:
            stmt = stmt.where(User.id != exclude_user_id)
        existing = (
            await self._session.execute(stmt.limit(1))
        ).scalar_one_or_none()
        if existing is not None:
            raise ValueError(ErrorMessages.UNIT_HAS_ADMIN)

    async def _assert_role_in_unit(
        self, unit_id: int | None, role_id: int | None
    ) -> None:
        """Reject an explicitly-chosen role that is not scoped to ``unit_id``.

        Raises ``ValueError`` when ``role_id`` exists but its ``unit_id`` does
        not match the user's unit. No-op when either id is missing.
        """
        if unit_id is None or role_id is None:
            return
        role_unit = (
            await self._session.execute(
                select(Role.unit_id).where(Role.id == role_id)
            )
        ).scalar_one_or_none()
        if role_unit is None:
            raise ValueError(ErrorMessages.ROLE_NOT_FOUND)
        if role_unit != unit_id:
            raise ValueError(ErrorMessages.ROLE_UNIT_MISMATCH)

    async def list_units_visible(self, principal: Principal) -> list[dict]:
        stmt = select(Unit.id, Unit.name, Unit.parent_id)
        if not (principal.is_admin and principal.unit_id is None):
            # Root admin (no unit but admin) sees all; otherwise scope to subtree.
            if principal.unit_id is not None:
                stmt = stmt.where(Unit.id.in_(accessible_unit_ids(principal.unit_id)))
            else:
                stmt = stmt.where(Unit.id == -1)  # non-admin, no unit: none
        stmt = stmt.order_by(Unit.name)
        rows = (await self._session.execute(stmt)).mappings().all()
        return [dict(r) for r in rows]

    async def list_roles_visible(self, principal: Principal) -> list[dict]:
        stmt = select(Role.id, Role.name, Role.unit_id, Role.is_admin)
        if principal.unit_id is not None:
            stmt = stmt.where(
                Role.unit_id.in_(accessible_unit_ids(principal.unit_id))
            )
        elif not principal.is_admin:
            stmt = stmt.where(Role.id == -1)
        stmt = stmt.order_by(Role.unit_id, Role.name)
        rows = (await self._session.execute(stmt)).mappings().all()
        return [dict(r) for r in rows]

    # Unit management -----------------------------------------------------
    _USERNAME_RE = re.compile(r"^[a-z0-9]+$")

    def _unit_scope(self, principal: Principal):
        """WHERE clause restricting units to the principal's subtree."""
        if principal.is_admin and principal.unit_id is None:
            return true()
        if principal.unit_id is not None:
            return Unit.id.in_(accessible_unit_ids(principal.unit_id))
        return Unit.id == -1

    async def _unit_admin_row(self, unit_id: int) -> dict | None:
        """Return ``{username, full_name}`` of a unit's admin, or None."""
        stmt = (
            select(User.username, User.name.label("full_name"))
            .join(Role, Role.id == User.role_id)
            .where(User.unit_id == unit_id, Role.is_admin.is_(True))
            .limit(1)
        )
        row = (await self._session.execute(stmt)).mappings().first()
        return dict(row) if row else None

    async def _unit_item(self, unit: Unit) -> dict:
        """Serialize a unit with its admin display fields."""
        admin = await self._unit_admin_row(unit.id)
        return {
            "id": unit.id,
            "name": unit.name,
            "parent_id": unit.parent_id,
            "admin_username": admin["username"] if admin else None,
            "admin_full_name": admin["full_name"] if admin else None,
        }

    async def _require_accessible_unit(
        self, principal: Principal, unit_id: int
    ) -> Unit:
        """Load a unit if it exists and is accessible, else raise LookupError."""
        unit = (
            await self._session.execute(
                select(Unit).where(Unit.id == unit_id, self._unit_scope(principal))
            )
        ).scalars().first()
        if unit is None:
            raise LookupError(ErrorMessages.UNIT_NOT_FOUND)
        return unit

    async def _assign_admin(self, unit_id: int, admin: dict) -> None:
        """Set a unit's administrator (existing user or a new one).

        Demotes any current admin first (replacement semantics). ``admin`` is
        either ``{'user_id': int}`` or ``{'full_name','username','password'}``.
        """
        roles = await self._ensure_unit_roles(unit_id)
        admin_role_id, member_role_id = roles["admin"], roles["member"]

        # Demote the existing admin (if any) to keep one-admin-per-unit.
        await self._session.execute(
            update(User)
            .where(User.unit_id == unit_id, User.role_id == admin_role_id)
            .values(role_id=member_role_id)
        )

        if admin.get("user_id") is not None:
            await self._session.execute(
                update(User)
                .where(User.id == admin["user_id"])
                .values(unit_id=unit_id, role_id=admin_role_id)
            )
            return

        username = (admin.get("username") or "").strip()
        if not self._USERNAME_RE.match(username):
            raise ValueError(ErrorMessages.USERNAME_INVALID)
        taken = (
            await self._session.execute(
                select(User.id).where(User.username == username)
            )
        ).scalar_one_or_none()
        if taken is not None:
            raise ValueError(ErrorMessages.USERNAME_TAKEN)
        self._session.add(
            User(
                name=admin.get("full_name"),
                username=username,
                password=_hash_password(admin.get("password")),
                unit_id=unit_id,
                role_id=admin_role_id,
            )
        )
        await self._session.flush()

    async def list_units_paginated(
        self,
        principal: Principal,
        search: str | None = None,
        page: int = 1,
        page_size: int = 12,
    ) -> dict:
        page = max(page, 1)
        page_size = max(page_size, 1)
        where = self._unit_scope(principal)
        if search:
            where = where & Unit.name.ilike(f"%{search.strip()}%")

        total = (
            await self._session.execute(
                select(func.count()).select_from(Unit).where(where)
            )
        ).scalar_one()

        rows = (
            await self._session.execute(
                select(Unit)
                .where(where)
                .order_by(Unit.name)
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        ).scalars().all()
        items = [await self._unit_item(u) for u in rows]
        return {
            "items": items,
            "total": total,
            "page": page,
            "page_size": page_size,
        }

    async def list_admin_candidates(
        self, principal: Principal, unit_id: int
    ) -> list[dict]:
        await self._require_accessible_unit(principal, unit_id)
        rows = (
            await self._session.execute(
                select(
                    User.id,
                    User.username,
                    User.name.label("full_name"),
                )
                .where(User.unit_id.in_(accessible_unit_ids(unit_id)))
                .order_by(User.name)
            )
        ).mappings().all()
        return [dict(r) for r in rows]

    async def create_unit(self, principal: Principal, data: dict) -> dict:
        name = (data.get("name") or "").strip()
        if not name:
            raise ValueError(ErrorMessages.UNIT_NAME_REQUIRED)
        existing = (
            await self._session.execute(
                select(Unit.id).where(Unit.name == name)
            )
        ).scalar_one_or_none()
        if existing is not None:
            raise ValueError(ErrorMessages.UNIT_NAME_TAKEN)

        parent_id = data.get("parent_id") or 1
        unit = Unit(name=name, parent_id=parent_id)
        self._session.add(unit)
        try:
            await self._session.flush()
            await self._ensure_unit_roles(unit.id)
            if data.get("admin"):
                await self._assign_admin(unit.id, data["admin"])
            await self._session.commit()
        except IntegrityError as exc:
            await self._session.rollback()
            if _is_one_admin_violation(exc):
                raise ValueError(ErrorMessages.UNIT_HAS_ADMIN) from exc
            raise ValueError(ErrorMessages.UNIT_NAME_TAKEN) from exc
        except ValueError:
            await self._session.rollback()
            raise
        return await self._unit_item(unit)

    async def update_unit(
        self, principal: Principal, unit_id: int, data: dict
    ) -> dict:
        unit = await self._require_accessible_unit(principal, unit_id)

        if data.get("name") is not None:
            name = data["name"].strip()
            if not name:
                raise ValueError(ErrorMessages.UNIT_NAME_REQUIRED)
            clash = (
                await self._session.execute(
                    select(Unit.id).where(
                        Unit.name == name, Unit.id != unit_id
                    )
                )
            ).scalar_one_or_none()
            if clash is not None:
                raise ValueError(ErrorMessages.UNIT_NAME_TAKEN)
            unit.name = name

        try:
            if data.get("admin"):
                await self._assign_admin(unit_id, data["admin"])
            await self._session.commit()
        except IntegrityError as exc:
            await self._session.rollback()
            if _is_one_admin_violation(exc):
                raise ValueError(ErrorMessages.UNIT_HAS_ADMIN) from exc
            raise ValueError(ErrorMessages.UNIT_NAME_TAKEN) from exc
        except ValueError:
            await self._session.rollback()
            raise
        await self._session.refresh(unit)
        return await self._unit_item(unit)

    async def delete_unit(
        self,
        principal: Principal,
        unit_id: int,
        transfer_to_unit_id: int | None = None,
    ) -> None:
        await self._require_accessible_unit(principal, unit_id)

        if transfer_to_unit_id is not None:
            await self._transfer_unit_data(
                principal, unit_id, transfer_to_unit_id
            )
            await self._session.execute(
                sa_delete(Unit).where(Unit.id == unit_id)
            )
            await self._session.commit()
            return

        user_count = (
            await self._session.execute(
                select(func.count())
                .select_from(User)
                .where(User.unit_id == unit_id)
            )
        ).scalar_one()
        child_count = (
            await self._session.execute(
                select(func.count())
                .select_from(Unit)
                .where(Unit.parent_id == unit_id)
            )
        ).scalar_one()
        if user_count or child_count:
            raise ValueError(ErrorMessages.UNIT_NOT_EMPTY)
        await self._session.execute(sa_delete(Unit).where(Unit.id == unit_id))
        await self._session.commit()

    async def _transfer_unit_data(
        self, principal: Principal, source_id: int, target_id: int
    ) -> None:
        """Reassign a unit's users, child units and repository documents.

        Moves everything from ``source_id`` onto ``target_id`` so the source can
        be deleted without cascading data loss. Does not commit — the caller
        wraps this and the unit deletion in one transaction.
        """
        if target_id == source_id:
            raise ValueError(ErrorMessages.UNIT_TRANSFER_SAME)

        # Target must exist and be within the caller's tree (same rule as the
        # source). ``_require_accessible_unit`` raises LookupError otherwise; a
        # within-scope check distinguishes "not found" from "forbidden".
        target_exists = (
            await self._session.execute(
                select(Unit.id).where(Unit.id == target_id)
            )
        ).scalar_one_or_none()
        if target_exists is None:
            raise LookupError(ErrorMessages.UNIT_NOT_FOUND)
        accessible = (
            await self._session.execute(
                select(Unit.id).where(
                    Unit.id == target_id, self._unit_scope(principal)
                )
            )
        ).scalar_one_or_none()
        if accessible is None:
            raise PermissionError(ErrorMessages.FORBIDDEN)

        # The target must not be inside the subtree being deleted, or the
        # transferred data would be deleted along with it.
        descendant = (
            await self._session.execute(
                select(Unit.id).where(
                    Unit.id == target_id,
                    Unit.id.in_(accessible_unit_ids(source_id)),
                )
            )
        ).scalar_one_or_none()
        if descendant is not None:
            raise ValueError(ErrorMessages.UNIT_TRANSFER_DESCENDANT)

        # Move users onto the target unit's member role (the source unit's roles
        # are cascade-deleted with it, which would otherwise null the role_id).
        target_member_role = (
            await self._ensure_unit_roles(target_id)
        )["member"]
        await self._session.execute(
            update(User)
            .where(User.unit_id == source_id)
            .values(unit_id=target_id, role_id=target_member_role)
        )

        # Re-parent direct child units onto the target.
        await self._session.execute(
            update(Unit)
            .where(Unit.parent_id == source_id)
            .values(parent_id=target_id)
        )

        # Move repository documents to the target unit's hidden conversation.
        source_conv = (
            await self._session.execute(
                select(Conversation.id).where(
                    Conversation.name
                    == repository_conversation_name(source_id)
                )
            )
        ).scalar_one_or_none()
        if source_conv is not None:
            target_conv = await self._find_or_create_repo_conversation(
                principal, target_id
            )
            await self._session.execute(
                update(Document)
                .where(Document.conversation_id == source_conv)
                .values(conversation_id=target_conv)
            )

    async def _find_or_create_repo_conversation(
        self, principal: Principal, unit_id: int
    ) -> int:
        """Find-or-create a unit's hidden document-repository conversation.

        Mirrors the conversation repository's per-unit keying (see
        ``repository_conversation_name``) so transferred documents land in the
        target unit's repository.
        """
        conv_name = repository_conversation_name(unit_id)
        existing = (
            await self._session.execute(
                select(Conversation.id).where(Conversation.name == conv_name)
            )
        ).scalar_one_or_none()
        if existing is not None:
            return existing
        conv = Conversation(name=conv_name, user_id=principal.id)
        self._session.add(conv)
        await self._session.flush()
        return conv.id

    # ── Document groups ─────────────────────────────────────────────────

    async def list_doc_groups_paginated(
        self,
        unit_id: int | None,
        search: str | None = None,
        all_units: bool = False,
        page: int = 1,
        page_size: int = 10,
    ) -> dict:
        page = max(page, 1)
        page_size = max(page_size, 1)
        # Story 77: groups are unit-scoped. Story 80: all_units (super-admin/
        # commander, no focus) lists EVERY unit's groups. The route only sets
        # all_units for an is-super caller, so a unit admin can't list across units.
        if all_units:
            where = true()
        else:
            where = DocumentGroup.unit_id == unit_id
        if search:
            where = and_(where, DocumentGroup.name.ilike(f"%{search.strip()}%"))

        total = (
            await self._session.execute(
                select(func.count()).select_from(DocumentGroup).where(where)
            )
        ).scalar_one()

        # Story 80: join Unit for the "Đơn vị" column name (group has unit_id).
        rows = (
            await self._session.execute(
                select(DocumentGroup, Unit.name.label("unit_name"))
                .outerjoin(Unit, Unit.id == DocumentGroup.unit_id)
                .where(where)
                .order_by(DocumentGroup.name)
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        ).all()
        items = [
            {
                "id": row[0].id,
                "name": row[0].name,
                "unit_id": row[0].unit_id,
                "unit_name": row[1],
            }
            for row in rows
        ]
        return {
            "items": items,
            "total": total,
            "page": page,
            "page_size": page_size,
        }

    async def create_doc_group(self, name: str, unit_id: int) -> dict:
        name = (name or "").strip()
        if not name:
            raise ValueError(ErrorMessages.DOC_GROUP_NAME_REQUIRED)
        # Story 77: the name is unique only within the unit (composite key), so
        # two units may both create the same group name.
        group = DocumentGroup(name=name, unit_id=unit_id)
        self._session.add(group)
        try:
            await self._session.flush()
            await self._session.commit()
        except IntegrityError as exc:
            await self._session.rollback()
            raise ValueError(ErrorMessages.DOC_GROUP_NAME_TAKEN) from exc
        return {"id": group.id, "name": group.name, "unit_id": group.unit_id}

    async def update_doc_group(
        self, group_id: int, name: str, restrict_unit_id: int | None = None
    ) -> dict:
        group = (
            await self._session.execute(
                select(DocumentGroup).where(DocumentGroup.id == group_id)
            )
        ).scalar_one_or_none()
        # Story 77: a unit admin may only touch their own unit's groups; a
        # foreign group is treated as missing (no info leak).
        if group is None or (
            restrict_unit_id is not None and group.unit_id != restrict_unit_id
        ):
            raise LookupError(ErrorMessages.DOC_GROUP_NOT_FOUND)

        name = (name or "").strip()
        if not name:
            raise ValueError(ErrorMessages.DOC_GROUP_NAME_REQUIRED)
        group.name = name
        try:
            await self._session.commit()
        except IntegrityError as exc:
            await self._session.rollback()
            raise ValueError(ErrorMessages.DOC_GROUP_NAME_TAKEN) from exc
        await self._session.refresh(group)
        return {"id": group.id, "name": group.name, "unit_id": group.unit_id}

    async def delete_doc_group(
        self, group_id: int, restrict_unit_id: int | None = None
    ) -> None:
        group = (
            await self._session.execute(
                select(DocumentGroup.id, DocumentGroup.unit_id).where(
                    DocumentGroup.id == group_id
                )
            )
        ).first()
        if group is None or (
            restrict_unit_id is not None and group.unit_id != restrict_unit_id
        ):
            raise LookupError(ErrorMessages.DOC_GROUP_NOT_FOUND)
        # Documents keep their rows; their group_id is set NULL by the FK.
        await self._session.execute(
            sa_delete(DocumentGroup).where(DocumentGroup.id == group_id)
        )
        await self._session.commit()

    async def create(self, data: dict) -> dict:
        unit_id = await self._resolve_unit(data)
        if unit_id is None:
            raise ValueError(ErrorMessages.UNIT_REQUIRED)
        role_id = await self._resolve_role(unit_id, data) or 2
        if data.get("role_id") is not None:
            await self._assert_role_in_unit(unit_id, role_id)
        await self._assert_single_admin(unit_id, role_id)
        user = User(
            name=data.get("name"),
            username=data.get("username"),
            password=_hash_password(data.get("password")),
            unit_id=unit_id,
            role_id=role_id,
        )
        self._session.add(user)
        try:
            await self._session.flush()
            await self._session.commit()
        except IntegrityError as exc:
            await self._session.rollback()
            if _is_one_admin_violation(exc):
                raise ValueError(ErrorMessages.UNIT_HAS_ADMIN) from exc
            if _is_username_taken_violation(exc):
                raise ValueError(ErrorMessages.USERNAME_TAKEN) from exc
            raise
        return {"id": user.id, "changes": 1}

    async def update(self, user_id: int, data: dict) -> dict:
        values: dict[str, Any] = {}
        if "name" in data:
            values["name"] = data["name"]
        if "username" in data:
            values["username"] = data["username"]
        if data.get("password"):
            values["password"] = _hash_password(data["password"])

        # Resolve unit (id or name) and role (explicit, or admin/member by flag).
        unit_id: int | None = None
        if "unit_id" in data or "unit_name" in data:
            unit_id = await self._resolve_unit(data)
            if unit_id is None:
                raise ValueError(ErrorMessages.UNIT_REQUIRED)
            values["unit_id"] = unit_id
        role_id = await self._resolve_role(
            unit_id if unit_id is not None else data.get("unit_id"), data
        )
        if role_id is not None:
            values["role_id"] = role_id

        if not values:
            return {"changes": 0}

        # Story 88: touch updated_at so an edited user bubbles to the top of the
        # management list (ORDER BY updated_at DESC). Only the user-edit path
        # bumps it — lock/force-logout/token bumps are not "edits".
        values["updated_at"] = func.now()

        # When the unit or role changes, enforce one-admin-per-unit against the
        # user's effective post-update unit/role (filling gaps from the current
        # row) before writing.
        if "unit_id" in values or "role_id" in values:
            current = (
                await self._session.execute(
                    select(User.unit_id, User.role_id).where(User.id == user_id)
                )
            ).first()
            eff_unit = values.get("unit_id", current.unit_id if current else None)
            eff_role = values.get("role_id", current.role_id if current else None)
            # A role chosen this request must belong to the user's (effective)
            # unit; an unchanged role kept across a unit move is left as-is.
            if "role_id" in values:
                await self._assert_role_in_unit(eff_unit, values["role_id"])
            await self._assert_single_admin(eff_unit, eff_role, user_id)

        try:
            result = await self._session.execute(
                update(User).where(User.id == user_id).values(**values)
            )
            await self._session.commit()
        except IntegrityError as exc:
            await self._session.rollback()
            if _is_one_admin_violation(exc):
                raise ValueError(ErrorMessages.UNIT_HAS_ADMIN) from exc
            if _is_username_taken_violation(exc):
                raise ValueError(ErrorMessages.USERNAME_TAKEN) from exc
            raise
        return {"changes": result.rowcount or 0}

    # Story 108: the fallback owner that inherits a deleted user's UNIT repository
    # conversations, so the shared kho — and other users' documents in it —
    # survives. The root super-admin (id 1, seeded) always exists.
    _REPO_FALLBACK_OWNER_ID = 1

    async def delete(self, user_id: int) -> dict:
        # Story 108: delete a user WITHOUT (a) a FK 500 from documents they
        # uploaded (``document.user_id`` NO ACTION), or (b) silently wiping a
        # unit's repository if they happen to own its hidden conversation
        # (``conversation.user_id`` CASCADE). In ONE transaction, BEFORE deleting
        # the user:
        #   1. reassign the UNIT-repository conversations they own → a surviving
        #      admin, so the container (and OTHER users' documents in it) is kept;
        #   2. delete the documents THIS user uploaded (clean data + clears the
        #      NO ACTION FK that caused the 500);
        #   3. delete the user → their PERSONAL conversations + read-marks cascade.
        try:
            reassign_to = self._REPO_FALLBACK_OWNER_ID
            if reassign_to != user_id:
                await self._session.execute(
                    update(Conversation)
                    .where(
                        Conversation.user_id == user_id,
                        Conversation.name.like(f"{REPOSITORY_CONV_NAME}u%"),
                    )
                    .values(user_id=reassign_to)
                )
            await self._session.execute(
                sa_delete(Document).where(Document.user_id == user_id)
            )
            result = await self._session.execute(
                sa_delete(User).where(User.id == user_id)
            )
            await self._session.commit()
        except IntegrityError:
            await self._session.rollback()
            raise
        return {"changes": result.rowcount or 0}

    async def delete_impact(self, user_id: int) -> dict:
        # Story 108: summarise what deleting this user affects, for a warning.
        repo_like = f"{REPOSITORY_CONV_NAME}u%"
        documents = (
            await self._session.execute(
                select(func.count())
                .select_from(Document)
                .where(Document.user_id == user_id)
            )
        ).scalar_one()
        conversations = (
            await self._session.execute(
                select(func.count())
                .select_from(Conversation)
                .where(
                    Conversation.user_id == user_id,
                    ~Conversation.name.like(repo_like),
                )
            )
        ).scalar_one()
        repo_names = (
            await self._session.execute(
                select(Conversation.name).where(
                    Conversation.user_id == user_id,
                    Conversation.name.like(repo_like),
                )
            )
        ).scalars().all()
        prefix = f"{REPOSITORY_CONV_NAME}u"
        unit_ids = [
            int(n[len(prefix):])
            for n in repo_names
            if n[len(prefix):].isdigit()
        ]
        owns_repo_units: list[str] = []
        if unit_ids:
            owns_repo_units = list(
                (
                    await self._session.execute(
                        select(Unit.name).where(Unit.id.in_(unit_ids))
                    )
                )
                .scalars()
                .all()
            )
        return {
            "documents": documents,
            "conversations": conversations,
            "owns_repo_units": owns_repo_units,
        }

    async def increment_token_version(self, user_id: int) -> dict:
        result = await self._session.execute(
            update(User)
            .where(User.id == user_id)
            .values(token_version=func.coalesce(User.token_version, 0) + 1)
        )
        await self._session.commit()
        return {"changes": result.rowcount or 0}

    async def set_lock_status(self, user_id: int, lock: bool) -> dict:
        result = await self._session.execute(
            update(User).where(User.id == user_id).values(lock_status=lock)
        )
        await self._session.commit()
        return {"changes": result.rowcount or 0}


# ── Conversation ────────────────────────────────────────────────────────────


class SqlAlchemyConversationRepository(ConversationRepository):
    """Conversation access via SQLAlchemy (PostgreSQL) + Motor (MongoDB)."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # MongoDB helpers ------------------------------------------------------
    @staticmethod
    async def _create_mongo_doc(conversation_id: int, user_id: int) -> str:
        db = get_mongo_db()
        now = datetime.now(timezone.utc)
        result = await db.conversation_data.insert_one(
            {
                "conversation_id": conversation_id,
                "user_id": user_id,
                "messages": [],
                "created_at": now,
                "updated_at": now,
            }
        )
        return str(result.inserted_id)

    @staticmethod
    async def _read_mongo(mongo_key: str | None) -> dict:
        if not mongo_key:
            return {"messages": []}
        db = get_mongo_db()
        doc = await db.conversation_data.find_one(
            {"_id": ObjectId(mongo_key)},
            {
                "_id": 0,
                "conversation_id": 0,
                "user_id": 0,
                "created_at": 0,
                "updated_at": 0,
            },
        )
        return doc or {"messages": []}

    @staticmethod
    async def _write_mongo(mongo_key: str, data: dict) -> None:
        db = get_mongo_db()
        await db.conversation_data.update_one(
            {"_id": ObjectId(mongo_key)},
            {"$set": {**data, "updated_at": datetime.now(timezone.utc)}},
        )

    @staticmethod
    async def _delete_mongo(mongo_key: str | None) -> None:
        if not mongo_key:
            return
        db = get_mongo_db()
        await db.conversation_data.delete_one({"_id": ObjectId(mongo_key)})

    # Scoped lookup --------------------------------------------------------
    def _accessible_stmt(self, principal: Principal):
        owner = aliased(User)
        return (
            select(Conversation)
            .join(owner, Conversation.user_id == owner.id)
            .where(
                scope_condition(principal, Conversation.user_id, owner.unit_id)
            )
        )

    async def _get_if_visible(
        self, principal: Principal, conv_id: int
    ) -> Conversation | None:
        stmt = self._accessible_stmt(principal).where(
            Conversation.id == conv_id
        )
        return (await self._session.execute(stmt)).scalars().first()

    # CRUD -----------------------------------------------------------------
    async def create(self, data: dict) -> dict:
        conv = Conversation(
            name=data["name"],
            user_id=data["user_id"],
            is_public=True,
            initial_summary=data.get("initial_summary", ""),
            date_updated=func.now(),
        )
        self._session.add(conv)
        await self._session.flush()
        conv_id = conv.id
        mongo_key = await self._create_mongo_doc(conv_id, data["user_id"])
        conv.mongo_key = mongo_key
        await self._session.commit()
        return {"id": conv_id, "changes": 1}

    # Backward-compatible alias; the canonical source is the module-level
    # ``REPOSITORY_CONV_NAME`` / ``repository_conversation_name`` helper.
    REPOSITORY_CONV_NAME = REPOSITORY_CONV_NAME

    async def find_repository_conversation(
        self, principal: Principal, *, target_unit_id: int | None = None
    ) -> int:
        """Find-or-create a UNIT's hidden document-repository conversation.

        Keyed by unit via the reserved name (see ``repository_conversation_name``)
        so the unit admin and a super-admin focusing that unit share one hidden
        conversation. ``user_id`` only satisfies the NOT NULL FK; the business
        key is the per-unit name.
        """
        unit_id = (
            target_unit_id
            if target_unit_id is not None
            else principal.unit_id
        )
        conv_name = repository_conversation_name(unit_id)
        existing = (
            await self._session.execute(
                select(Conversation.id).where(
                    Conversation.name == conv_name,
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            return existing
        created = await self.create(
            {"name": conv_name, "user_id": principal.id}
        )
        return created["id"]

    async def find_visible(
        self, principal: Principal, conv_id: int
    ) -> dict | None:
        conv = await self._get_if_visible(principal, conv_id)
        return _conversation_to_dict(conv) if conv else None

    async def list_visible(self, principal: Principal) -> list[dict]:
        owner = aliased(User)
        stmt = (
            select(Conversation.id, Conversation.name)
            .join(owner, Conversation.user_id == owner.id)
            .where(
                scope_condition(principal, Conversation.user_id, owner.unit_id)
            )
            .order_by(Conversation.date_created.desc())
        )
        rows = (await self._session.execute(stmt)).mappings().all()
        return [dict(r) for r in rows]

    async def delete(self, principal: Principal, conv_id: int) -> dict:
        conv = await self._get_if_visible(principal, conv_id)
        if conv is None:
            return {"changes": 0}
        mongo_key = conv.mongo_key
        await self._session.delete(conv)
        await self._session.commit()
        await self._delete_mongo(mongo_key)
        return {"changes": 1}

    async def update_name(
        self, principal: Principal, conv_id: int, name: str
    ) -> dict:
        conv = await self._get_if_visible(principal, conv_id)
        if conv is None:
            return {"changes": 0}
        conv.name = name
        conv.date_updated = utcnow()
        await self._session.commit()
        return {"changes": 1}

    async def update_field(
        self, principal: Principal, conv_id: int, field: str, value: Any
    ) -> dict:
        allowed = {"initial_summary", "last_synced_at"}
        if field not in allowed:
            raise ValueError(f"Invalid field: {field}")
        conv = await self._get_if_visible(principal, conv_id)
        if conv is None:
            return {"changes": 0}
        setattr(conv, field, value)
        conv.date_updated = utcnow()
        await self._session.commit()
        return {"changes": 1}

    async def get_data_source(
        self, principal: Principal, conv_id: int
    ) -> dict:
        conv = await self._get_if_visible(principal, conv_id)
        if conv is None or not conv.mongo_key:
            return {"messages": []}
        return await self._read_mongo(conv.mongo_key)

    async def set_compaction(
        self, principal: Principal, conv_id: int, summary: str, absorbed_upto: int
    ) -> None:
        conv = await self._get_if_visible(principal, conv_id)
        if conv is None or not conv.mongo_key:
            return
        db = get_mongo_db()
        await db.conversation_data.update_one(
            {"_id": ObjectId(conv.mongo_key)},
            {
                "$set": {
                    "summary": summary,
                    "absorbed_upto": absorbed_upto,
                    "updated_at": datetime.now(timezone.utc),
                }
            },
        )

    async def update_data_source(
        self, principal: Principal, conv_id: int, data: dict
    ) -> None:
        conv = await self._get_if_visible(principal, conv_id)
        if conv is None or not conv.mongo_key:
            return
        await self._write_mongo(conv.mongo_key, data)
        conv.date_updated = utcnow()
        await self._session.commit()


# ── Document ──────────────────────────────────────────────────────────────


class SqlAlchemyDocumentRepository(DocumentRepository):
    """Document access via SQLAlchemy."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create(self, data: dict) -> dict:
        doc = Document(
            id=UUID(data["id"]),
            conversation_id=data["conversation_id"],
            user_id=data["user_id"],
            group_id=data.get("group_id"),
            name=data["name"],
            doc_number=data.get("doc_number"),
            summary=data.get("summary"),
            sha256=data.get("sha256"),
            status=data.get("status", "PENDING"),
            chunk_count=data.get("chunk_count", 0),
            task_id=data.get("task_id"),
            message=data.get("message"),
        )
        self._session.add(doc)
        await self._session.commit()
        return data

    async def find_by_conversation(
        self, principal: Principal, conv_id: int
    ) -> list[dict]:
        owner = aliased(User)
        stmt = (
            select(Document)
            .join(owner, Document.user_id == owner.id)
            .where(
                Document.conversation_id == conv_id,
                scope_condition(principal, Document.user_id, owner.unit_id),
            )
            .order_by(Document.created_at.asc())
        )
        docs = (await self._session.execute(stmt)).scalars().all()
        return [_document_to_dict(d) for d in docs]

    async def _get_if_visible(
        self, principal: Principal, doc_id: str
    ) -> Document | None:
        owner = aliased(User)
        stmt = (
            select(Document)
            .join(owner, Document.user_id == owner.id)
            .where(
                Document.id == UUID(doc_id),
                # Owner-scoped (chat docs) OR the document lives in a repository
                # conversation the caller may access (story-62): repo docs are
                # unit-scoped, not owner-scoped (ADR-005), so a unit admin can
                # view/edit/approve a doc a super-admin uploaded into their unit.
                # Chat routes additionally check conversation membership, so this
                # never widens chat-doc access.
                scope_condition(principal, Document.user_id, owner.unit_id)
                | Document.conversation_id.in_(
                    self._repo_conv_ids_for(principal)
                ),
            )
        )
        return (await self._session.execute(stmt)).scalars().first()

    async def find_visible(
        self, principal: Principal, doc_id: str
    ) -> dict | None:
        doc = await self._get_if_visible(principal, doc_id)
        return _document_to_dict(doc) if doc else None

    async def find_by_sha256(
        self, principal: Principal, conv_id: int, sha256: str
    ) -> dict | None:
        if not sha256:
            return None
        owner = aliased(User)
        stmt = (
            select(Document)
            .join(owner, Document.user_id == owner.id)
            .where(
                Document.conversation_id == conv_id,
                Document.sha256 == sha256,
                Document.status != ProcessingStatus.ERROR,
                # Same visibility rule as ``_get_if_visible``: a repository
                # document belongs to the unit, not to whoever uploaded it, so a
                # unit admin must see the copy a super-admin put there — else they
                # would re-upload it and land back on ingestion's id.
                scope_condition(principal, Document.user_id, owner.unit_id)
                | Document.conversation_id.in_(
                    self._repo_conv_ids_for(principal)
                ),
            )
            .order_by(Document.created_at.asc())
        )
        doc = (await self._session.execute(stmt)).scalars().first()
        return _document_to_dict(doc) if doc else None

    async def update(
        self, principal: Principal, doc_id: str, patch: dict
    ) -> dict:
        doc = await self._get_if_visible(principal, doc_id)
        if doc is None:
            return {"changes": 0}
        updated = False
        for key in (
            "name",
            "doc_number",
            "summary",
            "status",
            "chunk_count",
            "task_id",
            "message",
            "group_id",
        ):
            if key in patch:
                setattr(doc, key, patch[key])
                updated = True
        if not updated:
            raise ValueError("No fields to update")
        await self._session.commit()
        return {"changes": 1}

    # Bug 1: unscoped status write for the Redis status listener. See the
    # contract in base.py — this is the ONLY repository method with no principal,
    # because its caller is a background subscriber relaying the ingest service's
    # own report rather than acting for a user. Kept as narrow as that justifies:
    # one column, and only when the row is still non-terminal.
    async def set_terminal_status(self, doc_id: str, status: str) -> bool:
        doc = (
            await self._session.execute(
                select(Document).where(Document.id == doc_id)
            )
        ).scalars().first()
        if doc is None:
            return False
        current = (doc.status or "").upper()
        if current in (
            ProcessingStatus.COMPLETED,
            ProcessingStatus.ERROR,
            ProcessingStatus.APPROVED,
        ):
            return False
        doc.status = status
        await self._session.commit()
        return True

    async def delete(self, principal: Principal, doc_id: str) -> dict:
        doc = await self._get_if_visible(principal, doc_id)
        if doc is None:
            return {"changes": 0}
        await self._session.delete(doc)
        await self._session.commit()
        return {"changes": 1}

    async def delete_by_conversation(self, conv_id: int) -> dict:
        result = await self._session.execute(
            sa_delete(Document).where(Document.conversation_id == conv_id)
        )
        await self._session.commit()
        return {"changes": result.rowcount or 0}

    async def list_documents_by_unit(
        self,
        principal: Principal,
        *,
        search: str | None = None,
        group_ids: list[int] | None = None,
        target_unit_id: int | None = None,
        all_units: bool = False,
        page: int = 1,
        page_size: int = 15,
        viewer_user_id: int | None = None,
    ) -> dict:
        page = max(page, 1)
        page_size = max(page_size, 1)
        # The repository is keyed PER UNIT by a hidden conversation, so the list
        # is scoped SOLELY by that conversation — NOT by the uploader's unit. A
        # super-admin uploads/manages documents on behalf of a focused unit, so
        # those rows are owned by the super-admin (root) yet belong to the unit's
        # repository; an owner-scope filter would hide them from the unit's own
        # admin (story-62 bug). Unit-level access is already enforced by the route
        # via ``_resolve_repo_unit`` (super-admin must focus a unit; a unit admin
        # may only target their own subtree → foreign unit 403), so scoping by the
        # repository conversation alone is both correct (ADR-005) and safe.
        # Story 78: in "all units" mode (super-admin/commander, no focus) the list
        # spans EVERY unit's repository conversation; otherwise it is scoped to the
        # single focused/own unit's hidden conversation (ADR-005). The route only
        # passes all_units=True for an is-super caller, so this can't leak across
        # units for a unit admin.
        if all_units:
            where = Document.conversation_id.in_(
                select(Conversation.id).where(
                    Conversation.name.like(f"{REPOSITORY_CONV_NAME}u%")
                )
            )
        else:
            effective_unit_id = (
                target_unit_id
                if target_unit_id is not None
                else principal.unit_id
            )
            repo_conv_id = (
                select(Conversation.id)
                .where(
                    Conversation.name
                    == repository_conversation_name(effective_unit_id)
                )
                .scalar_subquery()
            )
            where = Document.conversation_id == repo_conv_id
        if search:
            term = f"%{search.strip()}%"
            where = where & (
                Document.summary.ilike(term)
                | Document.doc_number.ilike(term)
                | Document.name.ilike(term)
            )
        if group_ids:
            where = where & Document.group_id.in_(group_ids)

        # Story 54: when a viewer is given, flag each row as unread (no read
        # marker for that viewer AND created after their baseline). Added as an
        # extra column so it costs one query, not N.
        select_cols: list = [
            Document,
            DocumentGroup.name.label("group_name"),
            # Story 78: the doc's repository conversation name encodes its unit →
            # used to fill unit_name for the "Đơn vị" column.
            Conversation.name.label("conv_name"),
        ]
        has_unread = viewer_user_id is not None
        if has_unread:
            read_exists = (
                select(1)
                .where(
                    DocumentRead.user_id == viewer_user_id,
                    DocumentRead.document_id == Document.id,
                )
                .exists()
            )
            baseline_sq = (
                select(User.repo_read_baseline)
                .where(User.id == viewer_user_id)
                .scalar_subquery()
            )
            select_cols.append(
                (
                    (~read_exists)
                    & (
                        Document.created_at
                        > func.coalesce(baseline_sq, _READ_EPOCH)
                    )
                ).label("is_unread")
            )

        base = (
            select(*select_cols)
            .outerjoin(DocumentGroup, Document.group_id == DocumentGroup.id)
            .join(Conversation, Conversation.id == Document.conversation_id)
            .where(where)
        )

        total = (
            await self._session.execute(
                select(func.count()).select_from(base.subquery())
            )
        ).scalar_one()

        rows = (
            await self._session.execute(
                base.order_by(Document.created_at.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        ).all()

        # Story 78: derive unit_name per row from its repository conversation name
        # (``__document_repository__u<unit_id>``) → batch-resolve the unit names.
        prefix = f"{REPOSITORY_CONV_NAME}u"

        def _uid_from_conv(name: str | None) -> int | None:
            if not name or not name.startswith(prefix):
                return None
            try:
                return int(name[len(prefix):])
            except ValueError:
                return None

        items = []
        row_unit_ids: list[int | None] = []
        for row in rows:
            doc = row[0]
            item = {
                "id": str(doc.id),
                "name": doc.name,
                "doc_number": doc.doc_number,
                "summary": doc.summary,
                "group_id": doc.group_id,
                "group_name": row[1],
                "created_at": doc.created_at,
                "status": doc.status,
                "unit_name": None,
            }
            if has_unread:
                item["is_unread"] = bool(row[3])
            items.append(item)
            row_unit_ids.append(_uid_from_conv(row[2]))

        unit_ids = {u for u in row_unit_ids if u is not None}
        if unit_ids:
            urows = (
                await self._session.execute(
                    select(Unit.id, Unit.name).where(Unit.id.in_(unit_ids))
                )
            ).all()
            unit_names = {u_id: u_name for u_id, u_name in urows}
            for item, uid in zip(items, row_unit_ids):
                item["unit_name"] = unit_names.get(uid)

        return {
            "items": items,
            "total": total,
            "page": page,
            "page_size": page_size,
        }

    def _repo_conv_ids_for(self, principal: Principal):
        """Select of repository conversation ids the principal may access (story 54).

        super-admin (admin, no unit) → every repository conversation; unit admin →
        repositories of their unit subtree; regular user → their OWN unit's
        repository only (matching ``list_unit_repository_for_user`` default).
        """
        if principal.is_admin and principal.unit_id is None:
            return select(Conversation.id).where(
                Conversation.name.like(f"{REPOSITORY_CONV_NAME}u%")
            )
        if principal.is_admin:
            unit_ids = accessible_unit_ids(principal.unit_id).subquery()
            repo_names = select(
                func.concat(
                    f"{REPOSITORY_CONV_NAME}u", cast(unit_ids.c.id, String)
                )
            )
            return select(Conversation.id).where(
                Conversation.name.in_(repo_names)
            )
        return select(Conversation.id).where(
            Conversation.name == repository_conversation_name(principal.unit_id)
        )

    async def count_unread_repo_documents(self, principal: Principal) -> int:
        repo_conv_ids = self._repo_conv_ids_for(principal)
        baseline_sq = (
            select(User.repo_read_baseline)
            .where(User.id == principal.id)
            .scalar_subquery()
        )
        read_exists = (
            select(1)
            .where(
                DocumentRead.user_id == principal.id,
                DocumentRead.document_id == Document.id,
            )
            .exists()
        )
        where = (
            Document.conversation_id.in_(repo_conv_ids)
            & (Document.created_at > func.coalesce(baseline_sq, _READ_EPOCH))
            & (~read_exists)
        )
        return (
            await self._session.execute(
                select(func.count()).select_from(
                    select(Document.id).where(where).subquery()
                )
            )
        ).scalar_one()

    async def count_repo_notifications(self, principal: Principal) -> int:
        """Story 115: role-aware unread count for the "Kho tài liệu" badge.

        * admin (super OR unit) → 0 — admins no longer receive the badge.
        * commander ("Chỉ huy": not an admin, holds ``documents:read``/
          ``documents:manage``, sits on the root unit) → ONLY documents whose
          UPLOADER is a super admin (``User.is_admin`` AND unit ∈ {None, ROOT}),
          across EVERY repository conversation, minus baseline/read.
        * everyone else (regular member) → delegates to
          ``count_unread_repo_documents`` (own unit repo, any uploader) — the
          pre-story-115 behavior, unchanged.

        Only this notification count is role-scoped; the per-row ``is_unread``
        highlight, mark-read and baseline compaction still use
        ``count_unread_repo_documents`` and are untouched.
        """
        if principal.is_admin:
            return 0
        is_commander = (
            principal.can("documents:read") or principal.can("documents:manage")
        ) and (
            principal.unit_id is None or principal.unit_id == ROOT_UNIT_ID
        )
        if not is_commander:
            return await self.count_unread_repo_documents(principal)

        # Commander: every repository conversation (matches their org-wide browse
        # scope), filtered to super-admin uploads only.
        repo_conv_ids = select(Conversation.id).where(
            Conversation.name.like(f"{REPOSITORY_CONV_NAME}u%")
        )
        baseline_sq = (
            select(User.repo_read_baseline)
            .where(User.id == principal.id)
            .scalar_subquery()
        )
        read_exists = (
            select(1)
            .where(
                DocumentRead.user_id == principal.id,
                DocumentRead.document_id == Document.id,
            )
            .exists()
        )
        # A "super admin" uploader = their role is an admin role AND they sit on
        # no unit / the root unit (``is_admin`` lives on Role via User.role_id).
        uploader = aliased(User)
        uploader_role = aliased(Role)
        super_uploader = (
            select(1)
            .where(
                uploader.id == Document.user_id,
                uploader.role_id == uploader_role.id,
                uploader_role.is_admin.is_(True),
                or_(
                    uploader.unit_id.is_(None),
                    uploader.unit_id == ROOT_UNIT_ID,
                ),
            )
            .exists()
        )
        where = (
            Document.conversation_id.in_(repo_conv_ids)
            & (Document.created_at > func.coalesce(baseline_sq, _READ_EPOCH))
            & (~read_exists)
            & super_uploader
        )
        return (
            await self._session.execute(
                select(func.count()).select_from(
                    select(Document.id).where(where).subquery()
                )
            )
        ).scalar_one()

    async def mark_repo_document_read(
        self, principal: Principal, document_id: str
    ) -> bool:
        try:
            doc_uuid = UUID(str(document_id))
        except (ValueError, AttributeError, TypeError):
            return False
        # Visibility: the document is in a repository conversation the principal
        # may access, OR it is linked into a conversation the principal owns
        # (a regular user opening a linked repo doc in chat).
        repo_conv_ids = self._repo_conv_ids_for(principal)
        owned_convs = select(Conversation.id).where(
            Conversation.user_id == principal.id
        )
        linked = (
            select(1)
            .where(
                ConversationRepoDoc.document_id == Document.id,
                ConversationRepoDoc.conversation_id.in_(owned_convs),
            )
            .exists()
        )
        visible = (
            await self._session.execute(
                select(Document.id).where(
                    Document.id == doc_uuid,
                    or_(
                        Document.conversation_id.in_(repo_conv_ids),
                        linked,
                    ),
                )
            )
        ).first()
        if not visible:
            return False
        await self._session.execute(
            pg_insert(DocumentRead)
            .values(user_id=principal.id, document_id=doc_uuid)
            .on_conflict_do_nothing(index_elements=["user_id", "document_id"])
        )
        await self._session.commit()
        # Opportunistic compaction (scale): once the user has caught up (no unread
        # left), advance the baseline and drop now-redundant read rows so the
        # table never grows unbounded as documents accumulate.
        if await self.count_unread_repo_documents(principal) == 0:
            await self._compact_reads(principal.id)
        return True

    async def _compact_reads(self, user_id: int) -> None:
        """Advance a user's baseline to now and drop their (now-redundant) read
        rows — every read doc is ``created_at <= baseline`` and thus implicitly
        read. Keeps ``document_read`` small at scale (story 54)."""
        await self._session.execute(
            update(User)
            .where(User.id == user_id)
            .values(repo_read_baseline=utcnow())
        )
        await self._session.execute(
            sa_delete(DocumentRead).where(DocumentRead.user_id == user_id)
        )
        await self._session.commit()

    async def list_unit_repository_for_user(
        self, principal: Principal, target_unit_id: int | None = None
    ) -> dict:
        # Scope to a unit's repository conversation. Default = the caller's OWN
        # unit (story 16). Story 35: a super-admin (resolved by the route) passes
        # ``target_unit_id`` to view another unit's repository; the route already
        # enforced that a non-super caller may only target their own unit.
        # Read-only: resolves the repository conversation by name; empty if none.
        effective_unit_id = (
            target_unit_id if target_unit_id is not None else principal.unit_id
        )
        repo_conv_id = (
            select(Conversation.id)
            .where(
                Conversation.name
                == repository_conversation_name(effective_unit_id)
            )
            .scalar_subquery()
        )
        # Story 82: per-doc read-state for the user's read-only repo view — unread
        # = no read row for this user AND newer than their baseline (mirrors
        # ``count_unread_repo_documents`` / ``list_documents_by_unit``, story 54).
        read_exists = (
            select(1)
            .where(
                DocumentRead.user_id == principal.id,
                DocumentRead.document_id == Document.id,
            )
            .exists()
        )
        baseline_sq = (
            select(User.repo_read_baseline)
            .where(User.id == principal.id)
            .scalar_subquery()
        )
        is_unread_col = (
            (~read_exists)
            & (Document.created_at > func.coalesce(baseline_sq, _READ_EPOCH))
        ).label("is_unread")
        rows = (
            await self._session.execute(
                select(
                    Document.id,
                    Document.name,
                    Document.group_id,
                    Document.created_at,
                    is_unread_col,
                    # Story 93: extra columns the redesigned user repo screen shows
                    # (Trích yếu / Số văn bản) + status for the status filter.
                    Document.summary,
                    Document.doc_number,
                    Document.status,
                )
                .where(Document.conversation_id == repo_conv_id)
                .order_by(Document.created_at.desc())
            )
        ).all()
        documents = [
            {
                "id": str(r.id),
                "name": r.name,
                "group_id": r.group_id,
                "created_at": r.created_at,
                "is_unread": bool(r.is_unread),
                "summary": r.summary,
                "doc_number": r.doc_number,
                "status": r.status,
            }
            for r in rows
        ]
        # Only return groups that actually contain at least one of these docs.
        group_ids = {d["group_id"] for d in documents if d["group_id"]}
        groups: list[dict] = []
        if group_ids:
            grows = (
                await self._session.execute(
                    select(DocumentGroup.id, DocumentGroup.name)
                    .where(DocumentGroup.id.in_(group_ids))
                    .order_by(DocumentGroup.name)
                )
            ).all()
            groups = [{"id": g_id, "name": g_name} for g_id, g_name in grows]
        return {"groups": groups, "documents": documents}

    async def link_repository_docs(
        self,
        principal: Principal,
        conv_id: int,
        document_ids: list[str],
        target_unit_id: int | None = None,
    ) -> list[str]:
        # Every id must belong to the repository of the EFFECTIVE unit. Default =
        # the caller's own unit (story 16). Story 35: a super-admin (resolved by
        # the route) links docs of a chosen unit via ``target_unit_id``; the route
        # already enforced that a non-super caller may only target their own unit.
        # Any id outside that unit's repository → PermissionError (403).
        effective_unit_id = (
            target_unit_id if target_unit_id is not None else principal.unit_id
        )
        repo_conv_id = (
            await self._session.execute(
                select(Conversation.id).where(
                    Conversation.name
                    == repository_conversation_name(effective_unit_id)
                )
            )
        ).scalar_one_or_none()

        valid_ids: list[UUID] = []
        if repo_conv_id is not None:
            valid_rows = (
                await self._session.execute(
                    select(Document.id).where(
                        Document.conversation_id == repo_conv_id,
                        Document.id.in_([UUID(d) for d in document_ids]),
                    )
                )
            ).scalars().all()
            valid_ids = list(valid_rows)

        if len(valid_ids) != len(set(document_ids)):
            raise PermissionError(ErrorMessages.FORBIDDEN)

        # Idempotent insert of (conv, doc) links.
        existing = set(
            (
                await self._session.execute(
                    select(ConversationRepoDoc.document_id).where(
                        ConversationRepoDoc.conversation_id == conv_id
                    )
                )
            ).scalars().all()
        )
        for doc_id in valid_ids:
            if doc_id not in existing:
                self._session.add(
                    ConversationRepoDoc(
                        conversation_id=conv_id, document_id=doc_id
                    )
                )
        await self._session.commit()
        return [str(d) for d in valid_ids]

    async def linked_repo_doc_ids(self, conv_id: int) -> list[str]:
        rows = (
            await self._session.execute(
                select(ConversationRepoDoc.document_id).where(
                    ConversationRepoDoc.conversation_id == conv_id
                )
            )
        ).scalars().all()
        return [str(d) for d in rows]

    async def find_linked_repo_documents(self, conv_id: int) -> list[dict]:
        # Story 33: LEFT JOIN the document group so each linked repo doc carries
        # its folder name (``group_name``). Additive — ``_document_to_dict``
        # (shared serializer) is left untouched; we graft the extra key here.
        # Story 35: also carry ``unit_name`` (the unit that owns the repository
        # this doc lives in) so a super-admin's chat left menu can show which
        # unit each linked doc belongs to. The repository conversation encodes
        # its unit in the name (``__document_repository__u<id>``); we join that
        # conversation, parse the unit id, then batch-resolve unit names.
        repo_conv = aliased(Conversation)
        stmt = (
            select(
                Document,
                DocumentGroup.name.label("group_name"),
                repo_conv.name.label("conv_name"),
            )
            .join(
                ConversationRepoDoc,
                ConversationRepoDoc.document_id == Document.id,
            )
            .outerjoin(DocumentGroup, Document.group_id == DocumentGroup.id)
            .join(repo_conv, repo_conv.id == Document.conversation_id)
            .where(ConversationRepoDoc.conversation_id == conv_id)
            .order_by(Document.created_at.asc())
        )
        rows = (await self._session.execute(stmt)).all()

        prefix = f"{REPOSITORY_CONV_NAME}u"

        def _unit_id_from_conv_name(name: str | None) -> int | None:
            if not name or not name.startswith(prefix):
                return None
            try:
                return int(name[len(prefix):])
            except ValueError:
                return None

        unit_ids = {
            uid
            for _, _, conv_name in rows
            if (uid := _unit_id_from_conv_name(conv_name)) is not None
        }
        unit_names: dict[int, str] = {}
        if unit_ids:
            urows = (
                await self._session.execute(
                    select(Unit.id, Unit.name).where(Unit.id.in_(unit_ids))
                )
            ).all()
            unit_names = {u_id: u_name for u_id, u_name in urows}

        return [
            {
                **_document_to_dict(doc),
                "group_name": group_name,
                "unit_name": unit_names.get(
                    _unit_id_from_conv_name(conv_name)
                ),
            }
            for doc, group_name, conv_name in rows
        ]

    async def unlink_repository_doc(
        self, conv_id: int, document_id: str
    ) -> dict:
        # Remove only the reference link; the repository document row stays.
        result = await self._session.execute(
            sa_delete(ConversationRepoDoc).where(
                ConversationRepoDoc.conversation_id == conv_id,
                ConversationRepoDoc.document_id == UUID(document_id),
            )
        )
        await self._session.commit()
        return {"changes": result.rowcount or 0}


# ── InfoTable ───────────────────────────────────────────────────────────────


class SqlAlchemyInfoTableRepository(InfoTableRepository):
    """info_table access via SQLAlchemy; scoped through the conversation owner."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create(self, data: dict) -> dict:
        info = InfoTable(
            conversation_id=data["conversation_id"],
            type=data["type"],
            name=data["name"],
            content=data.get("content"),
            selected=data.get("selected"),
            status=data.get("status", "PENDING"),
            task_id=data.get("task_id"),
        )
        self._session.add(info)
        await self._session.flush()
        await self._session.commit()
        return _info_table_to_dict(info)

    def _accessible_join(self, principal: Principal):
        owner = aliased(User)
        return (
            select(InfoTable)
            .join(Conversation, InfoTable.conversation_id == Conversation.id)
            .join(owner, Conversation.user_id == owner.id)
            .where(scope_condition(principal, Conversation.user_id, owner.unit_id))
        )

    async def find_by_conversation(
        self, principal: Principal, conv_id: int
    ) -> list[dict]:
        stmt = (
            self._accessible_join(principal)
            .where(InfoTable.conversation_id == conv_id)
            .order_by(InfoTable.date_created.desc())
        )
        rows = (await self._session.execute(stmt)).scalars().all()
        return [_info_table_to_dict(r) for r in rows]

    async def _get_if_visible(
        self, principal: Principal, info_id: str
    ) -> InfoTable | None:
        stmt = self._accessible_join(principal).where(
            InfoTable.id == UUID(info_id)
        )
        return (await self._session.execute(stmt)).scalars().first()

    async def find_visible(
        self, principal: Principal, info_id: str
    ) -> dict | None:
        info = await self._get_if_visible(principal, info_id)
        return _info_table_to_dict(info) if info else None

    async def update(
        self, principal: Principal, info_id: str, patch: dict
    ) -> dict:
        info = await self._get_if_visible(principal, info_id)
        if info is None:
            return {"changes": 0}
        updated = False
        for key in ("name", "content", "status", "task_id", "selected"):
            if key in patch:
                setattr(info, key, patch[key])
                updated = True
        if not updated:
            raise ValueError("No fields to update")
        info.date_updated = utcnow()
        await self._session.commit()
        return {"changes": 1}

    async def delete(self, principal: Principal, info_id: str) -> dict:
        info = await self._get_if_visible(principal, info_id)
        if info is None:
            return {}
        removed = _info_table_to_dict(info)
        await self._session.delete(info)
        await self._session.commit()
        return removed


# ── Row → dict serializers ───────────────────────────────────────────────


def _conversation_to_dict(conv: Conversation) -> dict:
    return {
        "id": conv.id,
        "name": conv.name,
        "user_id": conv.user_id,
        "is_public": conv.is_public,
        "mongo_key": conv.mongo_key,
        "date_created": conv.date_created,
        "date_updated": conv.date_updated,
        "initial_summary": conv.initial_summary,
        "last_synced_at": conv.last_synced_at,
    }


def _document_to_dict(doc: Document) -> dict:
    return {
        "id": str(doc.id),
        "conversation_id": doc.conversation_id,
        "user_id": doc.user_id,
        "group_id": doc.group_id,
        "name": doc.name,
        "doc_number": doc.doc_number,
        "summary": doc.summary,
        "sha256": doc.sha256,
        "status": doc.status,
        "chunk_count": doc.chunk_count,
        "task_id": doc.task_id,
        "message": doc.message,
        "created_at": doc.created_at,
    }


def _info_table_to_dict(info: InfoTable) -> dict:
    selected = info.selected
    if isinstance(selected, str):
        try:
            selected = json.loads(selected)
        except (json.JSONDecodeError, ValueError):
            pass
    return {
        "id": str(info.id),
        "conversation_id": info.conversation_id,
        "type": info.type,
        "name": info.name,
        "content": info.content,
        "selected": selected,
        "status": info.status,
        "task_id": info.task_id,
        "date_created": info.date_created,
        "date_updated": info.date_updated,
    }


__all__ = [
    "IntegrityError",
    "SqlAlchemyConversationRepository",
    "SqlAlchemyDocumentRepository",
    "SqlAlchemyInfoTableRepository",
    "SqlAlchemyUserRepository",
]
