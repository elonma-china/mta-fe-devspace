"""Fire-and-forget audit logging helper."""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any

from app.db import get_pool

logger = logging.getLogger(__name__)


async def _insert_audit(
    *,
    timestamp: str,
    user_id: int | None,
    action: str,
    entity_type: str,
    entity_id: str | None,
    conversation_id: int | None,
    ip: str | None,
    user_agent: str | None,
    metadata: Any | None,
) -> None:
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO audit_log
                    (timestamp, user_id, action, entity_type, entity_id,
                     conversation_id, ip_address, user_agent, metadata)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                """,
                timestamp,
                user_id,
                action,
                entity_type,
                entity_id,
                conversation_id,
                ip,
                user_agent,
                json.dumps(metadata) if metadata is not None else None,
            )
    except Exception:
        logger.exception("[audit] Insert failed")


def audit_log(
    request,
    action: str,
    entity_type: str,
    entity_id: str | int | None = None,
    *,
    user_id: int | None = None,
    conversation_id: int | None = None,
    metadata: Any | None = None,
) -> None:
    """Schedule an audit log entry as a background task (fire-and-forget)."""
    if not action or not entity_type:
        return

    # Resolve user info from request state (set by auth middleware)
    req_user = getattr(request.state, "user", None) or {}
    effective_user_id = user_id if user_id is not None else req_user.get("id")

    client_info = getattr(request.state, "client_info", {}) or {}

    asyncio.create_task(
        _insert_audit(
            timestamp=datetime.now(timezone.utc).isoformat(),
            user_id=effective_user_id,
            action=action,
            entity_type=entity_type,
            entity_id=str(entity_id) if entity_id is not None else None,
            conversation_id=conversation_id,
            ip=client_info.get("ip"),
            user_agent=client_info.get("user_agent"),
            metadata=metadata,
        )
    )
