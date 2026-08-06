# tests/test_doc_repository.py
"""Tests for the admin "Quản lý kho tài liệu" (document repository) endpoints.

The repository screen lists ALL documents in the caller's unit subtree (not by
conversation), lets the admin edit metadata (name / số văn bản / trích yếu /
nhóm), upload new files, and delete. Documents carry the previously-orphaned
``doc_number`` and ``summary`` columns, now wired end-to-end.

The repositories and the AI-ingest proxy are mocked (mirrors test_unit.py /
test_doc_group.py).
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import status
from fastapi.testclient import TestClient

from app.main import app
from app.middlewares.auth import get_current_user
from app.repositories.factory import (
    get_conversation_repository,
    get_document_repository,
    get_user_repository,
)

# Unit admin = admin OF a non-root unit (operates on their own unit, no focus).
ADMIN_USER = {"id": 1, "username": "admin", "is_admin": True, "unit_id": 3}
NON_ADMIN_USER = {"id": 9, "username": "bob", "is_admin": False, "unit_id": 2}
# Super-admin = admin without a unit (structural root); must focus a unit first.
SUPER_ADMIN_USER = {"id": 2, "username": "root", "is_admin": True, "unit_id": None}


@pytest.fixture
def client() -> TestClient:
    with patch("app.main.init_db", new_callable=AsyncMock), patch(
        "app.main.close_db", new_callable=AsyncMock
    ):
        return TestClient(app)


def _as_admin() -> None:
    app.dependency_overrides[get_current_user] = lambda: ADMIN_USER


def _override_doc_repo(repo: AsyncMock) -> None:
    app.dependency_overrides[get_document_repository] = lambda: repo


def _override_conv_repo(repo: AsyncMock) -> None:
    app.dependency_overrides[get_conversation_repository] = lambda: repo


def _nothing_already_uploaded(repo: AsyncMock) -> None:
    """The repository holds neither this file's content nor the id ingestion
    answers with. Upload checks both before inserting (see
    test_upload_dedup_collision.py) and a bare AsyncMock answers both truthily,
    which would send every upload down the reuse path."""
    repo.find_by_sha256.return_value = None
    repo.find_visible.return_value = None


def _override_user_repo(repo: AsyncMock) -> None:
    app.dependency_overrides[get_user_repository] = lambda: repo


def _as_super_admin() -> None:
    app.dependency_overrides[get_current_user] = lambda: SUPER_ADMIN_USER


def teardown_function() -> None:
    app.dependency_overrides.clear()


# ── /me carries unit_name (header "đơn vị <tên>") ─────────────────────


def test_me_returns_unit_name(client: TestClient) -> None:
    """GET /me includes the caller's unit_name so the repo header survives a
    refresh (login already returns it; /me previously did not)."""
    _as_admin()
    user_repo = AsyncMock()
    user_repo.find_by_id.return_value = {
        "id": 1,
        "username": "admin",
        "is_admin": True,
        "unit_id": 1,
        "unit_name": "Phòng Kế toán",
    }
    _override_user_repo(user_repo)

    resp = client.get("/me")

    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert body["unit_name"] == "Phòng Kế toán"
    assert body["unit_id"] == 1


# ── List ──────────────────────────────────────────────────────────────


def test_list_repo_documents_returns_paginated_object(
    client: TestClient,
) -> None:
    """GET /admin/documents returns {items,total,page,page_size} with the
    repository fields (doc_number, summary, group_name, created_at)."""
    _as_admin()
    repo = AsyncMock()
    repo.list_documents_by_unit.return_value = {
        "items": [
            {
                "id": "11111111-1111-1111-1111-111111111111",
                "name": "Bảng chấm công.pdf",
                "doc_number": "ĐM-11/CN",
                "summary": "Bảng chấm công tháng 5",
                "group_id": 1,
                "group_name": "Bảng lương tháng",
                "created_at": "2026-05-24T00:00:00Z",
            }
        ],
        "total": 1,
        "page": 1,
        "page_size": 15,
    }
    _override_doc_repo(repo)

    resp = client.get("/admin/documents", params={"page": 1, "page_size": 15})

    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert body["total"] == 1
    assert body["page"] == 1
    item = body["items"][0]
    assert item["doc_number"] == "ĐM-11/CN"
    assert item["summary"] == "Bảng chấm công tháng 5"
    assert item["group_name"] == "Bảng lương tháng"


def test_list_repo_documents_search_forwards_to_repo(
    client: TestClient,
) -> None:
    """The ``search`` query param is forwarded to the repository."""
    _as_admin()
    repo = AsyncMock()
    repo.list_documents_by_unit.return_value = {
        "items": [],
        "total": 0,
        "page": 1,
        "page_size": 15,
    }
    _override_doc_repo(repo)

    resp = client.get("/admin/documents", params={"search": "lương"})

    assert resp.status_code == status.HTTP_200_OK
    kwargs = repo.list_documents_by_unit.call_args.kwargs
    assert kwargs.get("search") == "lương"


def test_list_repo_documents_filter_by_group_ids(client: TestClient) -> None:
    """Multiple ``group_ids`` query params are forwarded as a list."""
    _as_admin()
    repo = AsyncMock()
    repo.list_documents_by_unit.return_value = {
        "items": [],
        "total": 0,
        "page": 1,
        "page_size": 15,
    }
    _override_doc_repo(repo)

    resp = client.get("/admin/documents", params=[("group_ids", 1), ("group_ids", 2)])

    assert resp.status_code == status.HTTP_200_OK
    kwargs = repo.list_documents_by_unit.call_args.kwargs
    assert kwargs.get("group_ids") == [1, 2]


def test_list_repo_admin_unit_no_param_uses_own_unit(
    client: TestClient,
) -> None:
    """A unit admin without a unit_id param lists their own unit (no target)."""
    _as_admin()
    repo = AsyncMock()
    repo.list_documents_by_unit.return_value = {
        "items": [],
        "total": 0,
        "page": 1,
        "page_size": 15,
    }
    _override_doc_repo(repo)

    resp = client.get("/admin/documents")

    assert resp.status_code == status.HTTP_200_OK
    kwargs = repo.list_documents_by_unit.call_args.kwargs
    # Admin's effective unit = their own (3); no foreign target leaks in.
    assert kwargs.get("target_unit_id") == 3


def test_list_repo_superadmin_without_unit_lists_all_units(
    client: TestClient,
) -> None:
    """Story 78: a super-admin with no focus lists EVERY unit (all_units mode)."""
    _as_super_admin()
    repo = AsyncMock()
    repo.list_documents_by_unit.return_value = {
        "items": [
            {
                "id": "11111111-1111-1111-1111-111111111111",
                "name": "A.pdf",
                "unit_name": "Đơn vị 1",
            }
        ],
        "total": 1,
        "page": 1,
        "page_size": 15,
    }
    _override_doc_repo(repo)

    resp = client.get("/admin/documents")

    assert resp.status_code == status.HTTP_200_OK
    kwargs = repo.list_documents_by_unit.call_args.kwargs
    assert kwargs.get("all_units") is True
    assert kwargs.get("target_unit_id") is None
    # The "Đơn vị" column value flows through to the response.
    assert resp.json()["items"][0]["unit_name"] == "Đơn vị 1"


def test_list_repo_commander_without_unit_lists_all_units(
    client: TestClient,
) -> None:
    """Story 78: the commander (is_admin False, ROOT unit) also lists all units."""
    app.dependency_overrides[get_current_user] = lambda: {
        "id": 7,
        "username": "chihuy",
        "is_admin": False,
        "unit_id": 1,
        "permissions": ["documents:read"],
    }
    repo = AsyncMock()
    repo.list_documents_by_unit.return_value = {
        "items": [],
        "total": 0,
        "page": 1,
        "page_size": 15,
    }
    _override_doc_repo(repo)

    resp = client.get("/admin/documents")

    assert resp.status_code == status.HTTP_200_OK
    assert repo.list_documents_by_unit.call_args.kwargs.get("all_units") is True


def test_list_repo_unit_admin_never_all_units(client: TestClient) -> None:
    """Story 78: a unit admin is NEVER put in all-units mode (no cross-unit leak)."""
    _as_admin()  # unit admin, unit_id=3
    repo = AsyncMock()
    repo.list_documents_by_unit.return_value = {
        "items": [],
        "total": 0,
        "page": 1,
        "page_size": 15,
    }
    _override_doc_repo(repo)

    resp = client.get("/admin/documents")

    assert resp.status_code == status.HTTP_200_OK
    kwargs = repo.list_documents_by_unit.call_args.kwargs
    assert kwargs.get("all_units") is False
    assert kwargs.get("target_unit_id") == 3


def test_list_repo_superadmin_with_unit_scopes_to_it(
    client: TestClient,
) -> None:
    """A super-admin focusing unit X lists that unit's repository."""
    _as_super_admin()
    repo = AsyncMock()
    repo.list_documents_by_unit.return_value = {
        "items": [],
        "total": 0,
        "page": 1,
        "page_size": 15,
    }
    _override_doc_repo(repo)

    resp = client.get("/admin/documents", params={"unit_id": 5})

    assert resp.status_code == status.HTTP_200_OK
    kwargs = repo.list_documents_by_unit.call_args.kwargs
    assert kwargs.get("target_unit_id") == 5


