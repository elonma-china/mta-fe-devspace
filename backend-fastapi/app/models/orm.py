"""SQLAlchemy 2.0 declarative ORM models mirroring the PostgreSQL schema.

The schema is a hybrid unit-tree + flat per-unit RBAC model:

* :class:`Unit` is a tree (adjacency list via ``parent_id``).
* :class:`Role` is flat and scoped to a unit; capability is marked by
  ``is_admin``. Each unit owns its own roles; the root unit's admin is the
  structural "super-admin".
* Access scoping is computed from the unit tree (see ``app/models/access.py``).
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    Integer,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    mapped_column,
    relationship,
)


class Base(DeclarativeBase):
    """Declarative base for all ORM models."""


class Unit(Base):
    """An organizational unit. Units form a tree via ``parent_id``."""

    __tablename__ = "unit"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("unit.id", ondelete="SET NULL"), nullable=True, index=True
    )

    parent: Mapped[Unit | None] = relationship(
        "Unit", remote_side=[id], back_populates="children"
    )
    children: Mapped[list[Unit]] = relationship(
        "Unit", back_populates="parent"
    )
    roles: Mapped[list[Role]] = relationship(
        "Role", back_populates="unit", cascade="all, delete-orphan"
    )


class Role(Base):
    """A flat role scoped to a unit. ``is_admin`` grants admin capability."""

    __tablename__ = "role"
    __table_args__ = (
        UniqueConstraint("unit_id", "name", name="role_unit_id_name_key"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    unit_id: Mapped[int] = mapped_column(
        ForeignKey("unit.id", ondelete="CASCADE"), nullable=False, index=True
    )
    is_admin: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )

    unit: Mapped[Unit] = relationship("Unit", back_populates="roles")
    permissions: Mapped[list[RolePermission]] = relationship(
        "RolePermission", cascade="all, delete-orphan"
    )


class Permission(Base):
    """A capability the system can grant, identified by a stable action string.

    Actions are coarse verbs over a domain, e.g. ``documents:read``,
    ``documents:manage``, ``users:manage`` (story 66). The catalog is seeded by
    ``init.sql`` / ``migrate_007.sql``.
    """

    __tablename__ = "permission"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    action: Mapped[str] = mapped_column(Text, unique=True, nullable=False)


class RolePermission(Base):
    """Grant of a :class:`Permission` to a :class:`Role` at a given scope.

    ``scope`` (``own`` | ``unit_subtree`` | ``all``) describes how far the grant
    reaches; it is anchored on the user's unit at query time. Layered alongside
    ``role.is_admin`` for backward compatibility (story 66).
    """

    __tablename__ = "role_permission"
    __table_args__ = (
        CheckConstraint(
            "scope IN ('own', 'unit_subtree', 'all')",
            name="role_permission_scope_check",
        ),
    )

    role_id: Mapped[int] = mapped_column(
        ForeignKey("role.id", ondelete="CASCADE"), primary_key=True
    )
    permission_id: Mapped[int] = mapped_column(
        ForeignKey("permission.id", ondelete="CASCADE"), primary_key=True
    )
    scope: Mapped[str] = mapped_column(
        Text, nullable=False, default="own", server_default="own"
    )

    permission: Mapped[Permission] = relationship("Permission")


class User(Base):
    """An application user belonging to one unit, holding one role."""

    __tablename__ = "user"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    username: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    password: Mapped[str] = mapped_column(Text, nullable=False)
    unit_id: Mapped[int] = mapped_column(
        ForeignKey("unit.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role_id: Mapped[int] = mapped_column(
        ForeignKey("role.id", ondelete="SET NULL"),
        nullable=False,
        default=2,
        server_default="2",
    )
    created_at: Mapped[datetime] = mapped_column(
        nullable=False, server_default=func.now()
    )
    # Story 88: last-touched marker. Defaults to creation time; the user-update
    # path bumps it to now() so a just created/edited user sorts to the top of
    # the management list (ORDER BY updated_at DESC). Migration migrate_009.
    updated_at: Mapped[datetime] = mapped_column(
        nullable=False, server_default=func.now()
    )
    token_version: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    lock_status: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    # Story 54: per-user baseline for repository "unread" tracking. Only documents
    # created AFTER this instant count as unread, so existing documents do not
    # flood the badge on launch. Defaults to the user's creation time; advanced
    # (and read rows below it pruned) once the user has caught up.
    repo_read_baseline: Mapped[datetime] = mapped_column(
        nullable=False, server_default=func.now()
    )

    unit: Mapped[Unit] = relationship("Unit")
    role: Mapped[Role] = relationship("Role")


class Conversation(Base):
    """A conversation owned by a user; chat messages live in MongoDB."""

    __tablename__ = "conversation"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=False,
        index=True,
    )
    is_public: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )
    mongo_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    date_created: Mapped[datetime] = mapped_column(
        nullable=False, server_default=func.now()
    )
    date_updated: Mapped[datetime] = mapped_column(
        nullable=False, server_default=func.now()
    )
    initial_summary: Mapped[str] = mapped_column(
        Text, nullable=False, default="", server_default="''"
    )
    last_synced_at: Mapped[datetime | None] = mapped_column(nullable=True)

    owner: Mapped[User] = relationship("User")


class DocumentGroup(Base):
    """A "topic" label for grouping documents, scoped to a unit (story 77).

    Each unit owns its own groups; the name is unique only WITHIN a unit, so two
    units may both have a "Hành chính" group. ``unit_id`` is nullable only to
    survive the expand step of the migration (existing rows backfilled to ROOT).
    """

    __tablename__ = "document_group"
    __table_args__ = (
        UniqueConstraint("name", "unit_id", name="document_group_name_unit_key"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    unit_id: Mapped[int | None] = mapped_column(
        ForeignKey("unit.id", ondelete="CASCADE"), nullable=True
    )


class Document(Base):
    """A document attached to a conversation, owned by its uploader."""

    __tablename__ = "document"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("conversation.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("user.id"), nullable=False, index=True
    )
    group_id: Mapped[int | None] = mapped_column(
        ForeignKey("document_group.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    doc_number: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    sha256: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        Text, nullable=False, default="PENDING", server_default="PENDING"
    )
    chunk_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    task_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        nullable=False, server_default=func.now()
    )

    owner: Mapped[User] = relationship("User")
    group: Mapped[DocumentGroup | None] = relationship("DocumentGroup")


class ConversationRepoDoc(Base):
    """Reference link: a repository document usable in a conversation (story 16).

    The chat AI retrieval is keyed by ``document_id`` and there is no upstream
    copy/attach primitive, so a user "uses" a repository document by REFERENCE.
    This association lets the chat-query gate accept that document id for the
    conversation without duplicating the document row.
    """

    __tablename__ = "conversation_repo_doc"

    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("conversation.id", ondelete="CASCADE"),
        primary_key=True,
    )
    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("document.id", ondelete="CASCADE"),
        primary_key=True,
    )


class DocumentRead(Base):
    """Per-user "has read" marker for a repository document (story 54).

    Sparse: a row exists only when ``user_id`` has opened ``document_id``. UNREAD
    is the set difference — a repository document with no row here for that user
    (and created after the user's ``repo_read_baseline``). Read rows for documents
    older than the baseline are redundant and may be pruned.
    """

    __tablename__ = "document_read"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"), primary_key=True
    )
    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("document.id", ondelete="CASCADE"),
        primary_key=True,
    )
    read_at: Mapped[datetime] = mapped_column(
        nullable=False, server_default=func.now()
    )


class InfoTable(Base):
    """A summary/mindmap/report/directive_review derived from a
    conversation's documents."""

    __tablename__ = "info_table"
    __table_args__ = (
        CheckConstraint(
            "type IN ('summary','mindmap','report','directive_review')",
            name="info_table_type_check",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("conversation.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    type: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    selected: Mapped[dict | list | None] = mapped_column(JSONB, nullable=True)
    status: Mapped[str] = mapped_column(
        Text, nullable=False, default="PENDING", server_default="PENDING"
    )
    task_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    date_created: Mapped[datetime] = mapped_column(
        nullable=False, server_default=func.now()
    )
    date_updated: Mapped[datetime | None] = mapped_column(nullable=True)

    conversation: Mapped[Conversation] = relationship("Conversation")


class AuditLog(Base):
    """An append-only audit trail of user actions."""

    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    timestamp: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    user_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    action: Mapped[str] = mapped_column(Text, nullable=False)
    entity_type: Mapped[str] = mapped_column(Text, nullable=False)
    entity_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    conversation_id: Mapped[int | None] = mapped_column(
        Integer, nullable=True, index=True
    )
    ip_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    audit_metadata: Mapped[dict | None] = mapped_column(
        "metadata", JSONB, nullable=True
    )
