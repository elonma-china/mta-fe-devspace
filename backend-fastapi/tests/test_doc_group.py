# tests/test_doc_group.py
"""Tests for document-group (nhóm tài liệu) management endpoints.

Covers list/search/paginate plus create/update/delete and the route-layer
error-code mapping. The repository is mocked (mirrors ``tests/test_unit.py``).

Story 77: groups are UNIT-SCOPED. A unit admin operates on their own unit
implicitly; a super-admin/commander (root / unit-less) must focus a unit via
``unit_id``. The route layer resolves the effective unit and passes it to the
repo (the per-unit uniqueness itself is a DB constraint, verified live).
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

# Root admin (unit_id=1) is a SUPER-admin → must focus a unit for groups.
SUPER_ADMIN_USER = {"id": 1, "username": "admin", "is_admin": True, "unit_id": 1}
# Unit admin (non-root) → own unit (2) is implicit.
UNIT_ADMIN_USER = {"id": 3, "username": "ua", "is_admin": True, "unit_id": 2}
NON_ADMIN_USER = {"id": 9, "username": "bob", "is_admin": False, "unit_id": 2}


@pytest.fixture
def client() -> TestClient:
    """Create a test client with the db lifespan mocked out."""
    with patch("app.main.init_db", new_callable=AsyncMock), patch(
        "app.main.close_db", new_callable=AsyncMock
    ):
        return TestClient(app)


def _as(user: dict) -> None:
    app.dependency_overrides[get_current_user] = lambda: user


def _override_repo(repo: AsyncMock) -> None:
    app.dependency_overrides[get_user_repository] = lambda: repo


def _list_repo() -> AsyncMock:
    repo = AsyncMock()
    repo.list_doc_groups_paginated.return_value = {
        "items": [{"id": 1, "name": "Hành chính", "unit_id": 2}],
        "total": 1,
        "page": 1,
        "page_size": 10,
    }
    return repo


def teardown_function() -> None:
    app.dependency_overrides.clear()


# ── List ──────────────────────────────────────────────────────────────


def test_list_unit_admin_scopes_to_own_unit(client: TestClient) -> None:
    """A unit admin lists their OWN unit's groups (no unit_id param needed)."""
    _as(UNIT_ADMIN_USER)
    repo = _list_repo()
    _override_repo(repo)

    resp = client.get("/document-groups", params={"page": 1, "page_size": 10})

    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["name"] == "Hành chính"
    # Resolved to the caller's own unit (2).
    assert repo.list_doc_groups_paginated.call_args.kwargs["unit_id"] == 2


def test_list_super_admin_without_focus_lists_all_units(
    client: TestClient,
) -> None:
    """Story 80: a super-admin with no focus lists EVERY unit's groups."""
    _as(SUPER_ADMIN_USER)
    repo = AsyncMock()
    repo.list_doc_groups_paginated.return_value = {
        "items": [{"id": 1, "name": "Hành chính", "unit_id": 2,
                   "unit_name": "Đơn vị 2"}],
        "total": 1,
        "page": 1,
        "page_size": 10,
    }
    _override_repo(repo)

    resp = client.get("/document-groups")

    assert resp.status_code == status.HTTP_200_OK
    kwargs = repo.list_doc_groups_paginated.call_args.kwargs
    assert kwargs.get("all_units") is True
    assert kwargs.get("unit_id") is None
    # The "Đơn vị" column value flows through.
    assert resp.json()["items"][0]["unit_name"] == "Đơn vị 2"


def test_list_commander_without_focus_lists_all_units(
    client: TestClient,
) -> None:
    """Story 80: the commander (is_admin False, ROOT) also lists all units.
    Story 101: the view-only commander holds ``documents:read`` (not manage); the
    group LIST route is gated on that read cap, so listing still works."""
    _as({
        "id": 7, "username": "chihuy", "is_admin": False, "unit_id": 1,
        "permissions": ["documents:read"],
    })
    repo = _list_repo()
    _override_repo(repo)

    resp = client.get("/document-groups")

    assert resp.status_code == status.HTTP_200_OK
    assert repo.list_doc_groups_paginated.call_args.kwargs.get("all_units") is True


def test_list_unit_admin_never_all_units(client: TestClient) -> None:
    """Story 80: a unit admin is NEVER put in all-units mode (no cross-unit leak)."""
    _as(UNIT_ADMIN_USER)
    repo = _list_repo()
    _override_repo(repo)

    resp = client.get("/document-groups")

    assert resp.status_code == status.HTTP_200_OK
    kwargs = repo.list_doc_groups_paginated.call_args.kwargs
    assert kwargs.get("all_units") is False
    assert kwargs.get("unit_id") == 2


