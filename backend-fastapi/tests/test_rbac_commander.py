"""Story 66 — RBAC granular: Principal capabilities + require_permission gate.

Covers the new commander ("Chỉ huy") behaviour: a non-admin principal holding
``documents:*`` capabilities passes the repository-document gates, a regular
user (no capabilities) is rejected, and the commander is still blocked from the
``require_admin`` administration routes.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.middlewares.auth import get_current_user
from app.models.access import Principal
from app.repositories.factory import get_document_repository, get_user_repository

# A commander: is_admin FALSE, VIEW-ONLY (story 101) — reads documents + units
# across all units but holds NO write capability.
CHIEF = {
    "id": 9,
    "username": "thutruong_cuc",
    "unit_id": 1,
    "is_admin": False,
    "permissions": [
        "documents:read",
        "units:read",
    ],
}
# A regular user: is_admin FALSE, no capabilities.
USER = {"id": 8, "username": "u", "unit_id": 2, "is_admin": False, "permissions": []}
# A plain admin dict (is_admin TRUE) with no explicit permissions — passes the
# gate via the is_admin fallback (admins are backfilled to all/most actions).
ADMIN = {"id": 1, "username": "admin", "unit_id": 1, "is_admin": True}


# ── Principal capability resolution ────────────────────────────────────


def test_principal_can_checks_action_membership() -> None:
    p = Principal.from_user(CHIEF)
    # Story 101: commander is VIEW-ONLY — read yes, manage no.
    assert p.can("documents:read")
    assert not p.can("documents:manage")
    assert not p.can("docgroups:manage")
    assert not p.can("users:manage")
    assert not p.can("audit:read")


def test_principal_from_user_defaults_to_no_permissions() -> None:
    p = Principal.from_user({"id": 1, "unit_id": 1, "is_admin": False})
    assert p.permissions == frozenset()
    assert not p.can("documents:read")


# ── require_permission gate at the route level ─────────────────────────


@pytest.fixture
def client() -> TestClient:
    with patch("app.main.init_db", new_callable=AsyncMock), patch(
        "app.main.close_db", new_callable=AsyncMock
    ):
        return TestClient(app)


def _clear() -> None:
    app.dependency_overrides.clear()


def test_chief_passes_documents_read_gate(client: TestClient) -> None:
    repo = AsyncMock()
    # Story 115: endpoint delegates to count_repo_notifications; this test only
    # asserts the documents:read gate lets the commander through (200).
    repo.count_repo_notifications = AsyncMock(return_value=0)
    app.dependency_overrides[get_current_user] = lambda: CHIEF
    app.dependency_overrides[get_document_repository] = lambda: repo
    resp = client.get("/admin/documents/unread-count")
    assert resp.status_code == 200
    _clear()


def test_admin_passes_documents_gate_via_is_admin_fallback(
    client: TestClient,
) -> None:
    repo = AsyncMock()
    repo.count_repo_notifications = AsyncMock(return_value=3)
    app.dependency_overrides[get_current_user] = lambda: ADMIN
    app.dependency_overrides[get_document_repository] = lambda: repo
    resp = client.get("/admin/documents/unread-count")
    assert resp.status_code == 200
    _clear()


def test_regular_user_blocked_from_documents_gate(client: TestClient) -> None:
    app.dependency_overrides[get_current_user] = lambda: USER
    resp = client.get("/admin/documents/unread-count")
    assert resp.status_code == 403
    _clear()


def test_chief_passes_docgroups_list_gate(client: TestClient) -> None:
    # Story 101: LISTing groups is a READ — gated on documents:read (which the
    # view-only commander holds), NOT docgroups:manage. So the commander can still
    # SEE groups after losing the write caps.
    repo = AsyncMock()
    repo.list_doc_groups_paginated = AsyncMock(
        return_value={"items": [], "total": 0, "page": 1, "page_size": 10}
    )
    app.dependency_overrides[get_current_user] = lambda: CHIEF
    app.dependency_overrides[get_user_repository] = lambda: repo
    resp = client.get("/document-groups", params={"unit_id": 1})
    assert resp.status_code == 200
    _clear()


def test_chief_blocked_from_creating_group(client: TestClient) -> None:
    # Story 101: creating a group is a WRITE → gated on docgroups:manage. The
    # view-only commander (is_admin FALSE, no manage cap) is rejected.
    app.dependency_overrides[get_current_user] = lambda: CHIEF
    resp = client.post("/document-groups", json={"name": "X", "unit_id": 1})
    assert resp.status_code == 403
    _clear()


def test_regular_user_blocked_from_docgroups_gate(client: TestClient) -> None:
    app.dependency_overrides[get_current_user] = lambda: USER
    resp = client.get("/document-groups")
    assert resp.status_code == 403
    _clear()


def test_chief_blocked_from_user_administration(client: TestClient) -> None:
    # GET /users keeps require_admin → the commander (is_admin FALSE, no
    # users:manage) is rejected, exactly as required.
    app.dependency_overrides[get_current_user] = lambda: CHIEF
    resp = client.get("/users")
    assert resp.status_code == 403
    _clear()


def test_chief_can_list_units(client: TestClient) -> None:
    # Story 70: the commander needs to list units to pick a repository focus, so
    # GET /units is gated on units:read (which the commander holds) — not is_admin.
    repo = AsyncMock()
    repo.list_units_paginated = AsyncMock(
        return_value={"items": [], "total": 0, "page": 1, "page_size": 12}
    )
    app.dependency_overrides[get_current_user] = lambda: CHIEF
    app.dependency_overrides[get_user_repository] = lambda: repo
    resp = client.get("/units")
    assert resp.status_code == 200
    _clear()


def test_regular_user_blocked_from_listing_units(client: TestClient) -> None:
    app.dependency_overrides[get_current_user] = lambda: USER
    resp = client.get("/units")
    assert resp.status_code == 403
    _clear()