def test_upload_repo_superadmin_with_unit_keys_conv_to_it(
    client: TestClient,
) -> None:
    """A super-admin upload focusing unit X resolves that unit's repo conv."""
    _as_super_admin()
    doc_repo = AsyncMock()
    _nothing_already_uploaded(doc_repo)
    doc_repo.create.return_value = {"id": "abc"}
    conv_repo = AsyncMock()
    conv_repo.find_repository_conversation.return_value = 77
    _override_doc_repo(doc_repo)
    _override_conv_repo(conv_repo)

    with patch(
        "app.routes.document._create_remote_document",
        new_callable=AsyncMock,
        return_value={"document_id": "abc"},
    ):
        resp = client.post(
            "/admin/documents/upload",
            params={"unit_id": 5},
            files={"file": ("a.pdf", b"data", "application/pdf")},
        )

    assert resp.status_code == status.HTTP_201_CREATED
    kwargs = conv_repo.find_repository_conversation.call_args.kwargs
    assert kwargs.get("target_unit_id") == 5


def test_upload_repo_superadmin_without_unit_returns_400(
    client: TestClient,
) -> None:
    """A super-admin upload without a focused unit is rejected."""
    _as_super_admin()
    _override_doc_repo(AsyncMock())
    _override_conv_repo(AsyncMock())

    resp = client.post(
        "/admin/documents/upload",
        files={"file": ("a.pdf", b"data", "application/pdf")},
    )

    assert resp.status_code == status.HTTP_400_BAD_REQUEST


