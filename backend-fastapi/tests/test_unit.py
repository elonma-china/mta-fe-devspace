# tests/test_unit.py
"""Tests for unit (đơn vị) management endpoints.

Covers list/search/paginate plus create/update/delete and admin
assignment, including the error-code mapping done by the route layer.
The repository is mocked (mirrors ``tests/test_user.py``).
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import status
from fastapi.testclient import TestClient

from app.constants.errors import ErrorMessages
from app.main import app
from app.middlewares.auth import get_current_user
from app.repositories.factory import get_user_repository

ADMIN_USER = {"id": 1, "username": "admin", "is_admin": True, "unit_id": 1}
NON_ADMIN_USER = {"id": 9, "username": "bob", "is_admin": False, "unit_id": 2}


@pytest.fixture
def client() -> TestClient:
    """Create a test client with the db lifespan mocked out."""
    with patch("app.main.init_db", new_callable=AsyncMock), patch(
        "app.main.close_db", new_callable=AsyncMock
    ):
        return TestClient(app)


def _as_admin() -> None:
    app.dependency_overrides[get_current_user] = lambda: ADMIN_USER


def _override_repo(repo: AsyncMock) -> None:
    app.dependency_overrides[get_user_repository] = lambda: repo


def teardown_function() -> None:
    app.dependency_overrides.clear()


# ── List ──────────────────────────────────────────────────────────────


def test_list_units_pagination_returns_total_and_page(
    client: TestClient,
) -> None:
    """GET /units returns the paginated envelope with total/page/page_size."""
    _as_admin()
    repo = AsyncMock()
    repo.list_units_paginated.return_value = {
        "items": [
            {
                "id": 1,
                "name": "Phòng A",
                "parent_id": None,
                "admin_username": "admin_a",
                "admin_full_name": "Quản Trị A",
            }
        ],
        "total": 1,
        "page": 1,
        "page_size": 12,
    }
    _override_repo(repo)

    resp = client.get("/units", params={"page": 1, "page_size": 12})

    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert body["total"] == 1
    assert body["page"] == 1
    assert body["page_size"] == 12
    assert body["items"][0]["admin_username"] == "admin_a"


def test_list_units_with_search_passes_filter_to_repo(
    client: TestClient,
) -> None:
    """The ``search`` query param is forwarded to the repository."""
    _as_admin()
    repo = AsyncMock()
    repo.list_units_paginated.return_value = {
        "items": [],
        "total": 0,
        "page": 1,
        "page_size": 12,
    }
    _override_repo(repo)

    resp = client.get("/units", params={"search": "phòng"})

    assert resp.status_code == status.HTTP_200_OK
    kwargs = repo.list_units_paginated.call_args.kwargs
    assert kwargs.get("search") == "phòng"


def test_list_units_non_admin_returns_403(client: TestClient) -> None:
    """Non-admins cannot list units."""
    app.dependency_overrides[get_current_user] = lambda: NON_ADMIN_USER
    _override_repo(AsyncMock())

    resp = client.get("/units")

    assert resp.status_code == status.HTTP_403_FORBIDDEN


# ── Create ────────────────────────────────────────────────────────────


def test_create_unit_valid_returns_201(client: TestClient) -> None:
    """Creating a unit returns 201 with the new id."""
    _as_admin()
    repo = AsyncMock()
    repo.create_unit.return_value = {
        "id": 5,
        "name": "Phòng Mới",
        "parent_id": 1,
        "admin_username": None,
        "admin_full_name": None,
    }
    _override_repo(repo)

    resp = client.post("/units", json={"name": "Phòng Mới"})

    assert resp.status_code == status.HTTP_201_CREATED
    assert resp.json()["id"] == 5


def test_create_unit_empty_name_returns_400(client: TestClient) -> None:
    """A blank unit name is rejected with 400."""
    _as_admin()
    _override_repo(AsyncMock())

    resp = client.post("/units", json={"name": "   "})

    assert resp.status_code == status.HTTP_400_BAD_REQUEST


def test_create_unit_duplicate_name_returns_409(client: TestClient) -> None:
    """A duplicate unit name surfaces as 409."""
    _as_admin()
    repo = AsyncMock()
    repo.create_unit.side_effect = ValueError(ErrorMessages.UNIT_NAME_TAKEN)
    _override_repo(repo)

    resp = client.post("/units", json={"name": "Phòng A"})

    assert resp.status_code == status.HTTP_409_CONFLICT
    assert resp.json()["detail"] == ErrorMessages.UNIT_NAME_TAKEN


def test_create_unit_with_new_admin_returns_201(client: TestClient) -> None:
    """Creating a unit together with a brand-new admin user works."""
    _as_admin()
    repo = AsyncMock()
    repo.create_unit.return_value = {
        "id": 6,
        "name": "Phòng B",
        "parent_id": 1,
        "admin_username": "newadmin",
        "admin_full_name": "Người Mới",
    }
    _override_repo(repo)

    resp = client.post(
        "/units",
        json={
            "name": "Phòng B",
            "admin": {
                "full_name": "Người Mới",
                "username": "newadmin",
                "password": "Abc123xyz789",
            },
        },
    )

    assert resp.status_code == status.HTTP_201_CREATED
    assert resp.json()["admin_username"] == "newadmin"


def test_create_unit_new_admin_invalid_username_returns_400(
    client: TestClient,
) -> None:
    """An invalid admin username is rejected with 400."""
    _as_admin()
    repo = AsyncMock()
    repo.create_unit.side_effect = ValueError(ErrorMessages.USERNAME_INVALID)
    _override_repo(repo)

    resp = client.post(
        "/units",
        json={
            "name": "Phòng C",
            "admin": {
                "full_name": "X",
                "username": "Bad Name!",
                "password": "Abc123xyz789",
            },
        },
    )

    assert resp.status_code == status.HTTP_400_BAD_REQUEST


def test_create_unit_new_admin_duplicate_username_returns_409(
    client: TestClient,
) -> None:
    """A taken admin username surfaces as 409."""
    _as_admin()
    repo = AsyncMock()
    repo.create_unit.side_effect = ValueError(ErrorMessages.USERNAME_TAKEN)
    _override_repo(repo)

    resp = client.post(
        "/units",
        json={
            "name": "Phòng D",
            "admin": {
                "full_name": "X",
                "username": "taken",
                "password": "Abc123xyz789",
            },
        },
    )

    assert resp.status_code == status.HTTP_409_CONFLICT


# ── Update ────────────────────────────────────────────────────────────


def test_update_unit_not_found_returns_404(client: TestClient) -> None:
    """Updating a missing unit returns 404."""
    _as_admin()
    repo = AsyncMock()
    repo.update_unit.side_effect = LookupError(ErrorMessages.UNIT_NOT_FOUND)
    _override_repo(repo)

    resp = client.put("/units/999", json={"name": "X"})

    assert resp.status_code == status.HTTP_404_NOT_FOUND


def test_update_unit_duplicate_name_returns_409(client: TestClient) -> None:
    """Renaming to an existing name returns 409."""
    _as_admin()
    repo = AsyncMock()
    repo.update_unit.side_effect = ValueError(ErrorMessages.UNIT_NAME_TAKEN)
    _override_repo(repo)

    resp = client.put("/units/2", json={"name": "Phòng A"})

    assert resp.status_code == status.HTTP_409_CONFLICT


def test_update_unit_assign_existing_admin_returns_200(
    client: TestClient,
) -> None:
    """Assigning an existing user as admin returns 200."""
    _as_admin()
    repo = AsyncMock()
    repo.update_unit.return_value = {
        "id": 2,
        "name": "Phòng A",
        "parent_id": 1,
        "admin_username": "carol",
        "admin_full_name": "Carol",
    }
    _override_repo(repo)

    resp = client.put("/units/2", json={"admin": {"user_id": 7}})

    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["admin_username"] == "carol"


def test_update_unit_with_new_admin_returns_200(client: TestClient) -> None:
    """Editing a unit may create-and-assign a brand-new admin user.

    Locks the behaviour relied on by the edit modal (Figma 1018-31182): the
    PUT accepts an ``admin`` create-trio and forwards it to the repository.
    """
    _as_admin()
    repo = AsyncMock()
    repo.update_unit.return_value = {
        "id": 2,
        "name": "Phòng A",
        "parent_id": 1,
        "admin_username": "newadmin",
        "admin_full_name": "Người Mới",
    }
    _override_repo(repo)

    resp = client.put(
        "/units/2",
        json={
            "admin": {
                "full_name": "Người Mới",
                "username": "newadmin",
                "password": "Abc123xyz789",
            }
        },
    )

    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["admin_username"] == "newadmin"
    # The create-trio reached the repository layer.
    forwarded = repo.update_unit.call_args.args[2]
    assert forwarded["admin"]["username"] == "newadmin"


# ── Delete ────────────────────────────────────────────────────────────


def test_delete_unit_success_returns_204(client: TestClient) -> None:
    """Deleting an empty unit returns 204."""
    _as_admin()
    repo = AsyncMock()
    repo.delete_unit.return_value = None
    _override_repo(repo)

    resp = client.delete("/units/3")

    assert resp.status_code == status.HTTP_204_NO_CONTENT


def test_delete_unit_not_found_returns_404(client: TestClient) -> None:
    """Deleting a missing unit returns 404."""
    _as_admin()
    repo = AsyncMock()
    repo.delete_unit.side_effect = LookupError(ErrorMessages.UNIT_NOT_FOUND)
    _override_repo(repo)

    resp = client.delete("/units/999")

    assert resp.status_code == status.HTTP_404_NOT_FOUND


def test_delete_unit_not_empty_returns_409(client: TestClient) -> None:
    """Deleting a unit that still has users or children returns 409."""
    _as_admin()
    repo = AsyncMock()
    repo.delete_unit.side_effect = ValueError(ErrorMessages.UNIT_NOT_EMPTY)
    _override_repo(repo)

    resp = client.delete("/units/1")

    assert resp.status_code == status.HTTP_409_CONFLICT
    assert resp.json()["detail"] == ErrorMessages.UNIT_NOT_EMPTY


def test_delete_unit_with_transfer_returns_204(client: TestClient) -> None:
    """Deleting with a transfer target forwards it to the repo and returns 204."""
    _as_admin()
    repo = AsyncMock()
    repo.delete_unit.return_value = None
    _override_repo(repo)

    resp = client.delete("/units/3?transfer_to_unit_id=5")

    assert resp.status_code == status.HTTP_204_NO_CONTENT
    _, kwargs = repo.delete_unit.call_args
    args = repo.delete_unit.call_args.args
    # unit_id forwarded positionally, transfer target forwarded too.
    assert 3 in args
    forwarded_target = kwargs.get("transfer_to_unit_id")
    if forwarded_target is None:
        forwarded_target = args[-1] if 5 in args else None
    assert forwarded_target == 5


def test_delete_unit_transfer_same_returns_400(client: TestClient) -> None:
    """Transferring a unit into itself is a 400 bad request."""
    _as_admin()
    repo = AsyncMock()
    repo.delete_unit.side_effect = ValueError(ErrorMessages.UNIT_TRANSFER_SAME)
    _override_repo(repo)

    resp = client.delete("/units/3?transfer_to_unit_id=3")

    assert resp.status_code == status.HTTP_400_BAD_REQUEST
    assert resp.json()["detail"] == ErrorMessages.UNIT_TRANSFER_SAME


def test_delete_unit_transfer_descendant_returns_400(client: TestClient) -> None:
    """Transferring into a descendant (which will be deleted) is a 400."""
    _as_admin()
    repo = AsyncMock()
    repo.delete_unit.side_effect = ValueError(
        ErrorMessages.UNIT_TRANSFER_DESCENDANT
    )
    _override_repo(repo)

    resp = client.delete("/units/3?transfer_to_unit_id=7")

    assert resp.status_code == status.HTTP_400_BAD_REQUEST
    assert resp.json()["detail"] == ErrorMessages.UNIT_TRANSFER_DESCENDANT


def test_delete_unit_transfer_target_not_found_returns_404(
    client: TestClient,
) -> None:
    """A missing transfer target maps to 404."""
    _as_admin()
    repo = AsyncMock()
    repo.delete_unit.side_effect = LookupError(ErrorMessages.UNIT_NOT_FOUND)
    _override_repo(repo)

    resp = client.delete("/units/3?transfer_to_unit_id=999")

    assert resp.status_code == status.HTTP_404_NOT_FOUND


def test_delete_unit_transfer_forbidden_returns_403(client: TestClient) -> None:
    """A target outside the admin's tree maps to 403."""
    _as_admin()
    repo = AsyncMock()
    repo.delete_unit.side_effect = PermissionError(ErrorMessages.FORBIDDEN)
    _override_repo(repo)

    resp = client.delete("/units/3?transfer_to_unit_id=42")

    assert resp.status_code == status.HTTP_403_FORBIDDEN


# ── Admin candidates ──────────────────────────────────────────────────


def test_admin_candidates_returns_subtree_users(client: TestClient) -> None:
    """GET /units/{id}/admin-candidates returns candidate users."""
    _as_admin()
    repo = AsyncMock()
    repo.list_admin_candidates.return_value = [
        {"id": 7, "username": "carol", "full_name": "Carol"},
        {"id": 8, "username": "dave", "full_name": "Dave"},
    ]
    _override_repo(repo)

    resp = client.get("/units/2/admin-candidates")

    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert len(body) == 2
    assert body[0]["username"] == "carol"


def test_admin_candidates_non_admin_returns_403(client: TestClient) -> None:
    """Non-admins cannot list admin candidates."""
    app.dependency_overrides[get_current_user] = lambda: NON_ADMIN_USER
    _override_repo(AsyncMock())

    resp = client.get("/units/2/admin-candidates")

    assert resp.status_code == status.HTTP_403_FORBIDDEN
