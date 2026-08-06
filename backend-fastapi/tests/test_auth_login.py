# tests/test_auth_login.py
"""Story 83 (regression): lock the /login route contract around the username
normalization change.

The route (``app/routes/auth.py``) is the SOLE consumer of
``find_by_username``. These route-level tests mock the repository and pin the
behaviour that must NOT change when username lookup became tolerant:

* a correct password (exact bcrypt) → 200 + token;
* a wrong password → 401 (password matching stays EXACT — not loosened);
* a locked account → 403;
* an unknown username (repo resolves to None) → 401.

The tolerant username *resolution* itself is unit-tested in
``test_login_username_norm.py`` (pure ``_pick_username_match``).
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import bcrypt
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.repositories.factory import get_user_repository

PW_HASH = bcrypt.hashpw(b"admin", bcrypt.gensalt(rounds=4)).decode()


@pytest.fixture
def client() -> TestClient:
    with patch("app.main.init_db", new_callable=AsyncMock), patch(
        "app.main.close_db", new_callable=AsyncMock
    ):
        return TestClient(app)


def _user(lock: bool = False) -> dict:
    return {
        "id": 19,
        "name": "User One",
        "username": "user1",
        "password": PW_HASH,
        "unit_id": 4,
        "unit_name": "Donvi",
        "role_id": 3,
        "role_name": "Người dùng",
        "is_admin": False,
        "lock_status": lock,
        "token_version": 0,
    }


def _override(find_return) -> AsyncMock:
    repo = AsyncMock()
    repo.find_by_username = AsyncMock(return_value=find_return)
    app.dependency_overrides[get_user_repository] = lambda: repo
    return repo


def _clear() -> None:
    app.dependency_overrides.clear()


def test_login_correctPassword_returns200WithToken(client: TestClient) -> None:
    _override(_user())
    resp = client.post("/login", json={"username": "user1", "password": "admin"})
    assert resp.status_code == 200
    assert resp.json().get("token")
    _clear()


def test_login_wrongPassword_returns401(client: TestClient) -> None:
    # Password matching stays EXACT — a wrong password never succeeds.
    _override(_user())
    resp = client.post("/login", json={"username": "user1", "password": "Admin"})
    assert resp.status_code == 401
    _clear()


def test_login_lockedAccount_returns403(client: TestClient) -> None:
    _override(_user(lock=True))
    resp = client.post("/login", json={"username": "user1", "password": "admin"})
    assert resp.status_code == 403
    _clear()


def test_login_unknownUser_returns401(client: TestClient) -> None:
    # Repo resolves the typed username to nobody (e.g. ambiguous case-variants).
    _override(None)
    resp = client.post("/login", json={"username": "nope", "password": "x"})
    assert resp.status_code == 401
    _clear()
