"""Repository contracts (abstract base classes).

High-level code depends on these ABCs, never on the concrete SQLAlchemy
implementations. Use :mod:`app.repositories.factory` to obtain instances.

All access-scoped methods take a :class:`~app.models.access.Principal` and
apply the unit-tree scoping rule (see :mod:`app.models.access`).
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from app.models.access import Principal


class UserRepository(ABC):
    """Contract for user / unit / role data access."""

    @abstractmethod
    async def find_by_username(self, username: str) -> dict | None:
        """Return the user with joined unit/role fields, or None. Unscoped."""

    @abstractmethod
    async def find_by_id(self, user_id: int) -> dict | None:
        """Return the user with joined unit/role fields, or None. Unscoped."""

    @abstractmethod
    async def list_visible(self, principal: Principal) -> list[dict]:
        """List users the principal may see (self + descendant-unit users)."""

    @abstractmethod
    async def find_visible(
        self, principal: Principal, user_id: int
    ) -> dict | None:
        """Return a single user if the principal may see it, else None."""

    @abstractmethod
    async def find_role_by_id(self, role_id: int) -> dict | None:
        """Return a role (id, name, unit_id, is_admin), or None."""

    @abstractmethod
    async def is_unit_accessible(
        self, principal: Principal, unit_id: int
    ) -> bool:
        """Whether ``unit_id`` is within the principal's manageable subtree."""

    @abstractmethod
    async def list_units_visible(self, principal: Principal) -> list[dict]:
        """List units within the principal's accessible subtree."""

    @abstractmethod
    async def list_roles_visible(self, principal: Principal) -> list[dict]:
        """List roles belonging to units in the principal's subtree."""

    @abstractmethod
    async def list_units_paginated(
        self,
        principal: Principal,
        search: str | None = None,
        page: int = 1,
        page_size: int = 12,
    ) -> dict:
        """List units (scoped) with search, pagination and admin join.

        Returns ``{'items': [...], 'total': int, 'page': int,
        'page_size': int}`` where each item carries ``admin_username`` and
        ``admin_full_name`` (None when the unit has no admin).
        """

    @abstractmethod
    async def list_admin_candidates(
        self, principal: Principal, unit_id: int
    ) -> list[dict]:
        """List users (in the unit's subtree) eligible to be its admin.

        Raises ``LookupError`` if the unit does not exist or is not
        accessible.
        """

    @abstractmethod
    async def create_unit(self, principal: Principal, data: dict) -> dict:
        """Create a unit, optionally assigning/creating its admin.

        Returns the created unit row (with admin fields). Raises
        ``ValueError`` on a duplicate name, invalid/taken admin username, or
        a one-admin-per-unit violation.
        """

    @abstractmethod
    async def update_unit(
        self, principal: Principal, unit_id: int, data: dict
    ) -> dict:
        """Update a unit's name and/or admin.

        Returns the updated unit row. Raises ``LookupError`` if the unit is
        missing/inaccessible, ``ValueError`` on a duplicate name or admin
        conflict.
        """

    @abstractmethod
    async def delete_unit(
        self,
        principal: Principal,
        unit_id: int,
        transfer_to_unit_id: int | None = None,
    ) -> None:
        """Delete a unit, optionally transferring its data first.

        When ``transfer_to_unit_id`` is ``None`` (default), only an empty unit
        is deleted: raises ``ValueError`` (``UNIT_NOT_EMPTY``) if it still has
        users or child units.

        When ``transfer_to_unit_id`` is given, the unit's users, child units and
        repository documents are reassigned to that target before the unit is
        deleted (one transaction). Raises ``LookupError`` if the source or
        target is missing, ``PermissionError`` if the target is outside the
        caller's tree, ``ValueError`` if the target is the source itself
        (``UNIT_TRANSFER_SAME``) or a descendant of it
        (``UNIT_TRANSFER_DESCENDANT``).
        """

    # ── Document groups (flat global label — no unit scoping) ───────────

    @abstractmethod
    async def list_doc_groups_paginated(
        self,
        unit_id: int | None,
        search: str | None = None,
        all_units: bool = False,
        page: int = 1,
        page_size: int = 10,
    ) -> dict:
        """List document groups with search and pagination (story 77/80).

        Per-unit (``unit_id``) by default; ``all_units=True`` (super-admin/
        commander, no focus — story 80) lists EVERY unit's groups and each item
        carries ``unit_name``. Returns ``{'items': [{'id', 'name', 'unit_id',
        'unit_name'}], 'total': int, 'page': int, 'page_size': int}``.
        """

    @abstractmethod
    async def create_doc_group(self, name: str, unit_id: int) -> dict:
        """Create a document group owned by ``unit_id`` (story 77).

        Returns ``{'id', 'name', 'unit_id'}``. Raises ``ValueError`` on a blank
        or duplicate name WITHIN the unit (two units may share a name).
        """

    @abstractmethod
    async def update_doc_group(
        self, group_id: int, name: str, restrict_unit_id: int | None = None
    ) -> dict:
        """Rename a document group (story 77).

        When ``restrict_unit_id`` is set (unit admin), the group must belong to
        that unit or it is treated as missing. Returns ``{'id', 'name',
        'unit_id'}``. Raises ``LookupError`` if missing/foreign, ``ValueError``
        on a blank or duplicate name within the unit.
        """

    @abstractmethod
    async def delete_doc_group(
        self, group_id: int, restrict_unit_id: int | None = None
    ) -> None:
        """Delete a document group (story 77).

        When ``restrict_unit_id`` is set (unit admin), the group must belong to
        that unit or it is treated as missing. Documents tied to it are detached
        (FK ``ON DELETE SET NULL``), not deleted. Raises ``LookupError`` if
        missing/foreign.
        """

    @abstractmethod
    async def create(self, data: dict) -> dict:
        """Create a user. Returns ``{'id': int, 'changes': 1}``."""

    @abstractmethod
    async def update(self, user_id: int, data: dict) -> dict:
        """Update a user. Returns ``{'changes': int}``."""

    @abstractmethod
    async def delete(self, user_id: int) -> dict:
        """Delete a user. Returns ``{'changes': int}``.

        Story 108: also reassigns the UNIT-repository conversations the user owns
        to a surviving admin (so the shared kho is not cascade-wiped) and deletes
        the documents the user uploaded, atomically, before deleting the user.
        """

    @abstractmethod
    async def delete_impact(self, user_id: int) -> dict:
        """Summarise a user's related data for a delete warning (story 108).

        Returns ``{'documents': int, 'conversations': int,
        'owns_repo_units': list[str]}``.
        """

    @abstractmethod
    async def increment_token_version(self, user_id: int) -> dict:
        """Bump the user's token_version (forced logout)."""

    @abstractmethod
    async def set_lock_status(self, user_id: int, lock: bool) -> dict:
        """Lock or unlock a user account."""


