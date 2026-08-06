# tests/test_errors.py
"""Tests for standardizing return messages and constants."""

from __future__ import annotations

from fastapi import status

from app.constants.errors import ErrorMessages


def test_error_message_constants() -> None:
    """Verify that standardized error messages are properly set and loaded."""
    assert ErrorMessages.TOKEN_MISSING == "Thiếu token xác thực"
    assert ErrorMessages.ACCOUNT_LOCKED == "Tài khoản của bạn hiện đang bị khóa"
    assert ErrorMessages.ROLE_NOT_FOUND == "Không tìm thấy vai trò"


def test_status_codes() -> None:
    """Verify standard status code constants align with HTTP definitions."""
    assert status.HTTP_200_OK == 200
    assert status.HTTP_400_BAD_REQUEST == 400
    assert status.HTTP_401_UNAUTHORIZED == 401
    assert status.HTTP_403_FORBIDDEN == 403
    assert status.HTTP_404_NOT_FOUND == 404
    assert status.HTTP_502_BAD_GATEWAY == 502
