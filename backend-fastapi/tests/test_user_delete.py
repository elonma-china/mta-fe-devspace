# tests/test_user_delete.py
"""Tests for deleting a user cleanly (story 108).

Deleting a user used to 500 (FK ``document.user_id`` NO ACTION) or silently wipe a
unit's repository (FK ``conversation.user_id`` CASCADE on the hidden repo
conversation the user happened to own). The fix, in ONE transaction, BEFORE
deleting the user: (1) reassign repo (unit) conversations they own → a surviving
admin (id 1) so the shared unit repository survives; (2) delete the documents the
user uploaded (clean data + clears the NO ACTION FK); (3) delete the user (personal
conversations + read-marks cascade). A ``delete-impact`` endpoint feeds a warning.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError

from app.main import app
from app.middlewares.auth import require_admin
from app.repositories.factory import get_user_repository
from app.repositories.postgres import SqlAlchemyUserRepository

TARGET_ID = 5


@pytest.fixture
def client() -> TestClient:
    with patch("app.main.init_db", new_callable=AsyncMock), patch(
        "app.main.close_db", new_callable=AsyncMock
    ):
        return TestClient(app)


def _admin() -> dict:
    return {"id": 1, "username": "admin", "is_admin": True, "unit_id": None}


def _clear() -> None:
    app.dependency_overrides.clear()


# ── Route: delete-impact (warning source) ───────────────────────────────


def test_delete_impact_returns_summary(client: TestClient) -> None:
    repo = AsyncMock()
    repo.find_visible = AsyncMock(return_value={"id": TARGET_ID})
    repo.delete_impact = AsyncMock(
        return_value={
            "documents": 3,
            "conversations": 2,
            "owns_repo_units": ["Đơn vị A"],
        }
    )
    app.dependency_overrides[require_admin] = _admin
    app.dependency_overrides[get_user_repository] = lambda: repo

    resp = client.get(f"/users/{TARGET_ID}/delete-impact")
    assert resp.status_code == 200
    body = resp.json()
    assert body["documents"] == 3
    assert body["conversations"] == 2
    assert body["owns_repo_units"] == ["Đơn vị A"]
    _clear()


def test_delete_impact_not_found_404(client: TestClient) -> None:
    repo = AsyncMock()
    repo.find_visible = AsyncMock(return_value=None)
    app.dependency_overrides[require_admin] = _admin
    app.dependency_overrides[get_user_repository] = lambda: repo

    resp = client.get(f"/users/{TARGET_ID}/delete-impact")
    assert resp.status_code == 404
    _clear()


# ── Route: delete user (success + defensive 409) ────────────────────────


def test_delete_user_success(client: TestClient) -> None:
    repo = AsyncMock()
    repo.find_visible = AsyncMock(return_value={"id": TARGET_ID})
    repo.delete = AsyncMock(return_value={"changes": 1})
    app.dependency_overrides[require_admin] = _admin
    app.dependency_overrides[get_user_repository] = lambda: repo

    resp = client.delete(f"/users/{TARGET_ID}")
    assert resp.status_code == 200
    assert resp.json()["success"] is True
    repo.delete.assert_awaited_once_with(TARGET_ID)
    _clear()


def test_delete_user_integrity_error_maps_409(client: TestClient) -> None:
    """A residual FK conflict surfaces as a clear 409, never a bare 500."""
    repo = AsyncMock()
    repo.find_visible = AsyncMock(return_value={"id": TARGET_ID})
    repo.delete = AsyncMock(
        side_effect=IntegrityError("stmt", {}, Exception("fk"))
    )
    app.dependency_overrides[require_admin] = _admin
    app.dependency_overrides[get_user_repository] = lambda: repo

    resp = client.delete(f"/users/{TARGET_ID}")
    assert resp.status_code == 409
    _clear()


def test_delete_user_not_found_404(client: TestClient) -> None:
    repo = AsyncMock()
    repo.find_visible = AsyncMock(return_value=None)
    app.dependency_overrides[require_admin] = _admin
    app.dependency_overrides[get_user_repository] = lambda: repo

    resp = client.delete(f"/users/{TARGET_ID}")
    assert resp.status_code == 404
    _clear()


# ── Repo impl: delete = reassign repo-conv → delete docs → delete user ──


class _Result:
    def __init__(self, rowcount: int = 1) -> None:
        self.rowcount = rowcount


class _FakeSession:
    """Records statements so we can assert the delete ORDER without a real DB."""

    def __init__(self, raise_on: int | None = None) -> None:
        self.executed: list = []
        self.committed = False
        self.rolled_back = False
        self._raise_on = raise_on

    async def execute(self, stmt):  # type: ignore[no-untyped-def]
        idx = len(self.executed)
        self.executed.append(stmt)
        if self._raise_on is not None and idx == self._raise_on:
            raise IntegrityError("stmt", {}, Exception("boom"))
        return _Result(rowcount=1)

    async def commit(self) -> None:
        self.committed = True

    async def rollback(self) -> None:
        self.rolled_back = True


def _op(stmt) -> str:
    return type(stmt).__name__


def test_repo_delete_reassigns_repo_conv_then_deletes(monkeypatch) -> None:
    session = _FakeSession()
    repo = SqlAlchemyUserRepository(session)  # type: ignore[arg-type]
    out = asyncio.run(repo.delete(TARGET_ID))

    assert out == {"changes": 1}
    assert session.committed is True
    # 1) reassign the unit-repository conversations the user owns (protect kho),
    assert _op(session.executed[0]) == "Update"
    assert session.executed[0].table.name == "conversation"
    # 2) delete the documents the user uploaded (clean + clears NO ACTION FK),
    assert _op(session.executed[1]) == "Delete"
    assert session.executed[1].table.name == "document"
    # 3) delete the user (personal conversations + read-marks cascade).
    assert _op(session.executed[2]) == "Delete"
    assert session.executed[2].table.name == "user"


def test_repo_delete_self_fallback_skips_reassign() -> None:
    """Deleting the fallback owner (id 1) skips the reassign-to-self step."""
    session = _FakeSession()
    repo = SqlAlchemyUserRepository(session)  # type: ignore[arg-type]
    asyncio.run(repo.delete(1))
    # No conversation reassign (would be a no-op to self); only doc + user delete.
    assert [_op(s) for s in session.executed] == ["Delete", "Delete"]
    assert session.executed[0].table.name == "document"
    assert session.executed[1].table.name == "user"


def test_repo_delete_integrity_error_rolls_back() -> None:
    session = _FakeSession(raise_on=2)  # fail on the user delete
    repo = SqlAlchemyUserRepository(session)  # type: ignore[arg-type]
    with pytest.raises(IntegrityError):
        asyncio.run(repo.delete(TARGET_ID))
    assert session.rolled_back is True
    assert session.committed is False
