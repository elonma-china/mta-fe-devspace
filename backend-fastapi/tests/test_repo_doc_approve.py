# tests/test_repo_doc_approve.py
"""Story 48: POST /admin/documents/{id}/approve marks a repository document as
APPROVED ("Đã duyệt") — a manual admin review status.

Only a document that is already COMPLETED ("Đã số hoá", auto-digitized by story
46) may be approved; any other status is rejected (gate). Admin-scoped via
``find_visible`` (foreign doc → 404), mirroring the other admin repo routes.
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


def _doc(status: str = "COMPLETED") -> dict:
    return {
        "id": DOC_ID,
        "conversation_id": 999,
        "user_id": 1,
        "name": "kho.pdf",
        "status": status,
    }


def _override(doc_return):
    doc_repo = AsyncMock()
    doc_repo.find_visible = AsyncMock(return_value=doc_return)
    doc_repo.update = AsyncMock(return_value={"changes": 1})
    app.dependency_overrides[get_current_user] = lambda: _admin()
    app.dependency_overrides[get_document_repository] = lambda: doc_repo
    return doc_repo


def _clear() -> None:
    app.dependency_overrides.clear()


def test_approve_fromCompleted_setsApproved(client: TestClient) -> None:
    repo = _override(_doc("COMPLETED"))
    repo.find_visible = AsyncMock(
        side_effect=[_doc("COMPLETED"), _doc("APPROVED")]
    )
    resp = client.post(f"/admin/documents/{DOC_ID}/approve")
    assert resp.status_code == 200
    assert resp.json()["status"] == "APPROVED"
    repo.update.assert_awaited_once()
    assert repo.update.await_args.args[2]["status"] == "APPROVED"
    _clear()


def test_approve_fromProcessing_rejected(client: TestClient) -> None:
    repo = _override(_doc("PROCESSING"))
    resp = client.post(f"/admin/documents/{DOC_ID}/approve")
    assert resp.status_code == 409
    repo.update.assert_not_awaited()
    _clear()


def test_approve_fromError_rejected(client: TestClient) -> None:
    repo = _override(_doc("ERROR"))
    resp = client.post(f"/admin/documents/{DOC_ID}/approve")
    assert resp.status_code == 409
    repo.update.assert_not_awaited()
    _clear()


def test_approve_foreignUnit_returns404(client: TestClient) -> None:
    _override(None)
    resp = client.post(f"/admin/documents/{DOC_ID}/approve")
    assert resp.status_code == 404
    _clear()
