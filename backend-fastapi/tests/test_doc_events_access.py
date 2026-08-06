"""The document-events SSE route authorizes differently from every other route,
and that is the whole problem.

``EventSource`` cannot set an ``Authorization`` header, so this route accepts
``?token=``. To do that it hand-rolled its auth: decode the JWT, compare
``decoded["id"]`` to the path ``user_id``, proxy. Everything the shared
dependency does after decoding — confirming the user still exists, is not
locked, and is not carrying a revoked token — was skipped, and the conversation
ownership check that every sibling route performs
(``conv_repo.find_visible(principal, conv_id)``) was never there at all.

A path parameter the caller chooses is not an authorization check: any
authenticated account could pass its OWN id as ``user_id`` and ANY conversation
id, and receive that conversation's live document pipeline.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.middlewares.auth import get_current_user_sse
from app.repositories.factory import get_conversation_repository

USER_ID = 7
OTHER_CONV_ID = 456


@pytest.fixture
def client() -> TestClient:
    with patch("app.main.init_db", new_callable=AsyncMock), patch(
        "app.main.close_db", new_callable=AsyncMock
    ):
        yield TestClient(app)
    app.dependency_overrides.clear()


def _authenticated_as(user_id: int = USER_ID) -> None:
    app.dependency_overrides[get_current_user_sse] = lambda: {
        "id": user_id,
        "username": "b",
        "unit_id": 1,
        "is_admin": False,
        "permissions": [],
    }


def _conversation_visibility(row) -> AsyncMock:
    conv_repo = AsyncMock()
    conv_repo.find_visible = AsyncMock(return_value=row)
    app.dependency_overrides[get_conversation_repository] = lambda: conv_repo
    return conv_repo


def _url(conv_id: int = OTHER_CONV_ID, user_id: int = USER_ID) -> str:
    return f"/users/{user_id}/conversations/{conv_id}/documents/events"


class _FakeUpstream:
    """BE's ``/documents/events`` is an endless stream; this ends."""

    status_code = 200

    def raise_for_status(self) -> None:
        return None

    async def aiter_lines(self):
        yield "event: snapshot"
        yield 'data: {"documents": []}'
        yield ""


def _stub_upstream():
    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=_FakeUpstream())
    cm.__aexit__ = AsyncMock(return_value=False)
    return patch("httpx.AsyncClient.stream", MagicMock(return_value=cm))


def test_a_conversation_the_caller_cannot_see_is_refused(client):
    """``find_visible`` returning None is the repository saying "not yours".

    The route must stop there — not merely fail to render, but never open the
    upstream stream, because the upstream is keyed on ``session_id=conv_id`` and
    would happily serve another tenant's frames.
    """
    _authenticated_as()
    conv_repo = _conversation_visibility(None)

    with patch("httpx.AsyncClient.stream") as upstream:
        resp = client.get(_url(), params={"token": "t"})

    assert resp.status_code == 404
    conv_repo.find_visible.assert_awaited_once()
    assert upstream.call_count == 0, "refused request still contacted the upstream"


def test_a_visible_conversation_is_proxied(client):
    """The guard must not break the feature it protects."""
    _authenticated_as()
    _conversation_visibility({"id": OTHER_CONV_ID, "user_id": USER_ID})

    with _stub_upstream():
        resp = client.get(_url(), params={"token": "t"})

    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")
    assert "snapshot" in resp.text


def test_a_token_belonging_to_a_different_user_than_the_path_is_refused(client):
    """Pre-existing guard, kept: the JWT subject must match the path user."""
    _authenticated_as(user_id=999)
    _conversation_visibility({"id": OTHER_CONV_ID, "user_id": 999})

    resp = client.get(_url(user_id=USER_ID), params={"token": "t"})

    assert resp.status_code == 403


# --- the dependency itself: the checks the hand-rolled version skipped --------


def _pool(row):
    """Patch ``get_pool`` so the dependency's single query returns ``row``."""
    conn = MagicMock()
    conn.fetchrow = AsyncMock(return_value=row)
    acquire = MagicMock()
    acquire.__aenter__ = AsyncMock(return_value=conn)
    acquire.__aexit__ = AsyncMock(return_value=False)
    pool = MagicMock()
    pool.acquire = MagicMock(return_value=acquire)
    return patch("app.middlewares.auth.get_pool", AsyncMock(return_value=pool))


def _request(token: str | None = None, header: str | None = None):
    req = MagicMock()
    req.headers = {"authorization": header} if header else {}
    req.query_params = {"token": token} if token else {}
    req.state = MagicMock()
    return req


def _row(*, token_version=0, lock_status=False):
    return {
        "token_version": token_version,
        "lock_status": lock_status,
        "unit_id": 1,
        "is_admin": False,
        "permissions": [],
    }


@pytest.mark.asyncio
async def test_the_token_may_arrive_as_a_query_parameter():
    """The reason this dependency exists at all."""
    with _pool(_row()), patch(
        "app.middlewares.auth._decode_token",
        return_value={"id": USER_ID, "username": "b", "token_version": 0},
    ):
        user = await get_current_user_sse(_request(token="t"))

    assert user["id"] == USER_ID
    assert user["unit_id"] == 1


@pytest.mark.asyncio
async def test_a_revoked_token_is_refused():
    """Forced logout bumps ``token_version``; a signature check alone misses it,
    so the old hand-rolled path kept serving logged-out sessions."""
    from fastapi import HTTPException

    with _pool(_row(token_version=3)), patch(
        "app.middlewares.auth._decode_token",
        return_value={"id": USER_ID, "username": "b", "token_version": 0},
    ):
        with pytest.raises(HTTPException) as err:
            await get_current_user_sse(_request(token="t"))

    assert err.value.status_code == 401


@pytest.mark.asyncio
async def test_a_locked_account_is_refused():
    from fastapi import HTTPException

    with _pool(_row(lock_status=True)), patch(
        "app.middlewares.auth._decode_token",
        return_value={"id": USER_ID, "username": "b", "token_version": 0},
    ):
        with pytest.raises(HTTPException) as err:
            await get_current_user_sse(_request(token="t"))

    assert err.value.status_code == 403


@pytest.mark.asyncio
async def test_a_request_carrying_no_token_at_all_is_refused():
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as err:
        await get_current_user_sse(_request())

    assert err.value.status_code == 401
