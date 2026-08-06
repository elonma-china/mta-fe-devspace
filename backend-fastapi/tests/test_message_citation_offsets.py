# tests/test_message_citation_offsets.py
"""A persisted citation must keep what the viewer needs to highlight it.

``add_message`` rebuilds each source by hand, and its rebuild collapsed
``content`` into ``enriched_content`` and kept nothing else. Both losses are
visible in the viewer:

- ``enriched_content`` is the retrieval *window* — the chunk plus its
  neighbours — so highlighting it marks far more than the passage the answer
  actually came from, frequently more than one page's worth.
- ``char_start``/``char_end`` locate the passage exactly; without them the
  viewer is left matching text against the digitized page, which fails on any
  OCR or markdown difference.

So the rebuild has to carry ``content`` and the offsets through as their own
fields, while still storing ``enriched_content`` for the wider preview.
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


@pytest.fixture
def client() -> TestClient:
    with patch("app.main.init_db", new_callable=AsyncMock), patch(
        "app.main.close_db", new_callable=AsyncMock
    ):
        return TestClient(app)


def _repo() -> AsyncMock:
    conv_repo = AsyncMock()
    conv_repo.find_visible = AsyncMock(return_value={"id": CONV_ID})
    conv_repo.get_data_source = AsyncMock(return_value={"messages": []})
    conv_repo.update_data_source = AsyncMock(return_value=None)
    app.dependency_overrides[get_current_user] = lambda: {
        "id": USER_ID, "username": "member", "is_admin": False, "unit_id": 7
    }
    app.dependency_overrides[get_conversation_repository] = lambda: conv_repo
    return conv_repo


def _patch(client: TestClient, source: dict):
    return client.patch(
        f"/users/{USER_ID}/conversations/{CONV_ID}/messages",
        json={"question": "q", "answer": "a", "sources": [source]},
    )


def _written(conv_repo: AsyncMock) -> dict:
    _, args, kwargs = conv_repo.update_data_source.mock_calls[0]
    ds = args[-1] if args else kwargs["ds"]
    return ds["messages"][-1]["sources"][0]


def test_add_message_keeps_content_and_offsets(client: TestClient) -> None:
    """The exact passage and its position survive persistence."""
    conv_repo = _repo()
    resp = _patch(client, {
        "content": "Điều 5. Nguyên tắc áp dụng.",
        "enriched_content": "…trang trước… Điều 5. Nguyên tắc áp dụng. …trang sau…",
        "document_id": "d1",
        "char_start": 1200,
        "char_end": 1227,
        "metadata": {"page_number": 3},
    })

    assert resp.status_code == 200
    for source in (
        resp.json()["data_source"]["messages"][-1]["sources"][0],
        _written(conv_repo),
    ):
        assert source["content"] == "Điều 5. Nguyên tắc áp dụng."
        assert source["char_start"] == 1200
        assert source["char_end"] == 1227
        # The wider window is still stored — it drives the preview text.
        assert source["enriched_content"].startswith("…trang trước…")
    app.dependency_overrides.clear()


def test_add_message_omits_absent_offsets(client: TestClient) -> None:
    """A source without offsets gains no null keys (matches existing style)."""
    conv_repo = _repo()
    resp = _patch(client, {
        "enriched_content": "plain content",
        "document_id": "d1",
        "metadata": {"page_number": 1},
    })

    assert resp.status_code == 200
    source = _written(conv_repo)
    assert "char_start" not in source
    assert "char_end" not in source
    assert "content" not in source
    assert source["enriched_content"] == "plain content"
    app.dependency_overrides.clear()


def test_add_message_keeps_content_only_source(client: TestClient) -> None:
    """A source with no window still stores its content under both keys.

    ``enriched_content`` stays populated because every existing reader — the
    stored-message renderer, the preview popover — reads that key.
    """
    conv_repo = _repo()
    resp = _patch(client, {
        "content": "chỉ có nội dung chunk",
        "document_id": "d1",
        "metadata": {"page_number": 2},
    })

    assert resp.status_code == 200
    source = _written(conv_repo)
    assert source["content"] == "chỉ có nội dung chunk"
    assert source["enriched_content"] == "chỉ có nội dung chunk"
    app.dependency_overrides.clear()


def test_add_message_still_drops_empty_sources(client: TestClient) -> None:
    """A source with neither content nor window is still skipped."""
    conv_repo = _repo()
    resp = _patch(client, {"document_id": "d1", "char_start": 5, "char_end": 9})

    assert resp.status_code == 200
    assert "sources" not in resp.json()["data_source"]["messages"][-1]
    app.dependency_overrides.clear()
