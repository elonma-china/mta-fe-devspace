# tests/test_message_context_metadata.py
"""Cross-page citation fix (page_segments) must survive persistence.

The AI service now ships `context_metadata.page_segments` on a source when its
enriched window spans more than one PDF page (see mta-ai-intramind's
WindowContextEnricher). Before this fix, `SourceItem` had no `context_metadata`
field and `add_message()`'s manual dict rebuild dropped any field beyond
`enriched_content`/`content`/`document_id`/`metadata` — so the multi-page
highlight worked for the live SSE stream but silently vanished the moment the
message was persisted and the conversation reloaded.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.middlewares.auth import get_current_user
from app.repositories.factory import get_conversation_repository

USER_ID = 50
CONV_ID = 900

PAGE_SEGMENTS = [
    {"page_number": 6, "text": "đoạn cuối trang 6"},
    {"page_number": 7, "text": "Việt Nam ở đầu trang 7"},
]


@pytest.fixture
def client() -> TestClient:
    with patch("app.main.init_db", new_callable=AsyncMock), patch(
        "app.main.close_db", new_callable=AsyncMock
    ):
        return TestClient(app)


def _user() -> dict:
    return {"id": USER_ID, "username": "member", "is_admin": False, "unit_id": 7}


def _clear() -> None:
    app.dependency_overrides.clear()


def test_add_message_with_page_segments_round_trips(client: TestClient) -> None:
    """context_metadata.page_segments survives SourceItem validation + the
    add_message dict rebuild — proven via the same ds object the route
    returns (what get_data_source would return on the next GET)."""
    conv_repo = AsyncMock()
    conv_repo.find_visible = AsyncMock(return_value={"id": CONV_ID})
    conv_repo.get_data_source = AsyncMock(return_value={"messages": []})
    conv_repo.update_data_source = AsyncMock(return_value=None)
    app.dependency_overrides[get_current_user] = lambda: _user()
    app.dependency_overrides[get_conversation_repository] = lambda: conv_repo

    resp = client.patch(
        f"/users/{USER_ID}/conversations/{CONV_ID}/messages",
        json={
            "question": "Việt Nam ở đâu?",
            "answer": "Ở trang 6-7.",
            "sources": [
                {
                    "enriched_content": "đoạn cuối trang 6 Việt Nam ở đầu trang 7",
                    "document_id": "d1",
                    "metadata": {"page_number": 6},
                    "context_metadata": {"page_segments": PAGE_SEGMENTS},
                }
            ],
        },
    )

    assert resp.status_code == 200
    persisted_source = resp.json()["data_source"]["messages"][-1]["sources"][0]
    assert persisted_source["context_metadata"] == {"page_segments": PAGE_SEGMENTS}

    # The dict actually handed to update_data_source (what gets written to
    # storage) must carry it too — not just the route's echoed response.
    _, args, kwargs = conv_repo.update_data_source.mock_calls[0]
    written_ds = args[-1] if args else kwargs["ds"]
    written_source = written_ds["messages"][-1]["sources"][0]
    assert written_source["context_metadata"] == {"page_segments": PAGE_SEGMENTS}
    _clear()


def test_add_message_without_context_metadata_omits_key(client: TestClient) -> None:
    """A source with no context_metadata must not gain a spurious null key
    (keeps old/simple messages lean, matches existing metadata-omission style)."""
    conv_repo = AsyncMock()
    conv_repo.find_visible = AsyncMock(return_value={"id": CONV_ID})
    conv_repo.get_data_source = AsyncMock(return_value={"messages": []})
    conv_repo.update_data_source = AsyncMock(return_value=None)
    app.dependency_overrides[get_current_user] = lambda: _user()
    app.dependency_overrides[get_conversation_repository] = lambda: conv_repo

    resp = client.patch(
        f"/users/{USER_ID}/conversations/{CONV_ID}/messages",
        json={
            "question": "q",
            "answer": "a",
            "sources": [
                {
                    "enriched_content": "plain content",
                    "document_id": "d1",
                    "metadata": {"page_number": 1},
                }
            ],
        },
    )

    assert resp.status_code == 200
    persisted_source = resp.json()["data_source"]["messages"][-1]["sources"][0]
    assert "context_metadata" not in persisted_source
    _clear()
