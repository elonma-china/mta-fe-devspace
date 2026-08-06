# tests/test_repo_search.py
"""Tests for chat-side repository SEMANTIC search (story 107).

The repository picker search (``POST /repository/documents/search``) matches a
query against BOTH the document NAME (a filename substring computed here on the
caller's candidate list) and the document CONTENT (the AI ``/search/documents``
endpoint — top-k distinct documents grouped on the chunk index). Results are the
union (name hits first, then content-ranked), de-duplicated by id, and
intersected with the caller's own unit repository so a foreign id from the AI can
never leak. Scope uses the same ``_resolve_repo_unit`` rule as the list route.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.middlewares.auth import get_current_user
from app.repositories.factory import get_document_repository
from app.routes.document import (
    _parse_search_document_ids,
    _search_remote_documents,
)

USER_ID = 50
UNIT_ID = 7
DOC_A = "aaaaaaaa-0000-0000-0000-000000000001"
DOC_B = "bbbbbbbb-0000-0000-0000-000000000002"
DOC_C = "cccccccc-0000-0000-0000-000000000003"
FOREIGN = "ffffffff-0000-0000-0000-000000000009"

SEARCH_URL = "/repository/documents/search"


@pytest.fixture
def client() -> TestClient:
    with patch("app.main.init_db", new_callable=AsyncMock), patch(
        "app.main.close_db", new_callable=AsyncMock
    ):
        return TestClient(app)


def _user(is_admin: bool = False, unit_id: int | None = UNIT_ID) -> dict:
    return {
        "id": USER_ID,
        "username": "member",
        "is_admin": is_admin,
        "unit_id": unit_id,
    }


def _repo(candidates: list[dict]) -> AsyncMock:
    doc_repo = AsyncMock()
    doc_repo.list_unit_repository_for_user = AsyncMock(
        return_value={"groups": [], "documents": candidates}
    )
    return doc_repo


def _clear() -> None:
    app.dependency_overrides.clear()


# ── Route: name + content merge, dedupe, intersect (security) ────────────


def test_search_intersects_and_drops_foreign(client: TestClient) -> None:
    """An AI id outside the caller's candidates is dropped (no cross-unit leak)."""
    doc_repo = _repo(
        [
            {"id": DOC_A, "name": "Bao cao tai chinh Q3.pdf", "group_id": None},
            {"id": DOC_B, "name": "Ke hoach 2026.pdf", "group_id": 1},
        ]
    )
    app.dependency_overrides[get_current_user] = lambda: _user()
    app.dependency_overrides[get_document_repository] = lambda: doc_repo
    with patch(
        "app.routes.document._search_remote_documents",
        new_callable=AsyncMock,
        return_value=[DOC_B, FOREIGN],
    ):
        resp = client.post(SEARCH_URL, json={"query": "khongkhoptennao"})
    assert resp.status_code == 200
    ids = [d["id"] for d in resp.json()["documents"]]
    assert ids == [DOC_B]  # FOREIGN dropped; name did not match either
    _clear()


def test_search_name_match_included(client: TestClient) -> None:
    """A filename match surfaces even if the AI content search returns nothing."""
    doc_repo = _repo(
        [
            {"id": DOC_A, "name": "Bao cao tai chinh Q3.pdf", "group_id": None},
            {"id": DOC_B, "name": "Ke hoach 2026.pdf", "group_id": None},
        ]
    )
    app.dependency_overrides[get_current_user] = lambda: _user()
    app.dependency_overrides[get_document_repository] = lambda: doc_repo
    with patch(
        "app.routes.document._search_remote_documents",
        new_callable=AsyncMock,
        return_value=[],
    ):
        resp = client.post(SEARCH_URL, json={"query": "tai chinh"})
    assert resp.status_code == 200
    assert [d["id"] for d in resp.json()["documents"]] == [DOC_A]
    _clear()


def test_search_content_match_included(client: TestClient) -> None:
    """A semantic content hit surfaces even if the name does not match."""
    doc_repo = _repo(
        [
            {"id": DOC_A, "name": "Bao cao tai chinh Q3.pdf", "group_id": None},
            {"id": DOC_B, "name": "Ke hoach 2026.pdf", "group_id": None},
        ]
    )
    app.dependency_overrides[get_current_user] = lambda: _user()
    app.dependency_overrides[get_document_repository] = lambda: doc_repo
    with patch(
        "app.routes.document._search_remote_documents",
        new_callable=AsyncMock,
        return_value=[DOC_B],
    ):
        resp = client.post(SEARCH_URL, json={"query": "ngan sach"})
    assert resp.status_code == 200
    assert [d["id"] for d in resp.json()["documents"]] == [DOC_B]
    _clear()


def test_search_merge_order_and_dedupe(client: TestClient) -> None:
    """Name hits come first, then AI content order; duplicates appear once."""
    doc_repo = _repo(
        [
            {"id": DOC_A, "name": "Bao cao ke hoach.pdf", "group_id": None},
            {"id": DOC_B, "name": "Tai lieu B.pdf", "group_id": None},
            {"id": DOC_C, "name": "Tai lieu C.pdf", "group_id": None},
        ]
    )
    app.dependency_overrides[get_current_user] = lambda: _user()
    app.dependency_overrides[get_document_repository] = lambda: doc_repo
    with patch(
        "app.routes.document._search_remote_documents",
        new_callable=AsyncMock,
        return_value=[DOC_C, DOC_A],  # DOC_A also a name hit → must dedupe
    ):
        resp = client.post(SEARCH_URL, json={"query": "ke hoach"})
    assert resp.status_code == 200
    assert [d["id"] for d in resp.json()["documents"]] == [DOC_A, DOC_C]
    _clear()


