# tests/test_repo_notifications.py
"""Story 115: repository notification count is role-aware (drives the badge).

``count_repo_notifications`` powers the "Kho tài liệu" unread badge:
  * admin (super OR unit) → 0 — admins no longer get the badge.
  * commander ("Chỉ huy": not admin, holds documents:read/manage, on the root
    unit) → ONLY documents uploaded by a SUPER admin, across every repository.
  * everyone else (regular member) → unchanged: delegates to
    ``count_unread_repo_documents`` (own unit repo, any uploader).

These are no-DB unit tests for the role branching (admin short-circuit, member
delegation, commander-uses-query). The uploader-filter SQL for the commander
branch is asserted end-to-end in the DB-backed ``test_repo_notifications_db.py``.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

from app.models.access import Principal
from app.repositories.postgres import SqlAlchemyDocumentRepository


def _repo() -> SqlAlchemyDocumentRepository:
    return SqlAlchemyDocumentRepository(AsyncMock())


def test_notifications_superAdmin_returnsZero_noQuery() -> None:
    repo = _repo()
    p = Principal(id=1, unit_id=None, is_admin=True)
    assert asyncio.run(repo.count_repo_notifications(p)) == 0
    repo._session.execute.assert_not_called()


def test_notifications_unitAdmin_returnsZero_noQuery() -> None:
    repo = _repo()
    p = Principal(id=2, unit_id=5, is_admin=True)
    assert asyncio.run(repo.count_repo_notifications(p)) == 0
    repo._session.execute.assert_not_called()


def test_notifications_regularMember_delegatesToUnread() -> None:
    repo = _repo()
    repo.count_unread_repo_documents = AsyncMock(return_value=9)
    p = Principal(id=7, unit_id=5, is_admin=False)
    assert asyncio.run(repo.count_repo_notifications(p)) == 9
    repo.count_unread_repo_documents.assert_awaited_once()
    assert repo.count_unread_repo_documents.await_args.args[0].id == 7


def test_notifications_docCapableOnNonRootUnit_delegatesLikeMember() -> None:
    # A documents-capable user on a NON-root unit is NOT a commander → own-unit
    # scope (delegate), NOT the super-upload filter.
    repo = _repo()
    repo.count_unread_repo_documents = AsyncMock(return_value=4)
    p = Principal(
        id=8, unit_id=5, is_admin=False,
        permissions=frozenset({"documents:read"}),
    )
    assert asyncio.run(repo.count_repo_notifications(p)) == 4
    repo.count_unread_repo_documents.assert_awaited_once()


def test_notifications_commander_usesQuery_notDelegate() -> None:
    # Commander (not admin, documents:read, root unit): runs its own super-upload
    # query — it must NOT fall through to the member delegate path.
    repo = _repo()
    repo.count_unread_repo_documents = AsyncMock(return_value=99)
    result = MagicMock()
    result.scalar_one.return_value = 2
    repo._session.execute = AsyncMock(return_value=result)
    p = Principal(
        id=3, unit_id=1, is_admin=False,
        permissions=frozenset({"documents:read"}),
    )
    assert asyncio.run(repo.count_repo_notifications(p)) == 2
    repo.count_unread_repo_documents.assert_not_awaited()
    repo._session.execute.assert_awaited_once()
