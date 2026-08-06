"""Configuration management via pydantic-settings."""

import logging
import os
import secrets
from typing import List

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def _resolve_jwt_secret() -> str:
    """Resolve JWT secret: env var -> file -> ephemeral random (dev only)."""
    from_env = os.getenv("JWT_SECRET")
    if from_env:
        return from_env

    secret_file = os.path.join(os.path.dirname(__file__), "..", "jwt_secret.txt")
    if os.path.isfile(secret_file):
        with open(secret_file) as f:
            value = f.read().strip()
            if value:
                return value

    # TODO(security): In production, JWT_SECRET MUST be set via environment variable.
    logging.warning(
        "JWT_SECRET not configured — generating ephemeral secret. "
        "This instance is isolated and tokens will not survive restarts."
    )
    return secrets.token_hex(32)


class Settings(BaseSettings):
    """Application settings loaded from environment / .env file."""

    # Server
    host: str = "0.0.0.0"
    port: int = 5050
    frontend_origin: str = "*"

    # JWT
    jwt_secret: str = Field(default_factory=_resolve_jwt_secret)
    jwt_expires_in: str = "24h"
    jwt_algorithm: str = "HS256"

    # PostgreSQL
    db_host: str = "localhost"
    db_port: int = 5432
    db_user: str = "postgres"
    db_password: str = "postgres"
    db_name: str = "intramind"

    # MongoDB
    mongo_host: str = "localhost"
    mongo_port: int = 27017
    mongo_user: str = "mongoadmin"
    mongo_password: str = "mongoadmin"
    mongo_db: str = "intramind"

    # Upstream AI services
    ai_service_host: str = "http://localhost:5001/api/v1"
    ai_ingest_host: str = "http://localhost:5002/api/v1"
    llm_api_key: str | None = None

    # Dev Space: this gateway reads a corpus it does not own. When true, every
    # mutating call to the ingest service is refused at the helper that makes
    # it, so no route — present or future — can write into that corpus.
    #
    # This is not a UI concern. `_delete_remote_document` issues a real
    # DELETE /documents/{id} against the ingest service, so a Dev Space user
    # deleting their own conversation would delete documents out of the live
    # index. Hiding the button is bypassable; refusing the call is not.
    dev_readonly_corpus: bool = False

    # Document status listener (bug 1). The ingest service publishes
    # "completed"/"failed" on Redis pub/sub the moment a document finishes; we
    # subscribe so the terminal status is persisted even when no browser is
    # watching. These three MUST match mta-be-intramind's api/config.py
    # (REDIS_URL, STATUS_PUBSUB_REDIS_DB=2, STATUS_PUBSUB_CHANNEL_PREFIX) — a
    # mismatch is silent: the listener simply never receives anything.
    # Set STATUS_LISTENER_ENABLED=false to fall back to poll-only behaviour.
    status_listener_enabled: bool = True
    redis_url: str = "redis://localhost:6379"
    status_pubsub_redis_db: int = 2
    status_pubsub_channel_prefix: str = "doc-status"

    # Short-term memory: number of recent conversation turns forwarded to the
    # stateless AI service on /query/stream. 0 disables forwarding.
    stm_forward_window: int = 10

    # Zombie task detection — must exceed the slowest draft/report synthesis run
    zombie_task_timeout_ms: int = 1_800_000

    # Repository upload: comma-separated list of allowed file extensions.
    # Kept in sync with the FE upload accept list (REACT_APP_FILE_EXT). Override
    # via the UPLOAD_ALLOWED_EXTENSIONS env var / .env entry — not hardcoded.
    upload_allowed_extensions: str = (
        ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.md,.png,.jpg,.jpeg"
    )

    @property
    def effective_ai_ingest_host(self) -> str:
        return self.ai_ingest_host or self.ai_service_host

    @property
    def allowed_upload_extensions(self) -> tuple[str, ...]:
        """Normalized tuple of allowed upload extensions (lowercase, dotted).

        Parsed from ``upload_allowed_extensions``; entries are trimmed, lower-
        cased and prefixed with a leading dot if missing. Empty entries drop.
        """
        out: list[str] = []
        for raw in self.upload_allowed_extensions.split(","):
            ext = raw.strip().lower()
            if not ext:
                continue
            if not ext.startswith("."):
                ext = f".{ext}"
            out.append(ext)
        return tuple(out)

    @property
    def cors_origins(self) -> List[str]:
        raw = self.frontend_origin.strip()
        if raw == "*":
            return ["*"]
        return [s.strip() for s in raw.split(",") if s.strip()]

    model_config = SettingsConfigDict(
        env_file=".env",
        case_sensitive=False,
        extra="ignore",
    )


settings = Settings()
