# tests/test_repo_doc_status.py
"""Story 46: GET /admin/documents/{id}/status syncs a repository document's
processing status from the AI ingest service.

The upload/reprocess flow kicks off an async Celery task on the AI ingest service
and stores ``PROCESSING`` + ``task_id`` immediately; nothing ever writes the final
status back, so the admin list stays stuck on "Đang xử lý". This endpoint reads
the upstream task (or document) status and, when terminal, writes COMPLETED/ERROR
back to Postgres. Idempotent: a doc already terminal returns without an upstream
call. Admin-scoped via ``find_visible`` (foreign doc → 404), mirroring the other
admin repo routes.
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


def _doc(status: str = "PROCESSING", task_id: str | None = "task-1") -> dict:
    return {
        "id": DOC_ID,
        "conversation_id": 999,
        "user_id": 1,
        "name": "kho.pdf",
        "status": status,
        "task_id": task_id,
        "chunk_count": 0,
    }


def _override(doc_return, update_mock=None):
    doc_repo = AsyncMock()
    doc_repo.find_visible = AsyncMock(return_value=doc_return)
    doc_repo.update = update_mock or AsyncMock()
    app.dependency_overrides[get_current_user] = lambda: _admin()
    app.dependency_overrides[get_document_repository] = lambda: doc_repo
    return doc_repo


def _clear() -> None:
    app.dependency_overrides.clear()


def test_status_taskSuccess_setsCompleted(client: TestClient) -> None:
    repo = _override(_doc(status="PROCESSING", task_id="t1"))
    # After update, find_visible returns the completed doc.
    repo.find_visible = AsyncMock(
        side_effect=[_doc("PROCESSING", "t1"), _doc("COMPLETED", "t1")]
    )
    with patch(
        "app.routes.document._read_remote_task_status",
        new_callable=AsyncMock,
        return_value="SUCCESS",
    ):
        resp = client.get(f"/admin/documents/{DOC_ID}/status")
    assert resp.status_code == 200
    assert resp.json()["status"] == "COMPLETED"
    repo.update.assert_awaited_once()
    assert repo.update.await_args.args[2]["status"] == "COMPLETED"
    _clear()


def test_status_taskFailure_setsError(client: TestClient) -> None:
    repo = _override(_doc("PROCESSING", "t1"))
    repo.find_visible = AsyncMock(
        side_effect=[_doc("PROCESSING", "t1"), _doc("ERROR", "t1")]
    )
    with patch(
        "app.routes.document._read_remote_task_status",
        new_callable=AsyncMock,
        return_value="FAILURE",
    ):
        resp = client.get(f"/admin/documents/{DOC_ID}/status")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ERROR"
    assert repo.update.await_args.args[2]["status"] == "ERROR"
    _clear()


def test_status_taskPending_keepsProcessing(client: TestClient) -> None:
    repo = _override(_doc("PROCESSING", "t1"))
    with patch(
        "app.routes.document._read_remote_task_status",
        new_callable=AsyncMock,
        return_value="PROCESSING",
    ):
        resp = client.get(f"/admin/documents/{DOC_ID}/status")
    assert resp.status_code == 200
    assert resp.json()["status"] == "PROCESSING"
    repo.update.assert_not_awaited()
    _clear()


def test_status_alreadyTerminal_noUpstreamCall(client: TestClient) -> None:
    repo = _override(_doc("COMPLETED", "t1"))
    with patch(
        "app.routes.document._read_remote_task_status",
        new_callable=AsyncMock,
    ) as task_mock:
        resp = client.get(f"/admin/documents/{DOC_ID}/status")
    assert resp.status_code == 200
    assert resp.json()["status"] == "COMPLETED"
    task_mock.assert_not_awaited()
    repo.update.assert_not_awaited()
    _clear()


def test_status_noTaskId_readsDocumentDetail(client: TestClient) -> None:
    repo = _override(_doc("PROCESSING", task_id=None))
    repo.find_visible = AsyncMock(
        side_effect=[_doc("PROCESSING", None), _doc("COMPLETED", None)]
    )
    with patch(
        "app.routes.document._fetch_remote_document_detail",
        new_callable=AsyncMock,
        return_value={"status": "COMPLETED"},
    ):
        resp = client.get(f"/admin/documents/{DOC_ID}/status")
    assert resp.status_code == 200
    assert resp.json()["status"] == "COMPLETED"
    assert repo.update.await_args.args[2]["status"] == "COMPLETED"
    _clear()


def test_status_upstreamError_keepsStatus(client: TestClient) -> None:
    repo = _override(_doc("PROCESSING", "t1"))
    with patch(
        "app.routes.document._read_remote_task_status",
        new_callable=AsyncMock,
        side_effect=Exception("boom"),
    ):
        resp = client.get(f"/admin/documents/{DOC_ID}/status")
    assert resp.status_code == 200
    assert resp.json()["status"] == "PROCESSING"
    repo.update.assert_not_awaited()
    _clear()


def test_status_foreignUnit_returns404(client: TestClient) -> None:
    _override(None)
    resp = client.get(f"/admin/documents/{DOC_ID}/status")
    assert resp.status_code == 404
    _clear()
