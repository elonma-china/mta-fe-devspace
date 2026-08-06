# tests/test_user.py
"""Tests for user creation and update validation safeguards."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import status
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError

from app.constants.errors import ErrorMessages
from app.main import app
from app.middlewares.auth import get_current_user
from app.repositories.factory import get_user_repository
from app.repositories.postgres import SqlAlchemyUserRepository


@pytest.fixture
def client() -> TestClient:
    """Create a test client with mocked db lifespan.

    Returns:
        TestClient: The FastAPI test client.
    """
    with patch("app.main.init_db", new_callable=AsyncMock), patch(
        "app.main.close_db", new_callable=AsyncMock
    ):
        return TestClient(app)


def test_create_user_empty_unit_name_raises_bad_request(
    client: TestClient,
) -> None:
    """Verify that creating a user with empty unit details raises 400."""
    admin_user = {"id": 1, "username": "admin", "is_admin": True, "unit_id": 1}
    app.dependency_overrides[get_current_user] = lambda: admin_user

    mock_repo = AsyncMock()
    mock_repo.create.side_effect = ValueError(ErrorMessages.UNIT_REQUIRED)
    app.dependency_overrides[get_user_repository] = lambda: mock_repo

    payload = {
        "name": "Test User",
        "username": "testuser",
        "password": "password",
        "unit_id": None,
        "unit_name": "   ",
        "role_id": 2,
    }
    resp = client.post("/users", json=payload)
    assert resp.status_code == status.HTTP_400_BAD_REQUEST
    assert resp.json()["detail"] == ErrorMessages.UNIT_REQUIRED

    app.dependency_overrides.clear()


def test_update_user_empty_unit_name_raises_bad_request(
    client: TestClient,
) -> None:
    """Verify that updating a user with empty unit name raises 400."""
    admin_user = {"id": 1, "username": "admin", "is_admin": True, "unit_id": 1}
    app.dependency_overrides[get_current_user] = lambda: admin_user

    mock_repo = AsyncMock()
    mock_repo.find_visible = AsyncMock(return_value={"id": 2, "name": "User"})
    mock_repo.update.side_effect = ValueError(ErrorMessages.UNIT_REQUIRED)
    app.dependency_overrides[get_user_repository] = lambda: mock_repo

    payload = {
        "unit_name": "   ",
    }
    resp = client.put("/users/2", json=payload)
    assert resp.status_code == status.HTTP_400_BAD_REQUEST
    assert resp.json()["detail"] == ErrorMessages.UNIT_REQUIRED

    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_repository_create_no_unit_raises_value_error() -> None:
    """Verify that SqlAlchemyUserRepository.create raises ValueError when no unit is set."""
    mock_session = AsyncMock()
    repo = SqlAlchemyUserRepository(mock_session)

    data = {
        "name": "Test User",
        "username": "testuser",
        "password": "password",
        "unit_id": None,
        "unit_name": "   ",
    }

    with pytest.raises(ValueError, match=ErrorMessages.UNIT_REQUIRED):
        await repo.create(data)


@pytest.mark.asyncio
async def test_repository_update_no_unit_raises_value_error() -> None:
    """Verify that SqlAlchemyUserRepository.update raises ValueError when unit is set to None."""
    mock_session = AsyncMock()
    repo = SqlAlchemyUserRepository(mock_session)

    data = {
        "unit_name": "   ",
    }

    with pytest.raises(ValueError, match=ErrorMessages.UNIT_REQUIRED):
        await repo.update(2, data)


def _username_unique_violation() -> IntegrityError:
    """Build the IntegrityError Postgres raises on a duplicate username."""
    orig = Exception(
        'duplicate key value violates unique constraint "user_username_key"'
    )
    return IntegrityError("UPDATE \"user\" ...", {}, orig)


@pytest.mark.asyncio
async def test_repository_update_duplicate_username_raises_value_error() -> None:
    """Story 85: a duplicate username on update must surface as a clean
    ValueError(USERNAME_TAKEN), not bubble the raw IntegrityError into a 500."""
    mock_session = AsyncMock()
    # The UPDATE statement hits the unique-username constraint.
    mock_session.execute.side_effect = _username_unique_violation()
    repo = SqlAlchemyUserRepository(mock_session)

    with pytest.raises(ValueError, match=ErrorMessages.USERNAME_TAKEN):
        await repo.update(2, {"username": "taken"})
    mock_session.rollback.assert_awaited()


def test_update_user_duplicate_username_raises_bad_request(
    client: TestClient,
) -> None:
    """Story 85: the route maps USERNAME_TAKEN to 400 (not 500)."""
    admin_user = {"id": 1, "username": "admin", "is_admin": True, "unit_id": 1}
    app.dependency_overrides[get_current_user] = lambda: admin_user

    mock_repo = AsyncMock()
    mock_repo.find_visible = AsyncMock(return_value={"id": 2, "name": "User"})
    mock_repo.update.side_effect = ValueError(ErrorMessages.USERNAME_TAKEN)
    app.dependency_overrides[get_user_repository] = lambda: mock_repo

    resp = client.put("/users/2", json={"username": "taken"})
    assert resp.status_code == status.HTTP_400_BAD_REQUEST
    assert resp.json()["detail"] == ErrorMessages.USERNAME_TAKEN

    app.dependency_overrides.clear()


# ── Story 88: user list ordered by last-touched (created/updated bubble up) ──


class _MappingsResult:
    """Minimal stand-in for a SQLAlchemy Result for .mappings().all()."""

    def mappings(self):
        return self

    def all(self):
        return []

    @property
    def rowcount(self):
        return 1


def _compiled(stmt) -> str:
    from sqlalchemy.dialects import postgresql

    return str(stmt.compile(dialect=postgresql.dialect()))


@pytest.mark.asyncio
async def test_list_visible_orders_by_updated_at_desc() -> None:
    """GET /users must sort newest-touched first so a just created/edited user
    surfaces at the top (story 88)."""
    from app.models.access import Principal

    mock_session = AsyncMock()
    mock_session.execute = AsyncMock(return_value=_MappingsResult())
    repo = SqlAlchemyUserRepository(mock_session)

    await repo.list_visible(Principal(id=1, unit_id=2, is_admin=True))

    stmt = mock_session.execute.call_args[0][0]
    sql = _compiled(stmt).lower()
    assert "order by" in sql
    assert "updated_at" in sql
    assert "desc" in sql


@pytest.mark.asyncio
async def test_update_bumps_updated_at() -> None:
    """Editing a user must touch updated_at so the row bubbles to the top."""
    mock_session = AsyncMock()
    mock_session.execute = AsyncMock(return_value=_MappingsResult())
    repo = SqlAlchemyUserRepository(mock_session)

    await repo.update(2, {"name": "New Name"})

    stmt = mock_session.execute.call_args[0][0]
    assert "updated_at" in _compiled(stmt).lower()