def test_list_repo_documents_non_admin_returns_403(client: TestClient) -> None:
    """Non-admins cannot list the repository."""
    app.dependency_overrides[get_current_user] = lambda: NON_ADMIN_USER
    _override_doc_repo(AsyncMock())

    resp = client.get("/admin/documents")

    assert resp.status_code == status.HTTP_403_FORBIDDEN


# ── Update (metadata) ─────────────────────────────────────────────────


def test_update_repo_document_metadata_returns_200(client: TestClient) -> None:
    """Editing name/doc_number/summary/group_id forwards to repo.update."""
    _as_admin()
    repo = AsyncMock()
    repo.update.return_value = {"changes": 1}
    repo.find_visible.return_value = {
        "id": "11111111-1111-1111-1111-111111111111",
        "conversation_id": 77,
        "user_id": 1,
        "name": "Mới.pdf",
        "doc_number": "X-1",
        "summary": "tóm tắt",
        "group_id": 2,
        "created_at": "2026-05-24T00:00:00Z",
    }
    _override_doc_repo(repo)

    resp = client.put(
        "/admin/documents/11111111-1111-1111-1111-111111111111",
        json={
            "name": "Mới.pdf",
            "doc_number": "X-1",
            "summary": "tóm tắt",
            "group_id": 2,
        },
    )

    assert resp.status_code == status.HTTP_200_OK
    patch_arg = repo.update.call_args.args[2]
    assert patch_arg["doc_number"] == "X-1"
    assert patch_arg["summary"] == "tóm tắt"


