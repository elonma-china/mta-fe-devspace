# tests/test_repo_doc_read.py
"""Story 54: per-user read tracking for repository documents.

Two endpoints, route-level (the repository is mocked, so these run without a DB):

* ``POST /repository/documents/{id}/read`` — mark the CURRENT user as having read
  a repository document. Any authenticated user (admin opens it in the repo
  screen, a regular user opens a linked repo doc in chat). Visibility is gated in
  the repository layer (``mark_repo_document_read`` returns False → 404).
* ``GET /admin/documents/unread-count`` — count of repository documents the admin
  has NOT read yet (badge on the "Kho tài liệu" header button). Admin only.

The set-difference / baseline / prune SQL is covered by the DB-backed
``test_repo_doc_read_db.py`` (skips without TEST_DATABASE_URL).
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.middlewares.auth import get_current_user, require_admin
from app.repositories.factory import get_document_repository

DOC_ID = "11111111-2222-3333-4444-555555555555"


@pytest.fixture
def client() -> TestClient:
    with patch("app.main.init_db", new_callable=AsyncMock), patch(
        "app.main.close_db", new_callable=AsyncMock
    ):
        return TestClient(app)


def _user(is_admin: bool = False) -> dict:
    return {
        "id": 7,
        "username": "u7",
        "is_admin": is_admin,
        "unit_id": 2,
    }


def _clear() -> None:
    app.dependency_overrides.clear()


def test_markRead_visibleDoc_returns204(client: TestClient) -> None:
    repo = AsyncMock()
    repo.mark_repo_document_read = AsyncMock(return_value=True)
    app.dependency_overrides[get_current_user] = lambda: _user()
    app.dependency_overrides[get_document_repository] = lambda: repo
    resp = client.post(f"/repository/documents/{DOC_ID}/read")
    assert resp.status_code == 204
    repo.mark_repo_document_read.assert_awaited_once()
    # principal.id (7) + document id are passed through.
    args = repo.mark_repo_document_read.await_args.args
    assert args[0].id == 7
    assert str(args[1]) == DOC_ID
    _clear()


def test_markRead_notVisible_returns404(client: TestClient) -> None:
    repo = AsyncMock()
    repo.mark_repo_document_read = AsyncMock(return_value=False)
    app.dependency_overrides[get_current_user] = lambda: _user()
    app.dependency_overrides[get_document_repository] = lambda: repo
    resp = client.post(f"/repository/documents/{DOC_ID}/read")
    assert resp.status_code == 404
    _clear()


def test_markRead_idempotent_secondCallStill204(client: TestClient) -> None:
    repo = AsyncMock()
    repo.mark_repo_document_read = AsyncMock(return_value=True)
    app.dependency_overrides[get_current_user] = lambda: _user()
    app.dependency_overrides[get_document_repository] = lambda: repo
    assert client.post(f"/repository/documents/{DOC_ID}/read").status_code == 204
    assert client.post(f"/repository/documents/{DOC_ID}/read").status_code == 204
    assert repo.mark_repo_document_read.await_count == 2
    _clear()


def test_unreadCount_admin_returnsCount(client: TestClient) -> None:
    # Story 115: the endpoint now delegates to the role-aware
    # ``count_repo_notifications`` (which returns 0 for admins in the real impl;
    # here the repo is mocked so we just assert the pass-through).
    repo = AsyncMock()
    repo.count_repo_notifications = AsyncMock(return_value=4)
    app.dependency_overrides[get_current_user] = lambda: _user(is_admin=True)
    app.dependency_overrides[get_document_repository] = lambda: repo
    resp = client.get("/admin/documents/unread-count")
    assert resp.status_code == 200
    assert resp.json() == {"count": 4}
    repo.count_repo_notifications.assert_awaited_once()
    assert repo.count_repo_notifications.await_args.args[0].id == 7
    _clear()