class ConversationRepository(ABC):
    """Contract for conversation data access (PostgreSQL + MongoDB)."""

    @abstractmethod
    async def create(self, data: dict) -> dict:
        """Create a conversation row and its MongoDB data document."""

    @abstractmethod
    async def find_visible(
        self, principal: Principal, conv_id: int
    ) -> dict | None:
        """Return a conversation if the principal may access it, else None."""

    @abstractmethod
    async def list_visible(self, principal: Principal) -> list[dict]:
        """List ``{id, name}`` for conversations the principal may access."""

    @abstractmethod
    async def find_repository_conversation(
        self, principal: Principal, *, target_unit_id: int | None = None
    ) -> int:
        """Return the id of a unit's hidden "document repository" conversation.

        Documents uploaded to the admin "kho tài liệu" screen need a conversation
        to attach to (the ``document.conversation_id`` FK is NOT NULL). The
        repository is keyed by UNIT (reserved name per unit), so a unit admin and
        a super-admin focusing that unit share the same hidden conversation,
        created on first use. ``target_unit_id`` selects the unit (defaults to the
        principal's own unit).
        """

    @abstractmethod
    async def delete(self, principal: Principal, conv_id: int) -> dict:
        """Delete a conversation (and its Mongo doc) if accessible."""

    @abstractmethod
    async def update_name(
        self, principal: Principal, conv_id: int, name: str
    ) -> dict:
        """Rename a conversation if accessible."""

    @abstractmethod
    async def update_field(
        self, principal: Principal, conv_id: int, field: str, value: Any
    ) -> dict:
        """Update a single allowed field if accessible."""

    @abstractmethod
    async def get_data_source(
        self, principal: Principal, conv_id: int
    ) -> dict:
        """Fetch the MongoDB data_source for an accessible conversation."""

    @abstractmethod
    async def set_compaction(
        self, principal: Principal, conv_id: int, summary: str, absorbed_upto: int
    ) -> None:
        """Write only the compaction fields, never the message list.

        Deliberately separate from `update_data_source`, which replaces the whole
        document: compaction reads the conversation, spends seconds in an LLM
        call, then writes back — and a turn appended in that window would be
        erased by a whole-document write. A narrow `$set` cannot lose one.
        """
        ...

    @abstractmethod
    async def update_data_source(
        self, principal: Principal, conv_id: int, data: dict
    ) -> None:
        """Write the MongoDB data_source for an accessible conversation."""