def test_update_repo_document_clear_group_sets_null(
    client: TestClient,
) -> None:
    """Sending group_id=null explicitly must reach repo.update as None so the
    document can be un-grouped (regression: exclude_none dropped it)."""
    _as_admin()
    repo = AsyncMock()
    repo.update.return_value = {"changes": 1}
    repo.find_visible.return_value = {
        "id": "11111111-1111-1111-1111-111111111111",
        "conversation_id": 77,
        "user_id": 1,
        "name": "Mới.pdf",
        "doc_number": "X-1",
        "summary": "tóm tắt",
        "group_id": None,
        "created_at": "2026-05-24T00:00:00Z",
    }
    _override_doc_repo(repo)

    resp = client.put(
        "/admin/documents/11111111-1111-1111-1111-111111111111",
        json={
            "name": "Mới.pdf",
            "doc_number": "X-1",
            "summary": "tóm tắt",
            "group_id": None,
        },
    )

    assert resp.status_code == status.HTTP_200_OK
    patch_arg = repo.update.call_args.args[2]
    assert "group_id" in patch_arg
    assert patch_arg["group_id"] is None


def test_update_repo_document_name_only_keeps_group(
    client: TestClient,
) -> None:
    """A partial update that omits group_id must NOT null it (exclude_unset
    keeps only fields the client actually sent)."""
    _as_admin()
    repo = AsyncMock()
    repo.update.return_value = {"changes": 1}
    repo.find_visible.return_value = {
        "id": "11111111-1111-1111-1111-111111111111",
        "conversation_id": 77,
        "user_id": 1,
        "name": "Đổi tên.pdf",
        "group_id": 2,
        "created_at": "2026-05-24T00:00:00Z",
    }
    _override_doc_repo(repo)

    resp = client.put(
        "/admin/documents/11111111-1111-1111-1111-111111111111",
        json={"name": "Đổi tên.pdf"},
    )

    assert resp.status_code == status.HTTP_200_OK
    patch_arg = repo.update.call_args.args[2]
    assert patch_arg == {"name": "Đổi tên.pdf"}
    assert "group_id" not in patch_arg


def test_update_repo_document_empty_body_returns_400(
    client: TestClient,
) -> None:
    """An empty patch (no fields sent) is rejected with 400."""
    _as_admin()
    repo = AsyncMock()
    _override_doc_repo(repo)

    resp = client.put(
        "/admin/documents/11111111-1111-1111-1111-111111111111",
        json={},
    )

    assert resp.status_code == status.HTTP_400_BAD_REQUEST
    repo.update.assert_not_called()


def test_update_repo_document_not_found_returns_404(client: TestClient) -> None:
    """Updating a missing document returns 404."""
    _as_admin()
    repo = AsyncMock()
    repo.update.return_value = {"changes": 0}
    _override_doc_repo(repo)

    resp = client.put(
        "/admin/documents/11111111-1111-1111-1111-111111111111",
        json={"name": "X"},
    )

    assert resp.status_code == status.HTTP_404_NOT_FOUND


# ── Replace file (ghi đè nội dung) ────────────────────────────────────


