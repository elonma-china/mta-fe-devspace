"""Directive-review proxy routes and schema constraint."""

import io
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.middlewares.auth import get_current_user
from app.models.orm import InfoTable
from app.repositories.factory import (
    get_conversation_repository,
    get_info_table_repository,
)


def test_info_table_allows_directive_review_type():
    """The CHECK constraint must permit the directive_review item type."""
    checks = [
        c for c in InfoTable.__table__.constraints
        if getattr(c, "name", None) == "info_table_type_check"
    ]
    assert checks, "info_table_type_check constraint not found"
    sqltext = str(checks[0].sqltext)
    assert "directive_review" in sqltext
    # The three existing types must survive.
    for existing in ("summary", "mindmap", "report"):
        assert existing in sqltext


# ── App-level VALID_TYPES allow-list (create-info-table route) ──────
#
# The DB CHECK constraint was widened to accept 'directive_review', but
# the route's own VALID_TYPES allow-list (app/routes/info_table.py)
# still rejects it with a 400 before the request reaches the database.


@pytest.fixture
def client() -> TestClient:
    """Create a test client with mocked db lifespan."""
    with patch("app.main.init_db", new_callable=AsyncMock), patch(
        "app.main.close_db", new_callable=AsyncMock
    ):
        return TestClient(app)


def _override_info_table_repos(conv_return, created_item) -> None:
    """Override the conversation/info-table repository dependencies."""
    conv_repo = AsyncMock()
    conv_repo.find_visible = AsyncMock(return_value=conv_return)
    info_repo = AsyncMock()
    info_repo.create = AsyncMock(return_value=created_item)
    app.dependency_overrides[get_conversation_repository] = lambda: conv_repo
    app.dependency_overrides[get_info_table_repository] = lambda: info_repo


def _clear_overrides() -> None:
    app.dependency_overrides.clear()


def test_create_info_table_directive_review_type_not_rejected(
    client: TestClient,
) -> None:
    """Creating an info-table row with type='directive_review' must not be
    rejected by the app-level VALID_TYPES allow-list with a 400. Regression
    guard for the fourth (missed) declaration site of the allowed types."""
    user_id = 123
    conv_id = 456

    mock_user = {"id": user_id, "username": "testuser", "is_admin": False}
    mock_conv = {"id": conv_id, "user_id": user_id}
    created_item = {
        "id": "11111111-2222-3333-4444-555555555555",
        "conversation_id": conv_id,
        "type": "directive_review",
        "name": "Directive Review",
        "content": None,
        "selected": None,
        "status": "PENDING",
        "task_id": None,
    }

    app.dependency_overrides[get_current_user] = lambda: mock_user
    _override_info_table_repos(mock_conv, created_item)

    with patch("app.routes.info_table.audit_log"):
        resp = client.post(
            f"/users/{user_id}/conversations/{conv_id}/info-tables",
            json={"type": "directive_review", "name": "Directive Review"},
        )

    _clear_overrides()

    assert resp.status_code != 400, resp.text
    assert resp.status_code == 200, resp.text
    assert resp.json()["info"]["type"] == "directive_review"


# ── Directive-review proxy routes (multipart submit + DOCX export) ──
#
# NOTE: this module already defines a `client` fixture above (used by the
# info-table test) that does not override get_current_user. These new tests
# need an authenticated client, so they get their own fixture — `dr_client`
# — rather than redefining `client` (which would silently shadow the
# existing fixture, since two same-named module-level fixtures collapse to
# whichever is defined last).


@pytest.fixture
def dr_client() -> TestClient:
    """Authenticated test client for the directive-review proxy routes."""
    with patch("app.main.init_db", new_callable=AsyncMock), patch(
        "app.main.close_db", new_callable=AsyncMock
    ):
        app.dependency_overrides[get_current_user] = lambda: {
            "id": 1,
            "username": "tester",
            "role_id": 2,
            "unit_id": 1,
            "is_admin": False,
        }
        yield TestClient(app)
        app.dependency_overrides.clear()


class _FakeResponse:
    def __init__(self, status_code=200, json_body=None, content=b"", headers=None):
        self.status_code = status_code
        self._json = json_body if json_body is not None else {}
        self.content = content
        self.headers = headers or {}
        self.text = "" if json_body is None else __import__("json").dumps(json_body)

    def json(self):
        return self._json


def test_directive_review_submit_forwards_multipart(dr_client):
    """The draft file and payload must reach the AI service as multipart,
    not JSON — the generic tool proxy cannot do this."""
    captured = {}

    async def fake_post(url, files=None, data=None, headers=None):
        captured["url"] = url
        captured["files"] = files
        captured["data"] = data
        return _FakeResponse(json_body={"task_id": "task-123", "status": "submitted"})

    with patch("httpx.AsyncClient") as mock_cls:
        mock_cls.return_value.__aenter__.return_value.post = AsyncMock(side_effect=fake_post)
        resp = dr_client.post(
            "/tools/directive-review",
            files={"file": ("draft.docx", io.BytesIO(b"PK\x03\x04fake"),
                            "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
            data={"payload": '{"reference_document_ids":["d1","d2"],"options":{}}'},
        )

    assert resp.status_code == 200
    assert resp.json()["task_id"] == "task-123"
    assert captured["url"].endswith("/tools/directive-review")
    assert "file" in captured["files"]
    assert captured["data"]["payload"] == '{"reference_document_ids":["d1","d2"],"options":{}}'


def test_directive_review_submit_rejects_non_docx(dr_client):
    """Reject before spending an upstream round-trip."""
    resp = dr_client.post(
        "/tools/directive-review",
        files={"file": ("draft.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
        data={"payload": '{"reference_document_ids":["d1"],"options":{}}'},
    )
    assert resp.status_code == 400
    assert "docx" in resp.json()["detail"].lower()


def test_directive_review_export_streams_docx(dr_client):
    """Export returns the upstream bytes with the DOCX media type."""
    docx_bytes = b"PK\x03\x04docx-body"

    async def fake_post(url, json=None, headers=None):
        return _FakeResponse(
            content=docx_bytes,
            headers={
                "content-disposition": 'attachment; filename="review.docx"',
                "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            },
        )

    with patch("httpx.AsyncClient") as mock_cls:
        mock_cls.return_value.__aenter__.return_value.post = AsyncMock(side_effect=fake_post)
        resp = dr_client.post(
            "/tools/directive-review/export",
            json={"report_markdown": "# Báo cáo", "filename": "review"},
        )

    assert resp.status_code == 200
    assert resp.content == docx_bytes
    assert "wordprocessingml" in resp.headers["content-type"]
