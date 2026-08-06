# tests/test_doc_page_char_spans.py
"""The viewer needs each page's own position in the chunk coordinate system.

A citation carries ``char_start``/``char_end`` measured in the *document's*
source text. The viewer renders one page, so it must subtract that page's own
start to know which characters to mark. Upstream publishes the page spans; this
gateway has to pass them through, and pass through the citation's own offsets
and its exact ``content`` alongside — matching text against the page is what
made highlighting unreliable in the first place.

Both are additive: an upstream that omits them yields ``None``, and the FE
falls back to text matching.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.middlewares.auth import get_current_user
from app.models.schemas import SourceItem
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


def _setup(detail: dict) -> None:
    conv_repo = AsyncMock()
    conv_repo.find_visible = AsyncMock(
        return_value={"id": CONV_ID, "user_id": USER_ID}
    )
    doc_repo = AsyncMock()
    doc_repo.find_visible = AsyncMock(
        return_value={
            "id": DOC_ID,
            "conversation_id": CONV_ID,
            "user_id": USER_ID,
            "name": "test.pdf",
        }
    )
    doc_repo.find_linked_repo_documents = AsyncMock(return_value=[])
    app.dependency_overrides[get_current_user] = lambda: {
        "id": USER_ID, "username": "u", "is_admin": False
    }
    app.dependency_overrides[get_conversation_repository] = lambda: conv_repo
    app.dependency_overrides[get_document_repository] = lambda: doc_repo


def _get_pages(client: TestClient, detail: dict):
    _setup(detail)
    with patch(
        "app.routes.document._fetch_remote_document_detail",
        new_callable=AsyncMock,
        return_value=detail,
    ):
        resp = client.get(
            f"/users/{USER_ID}/conversations/{CONV_ID}"
            f"/documents/{DOC_ID}/pages"
        )
    app.dependency_overrides.clear()
    return resp


def test_get_pages_forwards_char_spans(client: TestClient) -> None:
    """Upstream page spans reach the FE unchanged."""
    detail = {
        "name": "test.pdf",
        "page_count": 2,
        "pages": [
            {"page_number": 1, "page_content": "Trang 1",
             "char_start": 0, "char_end": 7},
            {"page_number": 2, "page_content": "Trang 2",
             "char_start": 9, "char_end": 16},
        ],
    }
    resp = _get_pages(client, detail)
    assert resp.status_code == 200
    pages = resp.json()["pages"]
    assert [(p["char_start"], p["char_end"]) for p in pages] == [
        (0, 7), (9, 16)
    ]


def test_get_pages_without_char_spans_stays_null(client: TestClient) -> None:
    """An upstream that predates page spans must not break the route."""
    detail = {
        "name": "test.pdf",
        "page_count": 1,
        "pages": [{"page_number": 1, "page_content": "Trang 1"}],
    }
    resp = _get_pages(client, detail)
    assert resp.status_code == 200
    page = resp.json()["pages"][0]
    assert page["char_start"] is None
    assert page["char_end"] is None
    assert page["content"] == "Trang 1"


def test_source_item_keeps_citation_offsets() -> None:
    """A stored citation keeps the offsets that let the viewer skip matching."""
    item = SourceItem(
        content="đoạn trích chính xác",
        enriched_content="ngữ cảnh rộng hơn",
        document_id=DOC_ID,
        char_start=1200,
        char_end=1400,
        metadata={"page_number": 3},
    )
    dumped = item.model_dump()
    assert dumped["char_start"] == 1200
    assert dumped["char_end"] == 1400
    assert dumped["content"] == "đoạn trích chính xác"


def test_source_item_offsets_are_optional() -> None:
    """Sources from before this change still validate."""
    item = SourceItem(enriched_content="x", document_id=DOC_ID)
    assert item.char_start is None
    assert item.char_end is None