def test_replace_repo_document_returns_200(client: TestClient) -> None:
    """Replacing the file deletes the old remote+row and re-creates with the new
    file, preserving the document's metadata."""
    _as_admin()
    doc_repo = AsyncMock()
    doc_repo.find_visible.return_value = {
        "id": "11111111-1111-1111-1111-111111111111",
        "conversation_id": 77,
        "user_id": 1,
        "name": "cũ.pdf",
        "doc_number": "X-1",
        "summary": "tóm tắt",
        "group_id": 2,
    }
    doc_repo.create.return_value = {"id": "new-id"}
    _override_doc_repo(doc_repo)

    with patch(
        "app.routes.document._delete_remote_document", new_callable=AsyncMock
    ) as del_remote, patch(
        "app.routes.document._create_remote_document",
        new_callable=AsyncMock,
        return_value={"document_id": "new-id"},
    ):
        resp = client.post(
            "/admin/documents/11111111-1111-1111-1111-111111111111/replace",
            files={"file": ("mới.pdf", b"new", "application/pdf")},
        )

    assert resp.status_code == status.HTTP_200_OK
    del_remote.assert_awaited()
    doc_repo.create.assert_awaited()
    # New row carries the old metadata (name kept unless renamed elsewhere).
    created_arg = doc_repo.create.call_args.args[0]
    assert created_arg["doc_number"] == "X-1"
    assert created_arg["summary"] == "tóm tắt"
    assert created_arg["group_id"] == 2


def test_replace_repo_document_not_found_404(client: TestClient) -> None:
    """Replacing a missing document returns 404."""
    _as_admin()
    doc_repo = AsyncMock()
    doc_repo.find_visible.return_value = None
    _override_doc_repo(doc_repo)

    resp = client.post(
        "/admin/documents/11111111-1111-1111-1111-111111111111/replace",
        files={"file": ("a.pdf", b"x", "application/pdf")},
    )

    assert resp.status_code == status.HTTP_404_NOT_FOUND


def test_replace_repo_document_invalid_type_400(client: TestClient) -> None:
    """An unsupported extension is rejected."""
    _as_admin()
    doc_repo = AsyncMock()
    doc_repo.find_visible.return_value = {
        "id": "11111111-1111-1111-1111-111111111111",
        "name": "x.pdf",
    }
    _override_doc_repo(doc_repo)

    resp = client.post(
        "/admin/documents/11111111-1111-1111-1111-111111111111/replace",
        files={"file": ("a.exe", b"x", "application/octet-stream")},
    )

    assert resp.status_code == status.HTTP_400_BAD_REQUEST


def test_replace_repo_document_accepts_png(client: TestClient) -> None:
    """The extended format list accepts .png (Figma + default merged)."""
    _as_admin()
    doc_repo = AsyncMock()
    doc_repo.find_visible.return_value = {
        "id": "11111111-1111-1111-1111-111111111111",
        "name": "x.pdf",
        "doc_number": None,
        "summary": None,
        "group_id": None,
        "conversation_id": 77,
        "user_id": 1,
    }
    doc_repo.create.return_value = {"id": "new-id"}
    _override_doc_repo(doc_repo)

    with patch(
        "app.routes.document._delete_remote_document", new_callable=AsyncMock
    ), patch(
        "app.routes.document._create_remote_document",
        new_callable=AsyncMock,
        return_value={"document_id": "new-id"},
    ):
        resp = client.post(
            "/admin/documents/11111111-1111-1111-1111-111111111111/replace",
            files={"file": ("img.png", b"x", "image/png")},
        )

    assert resp.status_code == status.HTTP_200_OK


def test_replace_repo_document_non_admin_403(client: TestClient) -> None:
    """Non-admins cannot replace a repository document file."""
    app.dependency_overrides[get_current_user] = lambda: NON_ADMIN_USER
    _override_doc_repo(AsyncMock())

    resp = client.post(
        "/admin/documents/11111111-1111-1111-1111-111111111111/replace",
        files={"file": ("a.pdf", b"x", "application/pdf")},
    )

    assert resp.status_code == status.HTTP_403_FORBIDDEN


# ── Delete ────────────────────────────────────────────────────────────


def test_delete_repo_document_returns_204(client: TestClient) -> None:
    """Deleting a repository document returns 204 (proxy delete mocked)."""
    _as_admin()
    repo = AsyncMock()
    repo.find_visible.return_value = {
        "id": "11111111-1111-1111-1111-111111111111",
        "name": "x.pdf",
    }
    repo.delete.return_value = {"changes": 1}
    _override_doc_repo(repo)

    with patch(
        "app.routes.document._delete_remote_document", new_callable=AsyncMock
    ):
        resp = client.delete(
            "/admin/documents/11111111-1111-1111-1111-111111111111"
        )

    assert resp.status_code == status.HTTP_204_NO_CONTENT


