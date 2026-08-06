# tests/test_document.py
"""Tests for the preview document proxy route."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.middlewares.auth import get_current_user, require_admin
from app.repositories.factory import (
    get_conversation_repository,
    get_document_repository,
)


@pytest.fixture
def client() -> TestClient:
    """Create a test client with mocked db lifespan."""
    with patch("app.main.init_db", new_callable=AsyncMock), patch(
        "app.main.close_db", new_callable=AsyncMock
    ):
        return TestClient(app)


def _override_repos(conv_return, doc_return) -> None:
    """Override the conversation/document repository dependencies with fakes."""
    conv_repo = AsyncMock()
    conv_repo.find_visible = AsyncMock(return_value=conv_return)
    doc_repo = AsyncMock()
    doc_repo.find_visible = AsyncMock(return_value=doc_return)
    # Story 20: the view-route helper consults linked repo docs; default none.
    doc_repo.find_linked_repo_documents = AsyncMock(return_value=[])
    app.dependency_overrides[get_conversation_repository] = lambda: conv_repo
    app.dependency_overrides[get_document_repository] = lambda: doc_repo


def _clear_overrides() -> None:
    app.dependency_overrides.clear()


def test_preview_document_success_returns_preview_data(
    client: TestClient,
) -> None:
    """Verify preview route works successfully when models exist."""
    user_id = 123
    conv_id = 456
    doc_id = "11111111-2222-3333-4444-555555555555"

    mock_user = {"id": user_id, "username": "testuser", "is_admin": False}
    mock_conv = {"id": conv_id, "user_id": user_id}
    mock_doc = {
        "id": doc_id,
        "conversation_id": conv_id,
        "user_id": user_id,
        "name": "test.pdf",
    }
    mock_upstream_preview = {
        "document": {
            "name": "test.pdf",
            "page_count": 1,
            "summary": "Mock summary",
            "pages": [
                {"page_number": 1, "content_preview": "Mock first page content"}
            ],
        }
    }
    expected_response = {
        "name": "test.pdf",
        "page_count": 1,
        "summary": "Mock summary",
        "first_5_pages": [
            # Spans are null here: /preview has no page offsets upstream.
            {"page_number": 1, "content": "Mock first page content",
             "char_start": None, "char_end": None}
        ],
    }

    app.dependency_overrides[get_current_user] = lambda: mock_user
    _override_repos(mock_conv, mock_doc)

    with patch(
        "app.routes.document._preview_remote_document",
        new_callable=AsyncMock,
        return_value=mock_upstream_preview,
    ):
        resp = client.post(
            f"/users/{user_id}/conversations/{conv_id}/documents/{doc_id}/preview"
        )
        assert resp.status_code == 200
        assert resp.json() == expected_response

    _clear_overrides()


def test_preview_document_conversation_not_found_raises_404(
    client: TestClient,
) -> None:
    """Verify preview route returns 404 if conversation is missing."""
    user_id = 123
    conv_id = 456
    doc_id = "11111111-2222-3333-4444-555555555555"

    mock_user = {"id": user_id, "username": "testuser", "is_admin": False}
    app.dependency_overrides[get_current_user] = lambda: mock_user
    _override_repos(None, None)

    with patch(
        "app.routes.document._preview_remote_document",
        new_callable=AsyncMock,
    ):
        resp = client.post(
            f"/users/{user_id}/conversations/{conv_id}/documents/{doc_id}/preview"
        )
        assert resp.status_code == 404

    _clear_overrides()


def test_preview_document_document_not_found_raises_404(
    client: TestClient,
) -> None:
    """Verify preview route returns 404 if document is missing."""
    user_id = 123
    conv_id = 456
    doc_id = "11111111-2222-3333-4444-555555555555"

    mock_user = {"id": user_id, "username": "testuser", "is_admin": False}
    mock_conv = {"id": conv_id, "user_id": user_id}
    app.dependency_overrides[get_current_user] = lambda: mock_user
    _override_repos(mock_conv, None)

    with patch(
        "app.routes.document._preview_remote_document",
        new_callable=AsyncMock,
    ):
        resp = client.post(
            f"/users/{user_id}/conversations/{conv_id}/documents/{doc_id}/preview"
        )
        assert resp.status_code == 404

    _clear_overrides()


def test_preview_document_upstream_error_raises_502(
    client: TestClient,
) -> None:
    """Verify preview route returns 502 if upstream service fails."""
    user_id = 123
    conv_id = 456
    doc_id = "11111111-2222-3333-4444-555555555555"

    mock_user = {"id": user_id, "username": "testuser", "is_admin": False}
    mock_conv = {"id": conv_id, "user_id": user_id}
    mock_doc = {
        "id": doc_id,
        "conversation_id": conv_id,
        "user_id": user_id,
        "name": "test.pdf",
    }
    app.dependency_overrides[get_current_user] = lambda: mock_user
    _override_repos(mock_conv, mock_doc)

    with patch(
        "app.routes.document._preview_remote_document",
        new_callable=AsyncMock,
        side_effect=Exception("Upstream failed"),
    ):
        resp = client.post(
            f"/users/{user_id}/conversations/{conv_id}/documents/{doc_id}/preview"
        )
        assert resp.status_code == 502

    _clear_overrides()


# ── Story 24: repository upload allow-list (widened file types) ──────────────
#
# Bug #3: only .pdf/.doc/.docx/.png/.jpeg were accepted. The list is widened to
# common office/text formats. These tests lock that the new types are accepted
# and that a truly-unknown type is still rejected (no silent widening to all).

UPLOAD_USER = {"id": 7, "username": "admin", "unit_id": 5, "is_admin": True}


def _upload_repos() -> None:
    """Repos for the repository-upload route: conv lookup + doc create."""
    conv_repo = AsyncMock()
    conv_repo.find_repository_conversation = AsyncMock(return_value=99)
    doc_repo = AsyncMock()
    # Nothing there yet, by either identity — the route now checks for this
    # file's content hash and for the id ingestion answers with before it
    # inserts (test_upload_dedup_collision.py). A bare AsyncMock answers both
    # truthily and the upload would take the reuse path.
    doc_repo.find_by_sha256 = AsyncMock(return_value=None)
    doc_repo.find_visible = AsyncMock(return_value=None)
    doc_repo.create = AsyncMock(return_value=None)
    app.dependency_overrides[get_conversation_repository] = lambda: conv_repo
    app.dependency_overrides[get_document_repository] = lambda: doc_repo


def _upload(client: TestClient, filename: str):
    """POST a one-byte file to the repository upload route."""
    return client.post(
        "/admin/documents/upload",
        files={"file": (filename, b"x", "application/octet-stream")},
    )


@pytest.mark.parametrize(
    "filename",
    ["data.xlsx", "deck.pptx", "notes.txt", "table.csv", "readme.md", "a.xls"],
)
def test_upload_repository_document_widened_types_accepted(
    client: TestClient, filename: str
) -> None:
    """New office/text formats pass the allow-list (status 201)."""
    app.dependency_overrides[get_current_user] = lambda: UPLOAD_USER
    _upload_repos()
    with patch(
        "app.routes.document._create_remote_document",
        new_callable=AsyncMock,
        return_value={"document_id": "doc-new"},
    ), patch(
        "app.routes.document._process_remote_document",
        new_callable=AsyncMock,
        return_value={"status": "processing", "chunk_count": 0, "task_id": "t"},
    ), patch("app.routes.document.audit_log"):
        resp = _upload(client, filename)
        assert resp.status_code == 201, resp.text
        assert resp.json()["name"] == filename
    _clear_overrides()


def test_upload_repository_document_unknown_type_rejected(
    client: TestClient,
) -> None:
    """A type outside the allow-list is still rejected with 400."""
    app.dependency_overrides[get_current_user] = lambda: UPLOAD_USER
    _upload_repos()
    resp = _upload(client, "malware.zip")
    assert resp.status_code == 400
    _clear_overrides()


def test_upload_repository_document_pdf_docx_still_accepted(
    client: TestClient,
) -> None:
    """Regression: the original pdf/docx types keep working."""
    app.dependency_overrides[get_current_user] = lambda: UPLOAD_USER
    _upload_repos()
    with patch(
        "app.routes.document._create_remote_document",
        new_callable=AsyncMock,
        return_value={"document_id": "doc-old"},
    ), patch(
        "app.routes.document._process_remote_document",
        new_callable=AsyncMock,
        return_value={"status": "processing", "chunk_count": 0, "task_id": "t"},
    ), patch("app.routes.document.audit_log"):
        for name in ("report.pdf", "policy.docx"):
            resp = _upload(client, name)
            assert resp.status_code == 201, resp.text
    _clear_overrides()


# ── Story 21: repository upload/replace triggers AI processing ───────────────
#
# Bug: repo upload only stored the file (no /process call), so repo documents
# stayed PENDING with chunk_count=0 and no page images — chat could not retrieve
# their content and "Xem File gốc" had no page image. Upload + replace now mirror
# the chat process_document flow so the repo doc is chunked and gets page images.


def _upload_repos_ret():
    """Repos for repo-upload, returned so tests can assert on .update calls."""
    conv_repo = AsyncMock()
    conv_repo.find_repository_conversation = AsyncMock(return_value=99)
    doc_repo = AsyncMock()
    doc_repo.find_by_sha256 = AsyncMock(return_value=None)
    doc_repo.find_visible = AsyncMock(return_value=None)
    doc_repo.create = AsyncMock(return_value=None)
    doc_repo.update = AsyncMock(return_value=None)
    app.dependency_overrides[get_conversation_repository] = lambda: conv_repo
    app.dependency_overrides[get_document_repository] = lambda: doc_repo
    return conv_repo, doc_repo


def _update_statuses(doc_repo) -> list[str]:
    """Status values passed to doc_repo.update (3rd positional arg = patch dict)."""
    return [
        call.args[2]["status"]
        for call in doc_repo.update.await_args_list
        if len(call.args) >= 3 and "status" in call.args[2]
    ]


def test_upload_repository_document_triggers_processing(
    client: TestClient,
) -> None:
    """Story 21: repo upload calls _process_remote_document + records status."""
    app.dependency_overrides[get_current_user] = lambda: UPLOAD_USER
    _, doc_repo = _upload_repos_ret()
    with patch(
        "app.routes.document._create_remote_document",
        new_callable=AsyncMock,
        return_value={"document_id": "doc-1"},
    ), patch(
        "app.routes.document._process_remote_document",
        new_callable=AsyncMock,
        return_value={"status": "processing", "chunk_count": 5, "task_id": "t1"},
    ) as proc, patch("app.routes.document.audit_log"):
        resp = _upload(client, "report.pdf")
        assert resp.status_code == 201, resp.text
        proc.assert_awaited_once()
        assert proc.await_args.args[0] == "doc-1"
        assert "PROCESSING" in _update_statuses(doc_repo)
    _clear_overrides()


def test_upload_repository_document_process_error_sets_error_status(
    client: TestClient,
) -> None:
    """Story 21: a processing failure records ERROR (no PENDING hang); the upload
    itself still succeeds because the file is already stored."""
    app.dependency_overrides[get_current_user] = lambda: UPLOAD_USER
    _, doc_repo = _upload_repos_ret()
    with patch(
        "app.routes.document._create_remote_document",
        new_callable=AsyncMock,
        return_value={"document_id": "doc-2"},
    ), patch(
        "app.routes.document._process_remote_document",
        new_callable=AsyncMock,
        side_effect=RuntimeError("ai ingest down"),
    ), patch("app.routes.document.audit_log"):
        resp = _upload(client, "report.pdf")
        assert resp.status_code == 201, resp.text
        assert "ERROR" in _update_statuses(doc_repo)
    _clear_overrides()


def test_replace_repository_document_triggers_processing(
    client: TestClient,
) -> None:
    """Story 21: replacing a repo file re-processes the newly created document."""
    app.dependency_overrides[get_current_user] = lambda: UPLOAD_USER
    doc_repo = AsyncMock()
    doc_repo.find_visible = AsyncMock(
        return_value={
            "id": "old",
            "conversation_id": 99,
            "user_id": 7,
            "name": "x.pdf",
        }
    )
    doc_repo.create = AsyncMock(return_value=None)
    doc_repo.update = AsyncMock(return_value=None)
    doc_repo.delete = AsyncMock(return_value=None)
    app.dependency_overrides[get_document_repository] = lambda: doc_repo
    with patch(
        "app.routes.document._create_remote_document",
        new_callable=AsyncMock,
        return_value={"document_id": "new-id"},
    ), patch(
        "app.routes.document._process_remote_document",
        new_callable=AsyncMock,
        return_value={"status": "processing", "chunk_count": 3, "task_id": "t2"},
    ) as proc, patch(
        "app.routes.document._delete_remote_document",
        new_callable=AsyncMock,
    ), patch("app.routes.document.audit_log"):
        resp = client.post(
            "/admin/documents/old/replace",
            files={"file": ("x.pdf", b"x", "application/pdf")},
        )
        assert resp.status_code == 200, resp.text
        proc.assert_awaited_once()
        assert proc.await_args.args[0] == "new-id"
        assert "PROCESSING" in _update_statuses(doc_repo)
    _clear_overrides()