def test_list_super_admin_with_focus_scopes_to_that_unit(
    client: TestClient,
) -> None:
    """A super-admin's ``unit_id`` focus is forwarded to the repo."""
    _as(SUPER_ADMIN_USER)
    repo = _list_repo()
    _override_repo(repo)

    resp = client.get("/document-groups", params={"unit_id": 5})

    assert resp.status_code == status.HTTP_200_OK
    assert repo.list_doc_groups_paginated.call_args.kwargs["unit_id"] == 5


def test_list_doc_groups_with_search_passes_filter_to_repo(
    client: TestClient,
) -> None:
    """The ``search`` query param is forwarded to the repository."""
    _as(UNIT_ADMIN_USER)
    repo = _list_repo()
    _override_repo(repo)

    resp = client.get("/document-groups", params={"search": "hành"})

    assert resp.status_code == status.HTTP_200_OK
    assert repo.list_doc_groups_paginated.call_args.kwargs.get("search") == "hành"


def test_list_doc_groups_non_admin_returns_403(client: TestClient) -> None:
    """Non-admins cannot list document groups."""
    _as(NON_ADMIN_USER)
    _override_repo(AsyncMock())

    resp = client.get("/document-groups")

    assert resp.status_code == status.HTTP_403_FORBIDDEN


# ── Create ────────────────────────────────────────────────────────────


def test_create_unit_admin_passes_own_unit(client: TestClient) -> None:
    """A unit admin creates a group in their OWN unit (unit_id=2)."""
    _as(UNIT_ADMIN_USER)
    repo = AsyncMock()
    repo.create_doc_group.return_value = {
        "id": 5,
        "name": "Công văn",
        "unit_id": 2,
    }
    _override_repo(repo)

    resp = client.post("/document-groups", json={"name": "Công văn"})

    assert resp.status_code == status.HTTP_201_CREATED
    assert resp.json()["id"] == 5
    assert repo.create_doc_group.call_args.kwargs["unit_id"] == 2


def test_create_super_admin_uses_body_unit(client: TestClient) -> None:
    """A super-admin creates a group in the unit given in the body."""
    _as(SUPER_ADMIN_USER)
    repo = AsyncMock()
    repo.create_doc_group.return_value = {
        "id": 6,
        "name": "Công văn",
        "unit_id": 7,
    }
    _override_repo(repo)

    resp = client.post(
        "/document-groups", json={"name": "Công văn", "unit_id": 7}
    )

    assert resp.status_code == status.HTTP_201_CREATED
    assert repo.create_doc_group.call_args.kwargs["unit_id"] == 7


def test_create_super_admin_without_unit_returns_400(client: TestClient) -> None:
    """A super-admin creating a group without a unit is rejected (focus)."""
    _as(SUPER_ADMIN_USER)
    _override_repo(AsyncMock())

    resp = client.post("/document-groups", json={"name": "Công văn"})

    assert resp.status_code == status.HTTP_400_BAD_REQUEST
    assert resp.json()["detail"] == ErrorMessages.UNIT_FOCUS_REQUIRED


def test_create_doc_group_empty_name_returns_400(client: TestClient) -> None:
    """A blank group name is rejected with 400."""
    _as(UNIT_ADMIN_USER)
    _override_repo(AsyncMock())

    resp = client.post("/document-groups", json={"name": "   "})

    assert resp.status_code == status.HTTP_400_BAD_REQUEST


def test_create_doc_group_duplicate_name_returns_409(
    client: TestClient,
) -> None:
    """A duplicate group name WITHIN the unit surfaces as 409."""
    _as(UNIT_ADMIN_USER)
    repo = AsyncMock()
    repo.create_doc_group.side_effect = ValueError(
        ErrorMessages.DOC_GROUP_NAME_TAKEN
    )
    _override_repo(repo)

    resp = client.post("/document-groups", json={"name": "Công văn"})

    assert resp.status_code == status.HTTP_409_CONFLICT
    assert resp.json()["detail"] == ErrorMessages.DOC_GROUP_NAME_TAKEN


# ── Update ────────────────────────────────────────────────────────────