def test_delete_repo_document_not_found_returns_404(client: TestClient) -> None:
    """Deleting a missing document returns 404."""
    _as_admin()
    repo = AsyncMock()
    repo.find_visible.return_value = None
    _override_doc_repo(repo)

    resp = client.delete(
        "/admin/documents/11111111-1111-1111-1111-111111111111"
    )

    assert resp.status_code == status.HTTP_404_NOT_FOUND


# ── Upload ────────────────────────────────────────────────────────────


def test_upload_repo_document_returns_201(client: TestClient) -> None:
    """Uploading to the repository stores the file (no AI processing).

    The admin's hidden "repository conversation" is resolved/created and the
    document row inserted with status UPLOADED.
    """
    _as_admin()
    doc_repo = AsyncMock()
    _nothing_already_uploaded(doc_repo)
    doc_repo.create.return_value = {"id": "abc"}
    conv_repo = AsyncMock()
    conv_repo.find_repository_conversation.return_value = 77
    _override_doc_repo(doc_repo)
    _override_conv_repo(conv_repo)

    with patch(
        "app.routes.document._create_remote_document",
        new_callable=AsyncMock,
        return_value={"document_id": "abc"},
    ):
        resp = client.post(
            "/admin/documents/upload",
            files={"file": ("a.pdf", b"data", "application/pdf")},
        )

    assert resp.status_code == status.HTTP_201_CREATED
    # The document was inserted (no process call).
    doc_repo.create.assert_awaited()


def test_upload_repo_document_upstream_error_returns_502(
    client: TestClient,
) -> None:
    """A failed ingest upload surfaces as 502."""
    _as_admin()
    doc_repo = AsyncMock()
    _nothing_already_uploaded(doc_repo)
    conv_repo = AsyncMock()
    conv_repo.find_repository_conversation.return_value = 77
    _override_doc_repo(doc_repo)
    _override_conv_repo(conv_repo)

    with patch(
        "app.routes.document._create_remote_document",
        new_callable=AsyncMock,
        return_value={},  # no document_id
    ):
        resp = client.post(
            "/admin/documents/upload",
            files={"file": ("a.pdf", b"data", "application/pdf")},
        )

    assert resp.status_code == status.HTTP_502_BAD_GATEWAY


def test_upload_repo_document_non_admin_returns_403(client: TestClient) -> None:
    """Non-admins cannot upload to the repository."""
    app.dependency_overrides[get_current_user] = lambda: NON_ADMIN_USER
    _override_doc_repo(AsyncMock())
    _override_conv_repo(AsyncMock())

    resp = client.post(
        "/admin/documents/upload",
        files={"file": ("a.pdf", b"data", "application/pdf")},
    )

    assert resp.status_code == status.HTTP_403_FORBIDDEN


# ── Schema wiring ─────────────────────────────────────────────────────


def test_document_out_includes_doc_number_and_summary() -> None:
    """DocumentOut serializes the newly-wired doc_number/summary fields."""
    from app.models.schemas import DocumentOut

    out = DocumentOut(
        id="x",
        conversation_id=1,
        user_id=1,
        name="n.pdf",
        doc_number="ĐM-1",
        summary="tóm tắt",
    )
    dumped = out.model_dump()
    assert dumped["doc_number"] == "ĐM-1"
    assert dumped["summary"] == "tóm tắt"


# ── Repository conversation name helper (no hardcode) ─────────────────


def test_repository_conversation_name_helper() -> None:
    """The per-unit repository conversation name is built from ONE explicit
    helper (no scattered hardcoded strings). Upload and list must agree on it,
    so it lives in a single source of truth."""
    from app.repositories.postgres import (
        REPOSITORY_CONV_NAME,
        repository_conversation_name,
    )

    assert repository_conversation_name(4) == f"{REPOSITORY_CONV_NAME}u4"
    # Different units → different names; same unit → stable name.
    assert repository_conversation_name(4) != repository_conversation_name(5)
    assert repository_conversation_name(4) == repository_conversation_name(4)


