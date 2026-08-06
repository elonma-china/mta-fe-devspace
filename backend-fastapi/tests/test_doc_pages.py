# tests/test_doc_pages.py
"""Tests for the document page-text and page-image proxy routes (story 15).

Page TEXT (digitized / "Nội dung số hoá") reuses the existing preview proxy
(upstream returns ``document.pages[].content_preview``). Page IMAGE ("File gốc")
is a proxy to the AI ingest / MinIO endpoint; that upstream path is not yet
available, so the route returns a clear, non-fabricated unavailable status.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.middlewares.auth import get_current_user
from app.repositories.factory import (
    get_conversation_repository,
    get_document_repository,
)

USER_ID = 123
CONV_ID = 456
DOC_ID = "11111111-2222-3333-4444-555555555555"


@pytest.fixture
def client() -> TestClient:
    with patch("app.main.init_db", new_callable=AsyncMock), patch(
        "app.main.close_db", new_callable=AsyncMock
    ):
        return TestClient(app)


def _override_repos(conv_return, doc_return) -> None:
    conv_repo = AsyncMock()
    conv_repo.find_visible = AsyncMock(return_value=conv_return)
    doc_repo = AsyncMock()
    doc_repo.find_visible = AsyncMock(return_value=doc_return)
    # Default: no linked repository docs (story 20 helper falls through to 404).
    doc_repo.find_linked_repo_documents = AsyncMock(return_value=[])
    app.dependency_overrides[get_conversation_repository] = lambda: conv_repo
    app.dependency_overrides[get_document_repository] = lambda: doc_repo


def _clear() -> None:
    app.dependency_overrides.clear()


def _user(is_admin: bool = False) -> dict:
    return {"id": USER_ID, "username": "u", "is_admin": is_admin}


def _conv() -> dict:
    return {"id": CONV_ID, "user_id": USER_ID}


def _doc() -> dict:
    return {
        "id": DOC_ID,
        "conversation_id": CONV_ID,
        "user_id": USER_ID,
        "name": "test.pdf",
    }


# ── Page TEXT (digitized) ───────────────────────────────────────────────


def test_get_page_text_returns_pages(client: TestClient) -> None:
    """Page-text route returns every page's content + page_count.

    Story 22: source is GET /documents/{id} (full page_content), not /preview.
    """
    detail = {
        "name": "test.pdf",
        "page_count": 2,
        "pages": [
            {"page_number": 1, "page_content": "Trang 1"},
            {"page_number": 2, "page_content": "Trang 2"},
        ],
    }
    app.dependency_overrides[get_current_user] = lambda: _user()
    _override_repos(_conv(), _doc())
    with patch(
        "app.routes.document._fetch_remote_document_detail",
        new_callable=AsyncMock,
        return_value=detail,
    ):
        resp = client.get(
            f"/users/{USER_ID}/conversations/{CONV_ID}"
            f"/documents/{DOC_ID}/pages"
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["page_count"] == 2
        assert [p["content"] for p in body["pages"]] == ["Trang 1", "Trang 2"]
    _clear()


def test_get_page_text_doc_not_visible_returns_404(
    client: TestClient,
) -> None:
    app.dependency_overrides[get_current_user] = lambda: _user()
    _override_repos(_conv(), None)
    with patch(
        "app.routes.document._fetch_remote_document_detail",
        new_callable=AsyncMock,
    ):
        resp = client.get(
            f"/users/{USER_ID}/conversations/{CONV_ID}"
            f"/documents/{DOC_ID}/pages"
        )
        assert resp.status_code == 404
    _clear()


def test_get_page_text_upstream_error_returns_502(
    client: TestClient,
) -> None:
    app.dependency_overrides[get_current_user] = lambda: _user()
    _override_repos(_conv(), _doc())
    with patch(
        "app.routes.document._fetch_remote_document_detail",
        new_callable=AsyncMock,
        side_effect=Exception("boom"),
    ):
        resp = client.get(
            f"/users/{USER_ID}/conversations/{CONV_ID}"
            f"/documents/{DOC_ID}/pages"
        )
        assert resp.status_code == 502
    _clear()


# ── File gốc: GET /file proxy (story 22) ────────────────────────────────


def test_get_file_proxies_pdf_with_content_type(client: TestClient) -> None:
    """File route streams the original file (PDF) with its content-type."""
    app.dependency_overrides[get_current_user] = lambda: _user()
    _override_repos(_conv(), _doc())
    with patch(
        "app.routes.document._fetch_remote_document_file",
        new_callable=AsyncMock,
        return_value=(b"%PDF-1.7\n", "application/pdf"),
    ):
        resp = client.get(
            f"/users/{USER_ID}/conversations/{CONV_ID}"
            f"/documents/{DOC_ID}/file"
        )
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "application/pdf"
        assert resp.content == b"%PDF-1.7\n"
    _clear()


def test_get_file_proxies_docx_with_content_type(client: TestClient) -> None:
    """Story 23: the file proxy passes the ORIGINAL content-type through, not a
    hardcoded PDF — so the FE can pick a docx/xlsx/… renderer (bug #2)."""
    docx_ct = (
        "application/vnd.openxmlformats-officedocument"
        ".wordprocessingml.document"
    )
    app.dependency_overrides[get_current_user] = lambda: _user()
    _override_repos(_conv(), _doc())
    with patch(
        "app.routes.document._fetch_remote_document_file",
        new_callable=AsyncMock,
        return_value=(b"PK\x03\x04docx-bytes", docx_ct),
    ):
        resp = client.get(
            f"/users/{USER_ID}/conversations/{CONV_ID}"
            f"/documents/{DOC_ID}/file"
        )
        assert resp.status_code == 200
        assert resp.headers["content-type"] == docx_ct
        assert resp.content == b"PK\x03\x04docx-bytes"
    _clear()


def test_get_file_upstream_404_returns_404(client: TestClient) -> None:
    """Doc not processed yet (no file upstream) → 404, FE shows fallback."""
    import httpx

    app.dependency_overrides[get_current_user] = lambda: _user()
    _override_repos(_conv(), _doc())
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
        resp = client.get(
            f"/users/{USER_ID}/conversations/{CONV_ID}"
            f"/documents/{DOC_ID}/file"
        )
        assert resp.status_code == 404
    _clear()


def test_get_file_upstream_5xx_logs_body_and_returns_502(
    client: TestClient, caplog
) -> None:
    """Story 129 (diagnostics): upstream 5xx (AI-side) → 502 UNCHANGED, and the
    log now carries the upstream STATUS + BODY so ops can tell "missing original"
    from a real infra error. The 502 status itself must not regress."""
    import logging

    import httpx

    app.dependency_overrides[get_current_user] = lambda: _user()
    _override_repos(_conv(), _doc())
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
        resp = client.get(
            f"/users/{USER_ID}/conversations/{CONV_ID}"
            f"/documents/{DOC_ID}/file"
        )
        assert resp.status_code == 502
    assert "original file not found in storage" in caplog.text
    assert DOC_ID in caplog.text
    _clear()


def test_get_file_doc_not_visible_returns_404(client: TestClient) -> None:
    app.dependency_overrides[get_current_user] = lambda: _user()
    _override_repos(_conv(), None)
    resp = client.get(
        f"/users/{USER_ID}/conversations/{CONV_ID}"
        f"/documents/{DOC_ID}/file"
    )
    assert resp.status_code == 404
    _clear()


# ── Nội dung số hoá: pages now use FULL page_content (story 22) ──────────


def test_get_pages_uses_full_page_content(client: TestClient) -> None:
    """Page text comes from GET /documents/{id} page_content (full), not the
    truncated /preview content_preview."""
    app.dependency_overrides[get_current_user] = lambda: _user()
    _override_repos(_conv(), _doc())
    detail = {
        "name": "test.pdf",
        "page_count": 2,
        "pages": [
            {"page_number": 1, "page_content": "Full text page 1"},
            {"page_number": 2, "page_content": "Full text page 2"},
        ],
    }
    with patch(
        "app.routes.document._fetch_remote_document_detail",
        new_callable=AsyncMock,
        return_value=detail,
    ):
        resp = client.get(
            f"/users/{USER_ID}/conversations/{CONV_ID}"
            f"/documents/{DOC_ID}/pages"
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["page_count"] == 2
        assert [p["content"] for p in body["pages"]] == [
            "Full text page 1",
            "Full text page 2",
        ]
    _clear()


# ── Page IMAGE (original "File gốc") — proxies AI ingest /pages/{n}/image ──


def test_get_page_image_proxies_binary_with_content_type(
    client: TestClient,
) -> None:
    """Image route streams the upstream page image with its content-type."""
    app.dependency_overrides[get_current_user] = lambda: _user()
    _override_repos(_conv(), _doc())
    with patch(
        "app.routes.document._fetch_remote_page_image",
        new_callable=AsyncMock,
        return_value=(b"\x89PNG\r\n", "image/png"),
    ):
        resp = client.get(
            f"/users/{USER_ID}/conversations/{CONV_ID}"
            f"/documents/{DOC_ID}/pages/1/image"
        )
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "image/png"
        assert resp.content == b"\x89PNG\r\n"
    _clear()


def test_get_page_image_upstream_404_returns_404(
    client: TestClient,
) -> None:
    """Story 18: a doc with no page image upstream (404) → BFF 404, not 502.

    The FE then shows a "no image" fallback instead of a hard error.
    """
    import httpx

    app.dependency_overrides[get_current_user] = lambda: _user()
    _override_repos(_conv(), _doc())
    not_found = httpx.HTTPStatusError(
        "not found",
        request=httpx.Request("GET", "http://ingest/x"),
        response=httpx.Response(404),
    )
    with patch(
        "app.routes.document._fetch_remote_page_image",
        new_callable=AsyncMock,
        side_effect=not_found,
    ):
        resp = client.get(
            f"/users/{USER_ID}/conversations/{CONV_ID}"
            f"/documents/{DOC_ID}/pages/1/image"
        )
        assert resp.status_code == 404
    _clear()


def test_get_page_image_upstream_5xx_returns_502(
    client: TestClient,
) -> None:
    """Upstream 5xx (real error) → 502, distinct from the 404 'no image' case."""
    import httpx

    app.dependency_overrides[get_current_user] = lambda: _user()
    _override_repos(_conv(), _doc())
    server_err = httpx.HTTPStatusError(
        "boom",
        request=httpx.Request("GET", "http://ingest/x"),
        response=httpx.Response(500),
    )
    with patch(
        "app.routes.document._fetch_remote_page_image",
        new_callable=AsyncMock,
        side_effect=server_err,
    ):
        resp = client.get(
            f"/users/{USER_ID}/conversations/{CONV_ID}"
            f"/documents/{DOC_ID}/pages/1/image"
        )
        assert resp.status_code == 502
    _clear()


def test_get_page_image_upstream_timeout_returns_502(
    client: TestClient,
) -> None:
    """A non-HTTP error (timeout/network) → 502."""
    app.dependency_overrides[get_current_user] = lambda: _user()
    _override_repos(_conv(), _doc())
    with patch(
        "app.routes.document._fetch_remote_page_image",
        new_callable=AsyncMock,
        side_effect=Exception("timeout"),
    ):
        resp = client.get(
            f"/users/{USER_ID}/conversations/{CONV_ID}"
            f"/documents/{DOC_ID}/pages/1/image"
        )
        assert resp.status_code == 502
    _clear()


# ── Story 30: guard against a non-image / empty upstream body that 200s ──────
#    (AI ingest can return 200 + empty/HTML for a page it cannot render; the old
#    helper defaulted content-type to "image/png", so the FE rendered a blank
#    <img> and both fallbacks were bypassed). Treat it as "no page image" (404).


def test_get_page_image_empty_body_returns_404(client: TestClient) -> None:
    """Upstream 200 with an EMPTY body → 404 (not a blank 200 image/png)."""
    app.dependency_overrides[get_current_user] = lambda: _user()
    _override_repos(_conv(), _doc())
    with patch(
        "app.routes.document._fetch_remote_page_image",
        new_callable=AsyncMock,
        return_value=(b"", "image/png"),
    ):
        resp = client.get(
            f"/users/{USER_ID}/conversations/{CONV_ID}"
            f"/documents/{DOC_ID}/pages/1/image"
        )
        assert resp.status_code == 404
    _clear()


def test_get_page_image_non_image_content_type_returns_404(
    client: TestClient,
) -> None:
    """Upstream 200 with a NON-image content-type (HTML error) → 404."""
    app.dependency_overrides[get_current_user] = lambda: _user()
    _override_repos(_conv(), _doc())
    with patch(
        "app.routes.document._fetch_remote_page_image",
        new_callable=AsyncMock,
        return_value=(b"<html>error</html>", "text/html"),
    ):
        resp = client.get(
            f"/users/{USER_ID}/conversations/{CONV_ID}"
            f"/documents/{DOC_ID}/pages/1/image"
        )
        assert resp.status_code == 404
    _clear()


def test_get_page_image_missing_content_type_returns_404(
    client: TestClient,
) -> None:
    """No content-type → we can't assert it's an image → 404 (FE falls back)."""
    app.dependency_overrides[get_current_user] = lambda: _user()
    _override_repos(_conv(), _doc())
    with patch(
        "app.routes.document._fetch_remote_page_image",
        new_callable=AsyncMock,
        return_value=(b"\x89PNG\r\n", ""),
    ):
        resp = client.get(
            f"/users/{USER_ID}/conversations/{CONV_ID}"
            f"/documents/{DOC_ID}/pages/1/image"
        )
        assert resp.status_code == 404
    _clear()


# ── Story 20: linked repository docs are viewable even though their own
#    conversation_id is the repository conversation, not this chat one. ───────


def _linked_doc() -> dict:
    # A repository doc whose conversation_id is the repo conv (not CONV_ID),
    # but which is linked into CONV_ID.
    return {
        "id": DOC_ID,
        "conversation_id": 999,  # repository conversation, not CONV_ID
        "user_id": 1,
        "name": "kho.pdf",
    }


def _override_repos_linked() -> None:
    """find_visible(doc) returns None (owner-scoped), but the doc is linked."""
    conv_repo = AsyncMock()
    conv_repo.find_visible = AsyncMock(return_value=_conv())
    doc_repo = AsyncMock()
    doc_repo.find_visible = AsyncMock(return_value=None)
    doc_repo.find_linked_repo_documents = AsyncMock(
        return_value=[_linked_doc()]
    )
    app.dependency_overrides[get_conversation_repository] = lambda: conv_repo
    app.dependency_overrides[get_document_repository] = lambda: doc_repo


def test_get_page_image_linked_repo_doc_allowed(client: TestClient) -> None:
    """A linked repo doc reaches the proxy (not a 404 at the visibility gate)."""
    app.dependency_overrides[get_current_user] = lambda: _user()
    _override_repos_linked()
    with patch(
        "app.routes.document._fetch_remote_page_image",
        new_callable=AsyncMock,
        return_value=(b"\x89PNG\r\n", "image/png"),
    ):
        resp = client.get(
            f"/users/{USER_ID}/conversations/{CONV_ID}"
            f"/documents/{DOC_ID}/pages/1/image"
        )
        assert resp.status_code == 200
        assert resp.content == b"\x89PNG\r\n"
    _clear()


def test_get_pages_text_linked_repo_doc_allowed(client: TestClient) -> None:
    app.dependency_overrides[get_current_user] = lambda: _user()
    _override_repos_linked()
    with patch(
        "app.routes.document._fetch_remote_document_detail",
        new_callable=AsyncMock,
        return_value={"name": "kho.pdf", "page_count": 1,
                      "pages": [{"page_number": 1, "page_content": "x"}]},
    ):
        resp = client.get(
            f"/users/{USER_ID}/conversations/{CONV_ID}"
            f"/documents/{DOC_ID}/pages"
        )
        assert resp.status_code == 200
    _clear()


def test_view_route_doc_not_linked_not_in_conv_returns_404(
    client: TestClient,
) -> None:
    """A doc neither in the conversation nor linked → 404 (security kept)."""
    conv_repo = AsyncMock()
    conv_repo.find_visible = AsyncMock(return_value=_conv())
    doc_repo = AsyncMock()
    doc_repo.find_visible = AsyncMock(return_value=None)
    doc_repo.find_linked_repo_documents = AsyncMock(return_value=[])
    app.dependency_overrides[get_current_user] = lambda: _user()
    app.dependency_overrides[get_conversation_repository] = lambda: conv_repo
    app.dependency_overrides[get_document_repository] = lambda: doc_repo
    resp = client.get(
        f"/users/{USER_ID}/conversations/{CONV_ID}"
        f"/documents/{DOC_ID}/pages/1/image"
    )
    assert resp.status_code == 404
    _clear()


def test_get_page_image_doc_not_visible_returns_404(
    client: TestClient,
) -> None:
    app.dependency_overrides[get_current_user] = lambda: _user()
    _override_repos(_conv(), None)
    resp = client.get(
        f"/users/{USER_ID}/conversations/{CONV_ID}"
        f"/documents/{DOC_ID}/pages/1/image"
    )
    assert resp.status_code == 404
    _clear()