def test_update_unit_admin_restricts_to_own_unit(client: TestClient) -> None:
    """A unit admin update is restricted to their own unit (restrict=2)."""
    _as(UNIT_ADMIN_USER)
    repo = AsyncMock()
    repo.update_doc_group.return_value = {
        "id": 2,
        "name": "Tên mới",
        "unit_id": 2,
    }
    _override_repo(repo)

    resp = client.put("/document-groups/2", json={"name": "Tên mới"})

    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["name"] == "Tên mới"
    assert repo.update_doc_group.call_args.kwargs["restrict_unit_id"] == 2


def test_update_super_admin_has_no_unit_restriction(client: TestClient) -> None:
    """A super-admin may rename any unit's group (restrict=None)."""
    _as(SUPER_ADMIN_USER)
    repo = AsyncMock()
    repo.update_doc_group.return_value = {
        "id": 2,
        "name": "Tên mới",
        "unit_id": 4,
    }
    _override_repo(repo)

    resp = client.put("/document-groups/2", json={"name": "Tên mới"})

    assert resp.status_code == status.HTTP_200_OK
    assert repo.update_doc_group.call_args.kwargs["restrict_unit_id"] is None


def test_update_doc_group_not_found_returns_404(client: TestClient) -> None:
    """Updating a missing/foreign group returns 404."""
    _as(UNIT_ADMIN_USER)
    repo = AsyncMock()
    repo.update_doc_group.side_effect = LookupError(
        ErrorMessages.DOC_GROUP_NOT_FOUND
    )
    _override_repo(repo)

    resp = client.put("/document-groups/999", json={"name": "X"})

    assert resp.status_code == status.HTTP_404_NOT_FOUND


def test_update_doc_group_empty_name_returns_400(client: TestClient) -> None:
    """Renaming to a blank name returns 400."""
    _as(UNIT_ADMIN_USER)
    repo = AsyncMock()
    repo.update_doc_group.side_effect = ValueError(
        ErrorMessages.DOC_GROUP_NAME_REQUIRED
    )
    _override_repo(repo)

    resp = client.put("/document-groups/2", json={"name": "  "})

    assert resp.status_code == status.HTTP_400_BAD_REQUEST


def test_update_doc_group_duplicate_name_returns_409(
    client: TestClient,
) -> None:
    """Renaming to an existing name within the unit returns 409."""
    _as(UNIT_ADMIN_USER)
    repo = AsyncMock()
    repo.update_doc_group.side_effect = ValueError(
        ErrorMessages.DOC_GROUP_NAME_TAKEN
    )
    _override_repo(repo)

    resp = client.put("/document-groups/2", json={"name": "Công văn"})

    assert resp.status_code == status.HTTP_409_CONFLICT


# ── Delete ────────────────────────────────────────────────────────────


def test_delete_unit_admin_restricts_to_own_unit(client: TestClient) -> None:
    """A unit admin delete is restricted to their own unit (restrict=2)."""
    _as(UNIT_ADMIN_USER)
    repo = AsyncMock()
    repo.delete_doc_group.return_value = None
    _override_repo(repo)

    resp = client.delete("/document-groups/3")

    assert resp.status_code == status.HTTP_204_NO_CONTENT
    assert repo.delete_doc_group.call_args.kwargs["restrict_unit_id"] == 2


def test_delete_super_admin_has_no_unit_restriction(client: TestClient) -> None:
    """A super-admin may delete any unit's group (restrict=None)."""
    _as(SUPER_ADMIN_USER)
    repo = AsyncMock()
    repo.delete_doc_group.return_value = None
    _override_repo(repo)

    resp = client.delete("/document-groups/3")

    assert resp.status_code == status.HTTP_204_NO_CONTENT
    assert repo.delete_doc_group.call_args.kwargs["restrict_unit_id"] is None


def test_delete_doc_group_not_found_returns_404(client: TestClient) -> None:
    """Deleting a missing/foreign group returns 404."""
    _as(UNIT_ADMIN_USER)
    repo = AsyncMock()
    repo.delete_doc_group.side_effect = LookupError(
        ErrorMessages.DOC_GROUP_NOT_FOUND
    )
    _override_repo(repo)

    resp = client.delete("/document-groups/999")

    assert resp.status_code == status.HTTP_404_NOT_FOUND


def test_delete_doc_group_non_admin_returns_403(client: TestClient) -> None:
    """Non-admins cannot delete a group."""
    _as(NON_ADMIN_USER)
    _override_repo(AsyncMock())

    resp = client.delete("/document-groups/3")

    assert resp.status_code == status.HTTP_403_FORBIDDEN