# ── Story 34: (re)process a repository document + status in list ──────────


def test_process_repo_document_returns_200_and_processes(
    client: TestClient,
) -> None:
    """Admin reprocesses a stored repo doc → helper runs, status persisted."""
    _as_admin()
    doc_repo = AsyncMock()
    doc_repo.find_visible.return_value = {
        "id": "abc",
        "conversation_id": 77,
        "user_id": 1,
        "name": "07_bao_cao_quy.pdf",
        "status": "UPLOADED",
    }
    _override_doc_repo(doc_repo)

    with patch(
        "app.routes.document._process_remote_document",
        new_callable=AsyncMock,
        return_value={"status": "COMPLETED", "chunk_count": 5, "task_id": None},
    ):
        resp = client.post("/admin/documents/abc/process")

    assert resp.status_code == status.HTTP_200_OK
    # The shared story-21 helper persisted the new processing status.
    doc_repo.update.assert_awaited()
    persisted = doc_repo.update.await_args.args[2]
    assert persisted["status"] == "COMPLETED"
    assert persisted["chunk_count"] == 5


def test_process_repo_document_ai_error_sets_error_not_500(
    client: TestClient,
) -> None:
    """An AI-ingest failure is recorded as ERROR, never surfaced as 500."""
    _as_admin()
    doc_repo = AsyncMock()
    doc_repo.find_visible.return_value = {
        "id": "abc",
        "conversation_id": 77,
        "user_id": 1,
        "name": "x.pdf",
        "status": "UPLOADED",
    }
    _override_doc_repo(doc_repo)

    with patch(
        "app.routes.document._process_remote_document",
        new_callable=AsyncMock,
        side_effect=RuntimeError("ingest down"),
    ):
        resp = client.post("/admin/documents/abc/process")

    assert resp.status_code == status.HTTP_200_OK
    persisted = doc_repo.update.await_args.args[2]
    assert persisted["status"] == "ERROR"


def test_process_repo_document_not_found_returns_404(
    client: TestClient,
) -> None:
    _as_admin()
    doc_repo = AsyncMock()
    doc_repo.find_visible.return_value = None
    _override_doc_repo(doc_repo)

    resp = client.post("/admin/documents/missing/process")

    assert resp.status_code == status.HTTP_404_NOT_FOUND


def test_process_repo_document_non_admin_returns_403(
    client: TestClient,
) -> None:
    app.dependency_overrides[get_current_user] = lambda: NON_ADMIN_USER
    _override_doc_repo(AsyncMock())

    resp = client.post("/admin/documents/abc/process")

    assert resp.status_code == status.HTTP_403_FORBIDDEN


def test_list_repo_documents_includes_status(client: TestClient) -> None:
    """GET /admin/documents exposes each doc's processing status (story 34)."""
    _as_admin()
    repo = AsyncMock()
    repo.list_documents_by_unit.return_value = {
        "items": [
            {
                "id": "11111111-1111-1111-1111-111111111111",
                "name": "a.pdf",
                "doc_number": None,
                "summary": None,
                "group_id": None,
                "group_name": None,
                "created_at": None,
                "status": "UPLOADED",
            }
        ],
        "total": 1,
        "page": 1,
        "page_size": 15,
    }
    _override_doc_repo(repo)

    resp = client.get("/admin/documents", params={"page": 1, "page_size": 15})

    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["items"][0]["status"] == "UPLOADED"


def test_doc_repo_item_status_optional() -> None:
    """DocRepoItem accepts an optional status, defaulting to None (additive)."""
    from app.models.schemas import DocRepoItem

    assert DocRepoItem(id="x", name="a.pdf").status is None
    assert DocRepoItem(id="y", name="b.pdf", status="COMPLETED").status == "COMPLETED"