class DocumentRepository(ABC):
    """Contract for document data access."""

    @abstractmethod
    async def create(self, data: dict) -> dict:
        """Insert a document row. ``data['id']`` is a UUID string."""

    @abstractmethod
    async def find_by_conversation(
        self, principal: Principal, conv_id: int
    ) -> list[dict]:
        """List documents of a conversation the principal may access."""

    @abstractmethod
    async def find_visible(
        self, principal: Principal, doc_id: str
    ) -> dict | None:
        """Return a document if the principal may access it, else None."""

    @abstractmethod
    async def find_by_sha256(
        self, principal: Principal, conv_id: int, sha256: str
    ) -> dict | None:
        """Return this conversation's document with identical content, else None.

        The re-upload check the upload routes make before contacting ingestion.
        Scoped to a single conversation because that is the space a document
        belongs to: the same file in another conversation is a document of its
        own. ERROR documents are not returned — re-uploading a file that failed
        is how a user retries it, so it must produce a fresh document rather than
        hand back the broken one.
        """

    @abstractmethod
    async def update(
        self, principal: Principal, doc_id: str, patch: dict
    ) -> dict:
        """Update allowed fields on an accessible document."""

    @abstractmethod
    async def delete(self, principal: Principal, doc_id: str) -> dict:
        """Delete an accessible document."""

    @abstractmethod
    async def delete_by_conversation(self, conv_id: int) -> dict:
        """Delete all documents of a conversation (internal cleanup)."""

    @abstractmethod
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
        """List a unit's repository documents (unit-scoped, paginated).

        Story 78: ``all_units=True`` (super-admin/commander, no focus) lists EVERY
        unit's repository documents and each item carries ``unit_name``. The route
        only sets it for an is-super caller, so a unit admin cannot list across
        units.

        ``target_unit_id`` selects which unit's repository to list (defaults to
        the principal's own unit). Scoped by the unit's repository CONVERSATION,
        NOT the uploader's unit (ADR-005, story-62) — so documents a super-admin
        uploaded on behalf of the unit stay visible to the unit's own admin. The
        route enforces that ``principal`` may access ``target_unit_id``.

        Story 54: ``viewer_user_id`` (optional) makes each item carry an
        ``is_unread`` flag (the user has no read row AND the doc is newer than
        their baseline). ``None`` leaves ``is_unread`` unset (backward compatible).

        Returns ``{'items': [...], 'total': int, 'page': int,
        'page_size': int}`` where each item carries ``doc_number``, ``summary``,
        ``group_id``, ``group_name``, ``created_at``, ``status`` and (when a
        viewer is given) ``is_unread``.
        """

    @abstractmethod
    async def set_terminal_status(self, doc_id: str, status: str) -> bool:
        """Write a document's TERMINAL processing status — no principal.

        Bug 1 (2026-07-30): the ingest service publishes "completed"/"failed" on
        Redis the moment it finishes, but until now the only thing that ever
        persisted that outcome was a browser hitting
        ``/admin/documents/{id}/status``. A document nobody was watching stayed
        ``PROCESSING`` in Postgres indefinitely — not merely a wrong badge: the
        AI retrieves ``COMPLETED`` documents only, so it was silently absent from
        every answer. :mod:`app.services.status_listener` subscribes to that same
        channel and calls this.

        Deliberately UNSCOPED: the caller is a background subscriber acting on the
        ingest service's own report, not on behalf of any user, so there is no
        principal to scope by. It is therefore narrow on purpose — it writes the
        ``status`` column and nothing else.

        Only advances a NON-terminal row: ``COMPLETED``/``ERROR``/``APPROVED``
        are left alone (``APPROVED`` is admin-set and must never be reverted by
        ingest), which also makes a re-delivered message a no-op.

        Returns ``True`` when a row was written, ``False`` when the document is
        missing or already terminal.
        """

    @abstractmethod
    async def count_unread_repo_documents(self, principal: Principal) -> int:
        """Count repository documents the principal has NOT read (story 54).

        Scoped to every repository the principal may access (a unit admin → their
        unit subtree's repositories; a unit-less/root admin → all). Only documents
        created after the principal's ``repo_read_baseline`` and without a read row
        are counted. Used for the "Kho tài liệu" header badge.
        """

    @abstractmethod
    async def count_repo_notifications(self, principal: Principal) -> int:
        """Role-aware unread count for the "Kho tài liệu" badge (story 115).

        Unlike :meth:`count_unread_repo_documents` (which every role shares and
        which still backs the per-row ``is_unread`` highlight + mark-read), this
        is scoped to WHO should be notified:

        * admin (super OR unit) → 0 (admins no longer get the badge);
        * commander ("Chỉ huy": not an admin, documents-capable, on the root
          unit) → only documents uploaded by a super admin, across every
          repository;
        * regular member → same as :meth:`count_unread_repo_documents`.
        """

    @abstractmethod
    async def mark_repo_document_read(
        self, principal: Principal, document_id: str
    ) -> bool:
        """Mark ``document_id`` as read by ``principal`` (story 54). Idempotent.

        Visibility-gated: returns ``False`` (caller → 404) when the principal may
        not view the document (not an admin-visible doc and not in the principal's
        own unit repository). Otherwise upserts the read marker and returns
        ``True``. Also opportunistically prunes redundant read rows once the user
        has caught up (advances the baseline), keeping the table small at scale.
        """

    @abstractmethod
    async def list_unit_repository_for_user(
        self, principal: Principal, target_unit_id: int | None = None
    ) -> dict:
        """List a unit's repository as a 2-level tree (story 16).

        Like :meth:`list_documents_by_unit` this returns EVERY document in the
        unit repository conversation regardless of uploader (both are
        conversation-scoped, ADR-005); that method is the admin-facing paginated /
        searchable / unread-flagged view, this is the user-facing 2-level tree.
        Defaults to the principal's OWN unit; story 35 lets a
        super-admin (resolved upstream) pass ``target_unit_id`` to view another
        unit's repository. Read-only; never creates the repository conversation.

        Returns ``{'groups': [{'id','name'}], 'documents': [{'id','name',
        'group_id'}]}``.
        """

    @abstractmethod
    async def link_repository_docs(
        self,
        principal: Principal,
        conv_id: int,
        document_ids: list[str],
        target_unit_id: int | None = None,
    ) -> list[str]:
        """Link repository documents to a conversation by reference (story 16).

        Each id must belong to the EFFECTIVE unit's repository (default = the
        principal's own; story 35: ``target_unit_id`` for a super-admin resolved
        upstream), else :class:`PermissionError`. Returns the linked ids. Idempotent.
        """

    @abstractmethod
    async def linked_repo_doc_ids(self, conv_id: int) -> list[str]:
        """Return repository document ids linked to a conversation (story 16)."""

    @abstractmethod
    async def find_linked_repo_documents(self, conv_id: int) -> list[dict]:
        """Return the repository documents linked to a conversation (story 16).

        Same row shape as :meth:`find_by_conversation` so they can be appended
        to a conversation's document list for display/selection, PLUS a
        ``group_name`` key (story 33) holding the document's repository folder
        name (None when ungrouped) so the chat panel can group them. Read-only.
        """

    @abstractmethod
    async def unlink_repository_doc(
        self, conv_id: int, document_id: str
    ) -> dict:
        """Remove a repository link from a conversation (story 19).

        Deletes only the ``conversation_repo_doc`` row — the repository document
        itself is untouched. Returns ``{'changes': int}``. Idempotent.
        """


class InfoTableRepository(ABC):
    """Contract for info_table data access (scoped via the conversation owner)."""

    @abstractmethod
    async def create(self, data: dict) -> dict:
        """Insert an info_table row; returns the created row."""

    @abstractmethod
    async def find_by_conversation(
        self, principal: Principal, conv_id: int
    ) -> list[dict]:
        """List info_tables of a conversation the principal may access."""

    @abstractmethod
    async def find_visible(
        self, principal: Principal, info_id: str
    ) -> dict | None:
        """Return an info_table if the principal may access it, else None."""

    @abstractmethod
    async def update(
        self, principal: Principal, info_id: str, patch: dict
    ) -> dict:
        """Update allowed fields on an accessible info_table."""

    @abstractmethod
    async def delete(self, principal: Principal, info_id: str) -> dict:
        """Delete an accessible info_table; returns the removed row."""
