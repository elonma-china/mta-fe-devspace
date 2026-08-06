# tests/test_admin_doc_view.py
"""Story 39: admin-side document VIEW routes for the repository management screen.

The chat viewer reads a document through ``/users/{u}/conversations/{c}/...`` and
scopes it by conversation visibility + ``_resolve_viewable_doc``. Repository docs
live under a hidden per-unit conversation that is not "visible" to an admin in
that sense, so these admin routes mirror the EXISTING admin repo pattern
(replace/delete/process): ``require_admin`` + ``doc_repo.find_visible(id)`` (a
unit admin sees only their subtree → foreign doc 404; the super-admin/root sees
all). They reuse the same upstream proxy helpers as the chat routes.
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


def _admin() -> dict:
    return {"id": 1, "username": "admin", "is_admin": True, "unit_id": 2}


def _doc() -> dict:
    return {
        "id": DOC_ID,
        "conversation_id": 999,  # the hidden repo conversation
        "user_id": 1,
        "name": "kho.pdf",
    }


def _override_doc(doc_return) -> None:
    doc_repo = AsyncMock()
    doc_repo.find_visible = AsyncMock(return_value=doc_return)
    app.dependency_overrides[get_current_user] = lambda: _admin()
    app.dependency_overrides[get_document_repository] = lambda: doc_repo


def _clear() -> None:
    app.dependency_overrides.clear()


# ── pages (digitized text) ──────────────────────────────────────────────

def test_admin_pages_returns_pages(client: TestClient) -> None:
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
        resp = client.get(f"/admin/documents/{DOC_ID}/pages")
        assert resp.status_code == 200
        body = resp.json()
        assert body["page_count"] == 2
        assert body["name"] == "kho.pdf"
        assert [p["content"] for p in body["pages"]] == ["Trang 1", "Trang 2"]
    _clear()


def test_admin_pages_doc_not_visible_returns_404(client: TestClient) -> None:
    # A foreign doc (not in this admin's subtree) → find_visible None → 404.
    _override_doc(None)
    resp = client.get(f"/admin/documents/{DOC_ID}/pages")
    assert resp.status_code == 404
    _clear()


def test_admin_pages_upstream_error_returns_502(client: TestClient) -> None:
    _override_doc(_doc())
    with patch(
        "app.routes.document._fetch_remote_document_detail",
        new_callable=AsyncMock,
        side_effect=Exception("boom"),
    ):
        resp = client.get(f"/admin/documents/{DOC_ID}/pages")
        assert resp.status_code == 502
    _clear()


# ── file (File gốc) ─────────────────────────────────────────────────────

def test_admin_file_proxies_with_content_type(client: TestClient) -> None:
    _override_doc(_doc())
    with patch(
        "app.routes.document._fetch_remote_document_file",
        new_callable=AsyncMock,
        return_value=(b"%PDF-1.7\n", "application/pdf"),
    ):
        resp = client.get(f"/admin/documents/{DOC_ID}/file")
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "application/pdf"
        assert resp.content == b"%PDF-1.7\n"
    _clear()


def test_admin_file_doc_not_visible_returns_404(client: TestClient) -> None:
    _override_doc(None)
    resp = client.get(f"/admin/documents/{DOC_ID}/file")
    assert resp.status_code == 404
    _clear()


def test_admin_file_upstream_404_returns_404(client: TestClient) -> None:
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
        resp = client.get(f"/admin/documents/{DOC_ID}/file")
        assert resp.status_code == 404
    _clear()


def test_admin_file_upstream_5xx_logs_body_and_returns_502(
    client: TestClient, caplog
) -> None:
    """Story 129: upstream 5xx → 502 UNCHANGED, log now carries status + body."""
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
        resp = client.get(f"/admin/documents/{DOC_ID}/file")
        assert resp.status_code == 502
    assert "original file not found in storage" in caplog.text
    assert DOC_ID in caplog.text
    _clear()


# ── page image (thumbnail rail) ─────────────────────────────────────────

def test_admin_page_image_proxies_binary(client: TestClient) -> None:
    _override_doc(_doc())
    with patch(
        "app.routes.document._fetch_remote_page_image",
        new_callable=AsyncMock,
        return_value=(b"\x89PNG\r\n", "image/png"),
    ):
        resp = client.get(f"/admin/documents/{DOC_ID}/pages/1/image")
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "image/png"
        assert resp.content == b"\x89PNG\r\n"
    _clear()


def test_admin_page_image_upstream_404_returns_404(client: TestClient) -> None:
    import httpx

    _override_doc(_doc())
    not_found = httpx.HTTPStatusError(
        "nf",
        request=httpx.Request("GET", "http://ingest/x"),
        response=httpx.Response(404),
    )
    with patch(
        "app.routes.document._fetch_remote_page_image",
        new_callable=AsyncMock,
        side_effect=not_found,
    ):
        resp = client.get(f"/admin/documents/{DOC_ID}/pages/1/image")
        assert resp.status_code == 404
    _clear()


def test_admin_page_image_non_image_body_returns_404(client: TestClient) -> None:
    _override_doc(_doc())
    with patch(
        "app.routes.document._fetch_remote_page_image",
        new_callable=AsyncMock,
        return_value=(b"<html>err</html>", "text/html"),
    ):
        resp = client.get(f"/admin/documents/{DOC_ID}/pages/1/image")
        assert resp.status_code == 404
    _clear()


def test_admin_page_image_doc_not_visible_returns_404(client: TestClient) -> None:
    _override_doc(None)
    resp = client.get(f"/admin/documents/{DOC_ID}/pages/1/image")
    assert resp.status_code == 404
    _clear()
