# tests/test_user_repo_view.py
"""Story 82: user-facing repository VIEW + unread-count (regular users).

A regular user (is_admin False) must see how many documents in THEIR unit's
repository they have not read (badge) and view them read-only. These mirror the
admin routes (story 39 / 54) but key off ``get_current_user`` instead of
``require_admin`` / ``require_permission``. Scope is enforced in the repository
layer: ``count_unread_repo_documents`` / ``find_visible`` both go through
``_repo_conv_ids_for`` (regular → own unit only), so the routes never widen
access across units.

The routes are tested with the repository mocked (no DB). The actual per-unit
scoping is covered by the DB-backed ``test_repo_doc_read_db.py``.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.middlewares.auth import get_current_user
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


def _doc() -> dict:
    return {
        "id": DOC_ID,
        "conversation_id": 999,  # the hidden per-unit repo conversation
        "user_id": 1,
        "name": "kho.pdf",
    }


def _override_doc(doc_return) -> None:
    doc_repo = AsyncMock()
    doc_repo.find_visible = AsyncMock(return_value=doc_return)
    app.dependency_overrides[get_current_user] = lambda: _user()
    app.dependency_overrides[get_document_repository] = lambda: doc_repo


def _clear() -> None:
    app.dependency_overrides.clear()


# ── unread-count (general, get_current_user) ─────────────────────────────

def test_unreadCount_regularUser_returnsCount(client: TestClient) -> None:
    # Story 115: endpoint delegates to the role-aware ``count_repo_notifications``
    # (member branch = own-unit scope in the real impl; repo mocked here).
    repo = AsyncMock()
    repo.count_repo_notifications = AsyncMock(return_value=3)
    app.dependency_overrides[get_current_user] = lambda: _user()
    app.dependency_overrides[get_document_repository] = lambda: repo
    resp = client.get("/repository/documents/unread-count")
    assert resp.status_code == 200
    assert resp.json() == {"count": 3}
    # principal.id (7) is passed → scope is the caller's own unit repository.
    repo.count_repo_notifications.assert_awaited_once()
    assert repo.count_repo_notifications.await_args.args[0].id == 7
    _clear()


def test_unreadCount_general_sameScopeAsAdmin(client: TestClient) -> None:
    # Story 115: both endpoints call the SAME role-aware method, so they still
    # return the same value for the same caller.
    repo = AsyncMock()
    repo.count_repo_notifications = AsyncMock(return_value=4)
    app.dependency_overrides[get_current_user] = lambda: _user(is_admin=True)
    app.dependency_overrides[get_document_repository] = lambda: repo
    general = client.get("/repository/documents/unread-count").json()
    admin = client.get("/admin/documents/unread-count").json()
    assert general == admin == {"count": 4}
    _clear()


# ── pages (digitized text) ──────────────────────────────────────────────

def test_user_pages_returns_pages(client: TestClient) -> None:
    _override_doc(_doc())
    detail = {
        "name": "kho.pdf",
        "page_count": 2,
        "pages": [
            {"page_number": 1, "page_content": "Trang 1"},
            {"page_number": 2, "page_content": "Trang 2"},
        ],
    }
    with patch(
        "app.routes.document._fetch_remote_document_detail",
        new_callable=AsyncMock,
        return_value=detail,
    ):
        resp = client.get(f"/repository/documents/{DOC_ID}/pages")
        assert resp.status_code == 200
        body = resp.json()
        assert body["page_count"] == 2
        assert body["name"] == "kho.pdf"
        assert [p["content"] for p in body["pages"]] == ["Trang 1", "Trang 2"]
    _clear()


def test_user_pages_notVisible_returns404(client: TestClient) -> None:
    # A doc outside the user's own unit repo → find_visible None → 404.
    _override_doc(None)
    resp = client.get(f"/repository/documents/{DOC_ID}/pages")
    assert resp.status_code == 404
    _clear()


def test_user_pages_upstreamError_returns502(client: TestClient) -> None:
    _override_doc(_doc())
    with patch(
        "app.routes.document._fetch_remote_document_detail",
        new_callable=AsyncMock,
        side_effect=Exception("boom"),
    ):
        resp = client.get(f"/repository/documents/{DOC_ID}/pages")
        assert resp.status_code == 502
    _clear()


# ── file (File gốc) ─────────────────────────────────────────────────────

def test_user_file_proxies_with_content_type(client: TestClient) -> None:
    _override_doc(_doc())
    with patch(
        "app.routes.document._fetch_remote_document_file",
        new_callable=AsyncMock,
        return_value=(b"%PDF-1.7\n", "application/pdf"),
    ):
        resp = client.get(f"/repository/documents/{DOC_ID}/file")
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "application/pdf"
        assert resp.content == b"%PDF-1.7\n"
    _clear()


def test_user_file_notVisible_returns404(client: TestClient) -> None:
    _override_doc(None)
    resp = client.get(f"/repository/documents/{DOC_ID}/file")
    assert resp.status_code == 404
    _clear()


def test_user_file_upstream404_returns404(client: TestClient) -> None:
    import httpx

    _override_doc(_doc())
    not_found = httpx.HTTPStatusError(
        "nf",
        request=httpx.Request("GET", "http://ingest/x"),
        response=httpx.Response(404),
    )
    with patch(
        "app.routes.document._fetch_remote_document_file",
        new_callable=AsyncMock,
        side_effect=not_found,
    ):
        resp = client.get(f"/repository/documents/{DOC_ID}/file")
        assert resp.status_code == 404
    _clear()


def test_user_file_upstream_5xx_logs_body_and_returns_502(
    client: TestClient, caplog
) -> None:
    """Story 129: the repo /file route previously returned 502 on an upstream
    5xx WITHOUT logging (silent). It must still return 502, but now emit a log
    with the upstream status + body for diagnosis."""
    import logging

    import httpx

    _override_doc(_doc())
    err = httpx.HTTPStatusError(
        "boom",
        request=httpx.Request("GET", "http://ingest/x"),
        response=httpx.Response(500, text="original file not found in storage"),
    )
    with caplog.at_level(logging.ERROR), patch(
        "app.routes.document._fetch_remote_document_file",
        new_callable=AsyncMock,
        side_effect=err,
    ):
        resp = client.get(f"/repository/documents/{DOC_ID}/file")
        assert resp.status_code == 502
    assert "original file not found in storage" in caplog.text
    assert DOC_ID in caplog.text
    _clear()


# ── page image (thumbnail rail) ─────────────────────────────────────────

def test_user_page_image_proxies_binary(client: TestClient) -> None:
    _override_doc(_doc())
    with patch(
        "app.routes.document._fetch_remote_page_image",
        new_callable=AsyncMock,
        return_value=(b"\x89PNG\r\n", "image/png"),
    ):
        resp = client.get(f"/repository/documents/{DOC_ID}/pages/1/image")
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "image/png"
        assert resp.content == b"\x89PNG\r\n"
    _clear()


def test_user_page_image_nonImageBody_returns404(client: TestClient) -> None:
    _override_doc(_doc())
    with patch(
        "app.routes.document._fetch_remote_page_image",
        new_callable=AsyncMock,
        return_value=(b"<html>err</html>", "text/html"),
    ):
        resp = client.get(f"/repository/documents/{DOC_ID}/pages/1/image")
        assert resp.status_code == 404
    _clear()


def test_user_page_image_notVisible_returns404(client: TestClient) -> None:
    _override_doc(None)
    resp = client.get(f"/repository/documents/{DOC_ID}/pages/1/image")
    assert resp.status_code == 404
    _clear()