def test_search_ai_empty_keeps_name_hits(client: TestClient) -> None:
    """When the AI content search yields nothing (e.g. it was down), name hits
    are still returned — search degrades partially, never fully."""
    doc_repo = _repo(
        [{"id": DOC_A, "name": "Bao cao tai chinh.pdf", "group_id": None}]
    )
    app.dependency_overrides[get_current_user] = lambda: _user()
    app.dependency_overrides[get_document_repository] = lambda: doc_repo
    with patch(
        "app.routes.document._search_remote_documents",
        new_callable=AsyncMock,
        return_value=[],
    ):
        resp = client.post(SEARCH_URL, json={"query": "tai chinh"})
    assert resp.status_code == 200
    assert [d["id"] for d in resp.json()["documents"]] == [DOC_A]
    _clear()


# ── Route: scope resolution (mirrors list route) ────────────────────────


def test_search_superadmin_without_unit_returns_400(client: TestClient) -> None:
    doc_repo = AsyncMock()
    app.dependency_overrides[get_current_user] = lambda: _user(
        is_admin=True, unit_id=None
    )
    app.dependency_overrides[get_document_repository] = lambda: doc_repo
    resp = client.post(SEARCH_URL, json={"query": "x"})
    assert resp.status_code == 400
    _clear()


def test_search_non_super_foreign_unit_returns_403(client: TestClient) -> None:
    doc_repo = AsyncMock()
    app.dependency_overrides[get_current_user] = lambda: _user(unit_id=7)
    app.dependency_overrides[get_document_repository] = lambda: doc_repo
    resp = client.post(SEARCH_URL, json={"query": "x", "unit_id": 9})
    assert resp.status_code == 403
    _clear()


def test_search_superadmin_with_unit_scopes_to_it(client: TestClient) -> None:
    doc_repo = _repo([])
    app.dependency_overrides[get_current_user] = lambda: _user(
        is_admin=True, unit_id=None
    )
    app.dependency_overrides[get_document_repository] = lambda: doc_repo
    with patch(
        "app.routes.document._search_remote_documents",
        new_callable=AsyncMock,
        return_value=[],
    ):
        resp = client.post(SEARCH_URL, json={"query": "x", "unit_id": 5})
    assert resp.status_code == 200
    _, kwargs = doc_repo.list_unit_repository_for_user.await_args
    assert kwargs.get("target_unit_id") == 5
    _clear()


# ── Helper: tolerant response parser ────────────────────────────────────


def test_parse_search_document_ids_accepts_bare_list() -> None:
    assert _parse_search_document_ids(["d1", "d2"]) == ["d1", "d2"]


def test_parse_search_document_ids_accepts_list_of_objects() -> None:
    data = [{"document_id": "d1"}, {"id": "d2"}, {"doc_id": "d3"}]
    assert _parse_search_document_ids(data) == ["d1", "d2", "d3"]


def test_parse_search_document_ids_accepts_wrapped_dict() -> None:
    assert _parse_search_document_ids(
        {"results": [{"document_id": "d1"}]}
    ) == ["d1"]
    assert _parse_search_document_ids({"documents": ["d2"]}) == ["d2"]


def test_parse_search_document_ids_ignores_garbage() -> None:
    assert _parse_search_document_ids(None) == []
    assert _parse_search_document_ids(123) == []
    assert _parse_search_document_ids({"nope": 1}) == []


# ── Helper: AI call (mock httpx) ────────────────────────────────────────


class _FakeResp:
    def __init__(self, data: object) -> None:
        self._data = data

    def json(self) -> object:
        return self._data

    def raise_for_status(self) -> None:
        return None


class _FakeClient:
    last: dict = {}

    def __init__(self, resp: object = None, exc: Exception | None = None) -> None:
        self._resp = resp
        self._exc = exc

    async def __aenter__(self) -> "_FakeClient":
        return self

    async def __aexit__(self, *a: object) -> bool:
        return False

    async def post(self, url: str, json=None, headers=None):  # type: ignore[no-untyped-def]
        _FakeClient.last = {"url": url, "json": json, "headers": headers}
        if self._exc:
            raise self._exc
        return self._resp


def test_search_remote_documents_builds_request(monkeypatch) -> None:
    fake = _FakeClient(
        resp=_FakeResp({"results": [{"document_id": "d1"}, {"document_id": "d2"}]})
    )
    monkeypatch.setattr(
        "app.routes.document.httpx.AsyncClient", lambda *a, **k: fake
    )
    monkeypatch.setattr(
        "app.routes.document.settings.llm_api_key", "secret", raising=False
    )
    ids = asyncio.run(
        _search_remote_documents("hello", ["d1", "d2", "d3"], 20)
    )
    assert ids == ["d1", "d2"]
    assert _FakeClient.last["url"].endswith("/search/documents")
    assert _FakeClient.last["json"] == {
        "query": "hello",
        "top_k": 20,
        "document_ids": ["d1", "d2", "d3"],
    }
    assert _FakeClient.last["headers"]["Authorization"] == "Bearer secret"


def test_search_remote_documents_error_returns_empty(monkeypatch) -> None:
    fake = _FakeClient(exc=httpx.ConnectError("boom"))
    monkeypatch.setattr(
        "app.routes.document.httpx.AsyncClient", lambda *a, **k: fake
    )
    ids = asyncio.run(_search_remote_documents("hello", ["d1"], 20))
    assert ids == []
