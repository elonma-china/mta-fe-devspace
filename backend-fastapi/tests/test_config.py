# tests/test_config.py
"""Tests for the application configuration settings."""

from unittest.mock import patch

from _pytest.logging import LogCaptureFixture

from app.config import Settings


def test_settings_jwt_secret_from_env_no_warning(
    caplog: LogCaptureFixture,
) -> None:
    """Verify that JWT_SECRET from env does not log a warning.

    Args:
        caplog: Pytest fixture to capture log messages.
    """
    with patch.dict("os.environ", {"JWT_SECRET": "test_env_secret"}):
        # We instantiate a new Settings object which should read from env
        settings = Settings()
        assert settings.jwt_secret == "test_env_secret"

    # Verify no warning about JWT_SECRET not being configured was logged
    warning_msgs = [
        rec.message
        for rec in caplog.records
        if "JWT_SECRET not configured" in rec.message
    ]
    assert not warning_msgs, f"Unexpected warning logged: {warning_msgs}"


def test_settings_jwt_secret_missing_logs_warning(
    caplog: LogCaptureFixture,
) -> None:
    """Verify that missing JWT_SECRET logs a warning.

    Args:
        caplog: Pytest fixture to capture log messages.
    """
    with patch.dict("os.environ", {}):
        with patch("os.path.isfile", return_value=False):
            # Instantiate Settings to trigger fallback resolution
            settings = Settings()
            assert len(settings.jwt_secret) == 64  # token_hex(32) is 64 chars

    # Verify warning about JWT_SECRET not being configured was logged
    warning_msgs = [
        rec.message
        for rec in caplog.records
        if "JWT_SECRET not configured" in rec.message
    ]
    assert len(warning_msgs) == 1


def test_allowed_upload_extensions_default_parsed_as_tuple() -> None:
    """The default upload allow-list parses to a normalized dotted tuple."""
    settings = Settings()
    exts = settings.allowed_upload_extensions
    assert isinstance(exts, tuple)
    for ext in (".pdf", ".docx", ".xlsx", ".pptx", ".txt", ".csv", ".md"):
        assert ext in exts


def test_allowed_upload_extensions_from_env_overrides() -> None:
    """UPLOAD_ALLOWED_EXTENSIONS env overrides + is normalized (dot, lower)."""
    with patch.dict(
        "os.environ", {"UPLOAD_ALLOWED_EXTENSIONS": "PDF, .csv ,txt"}
    ):
        settings = Settings()
        assert settings.allowed_upload_extensions == (".pdf", ".csv", ".txt")
