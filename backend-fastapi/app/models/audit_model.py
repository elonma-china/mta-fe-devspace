"""Audit model — raw asyncpg queries against the ``audit_log`` table."""

from __future__ import annotations

import json

from app.db import get_pool
from app.utils.helpers import parse_json_safe


class AuditModel:
    @staticmethod
    async def insert(data: dict) -> None:
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
                    data.get("timestamp"),
                    data.get("user_id"),
                    data.get("action"),
                    data.get("entity_type"),
                    data.get("entity_id"),
                    data.get("conversation_id"),
                    data.get("ip"),
                    data.get("user_agent"),
                    json.dumps(data["metadata"]) if data.get("metadata") else None,
                )
        except Exception:
            import logging

            logging.getLogger(__name__).exception("[audit] Insert failed")

    @staticmethod
    async def count(where: str, params: list) -> dict:
        pool = await get_pool()
        async with pool.acquire() as conn:
            sql = (
                'SELECT COUNT(*) as total FROM audit_log a '
                'LEFT JOIN "user" u ON a.user_id = u.id '
                f"{where}"
            )
            row = await conn.fetchrow(sql, *params)
            return {"total": row["total"] if row else 0}

    @staticmethod
    async def find(where: str, params: list, limit: int, offset: int) -> list[dict]:
        pool = await get_pool()
        idx_limit = len(params) + 1
        idx_offset = len(params) + 2
        all_params = [*params, limit, offset]
        sql = (
            'SELECT a.*, u.name as user_name, u.username as user_username '
            'FROM audit_log a '
            'LEFT JOIN "user" u ON a.user_id = u.id '
            f"{where} "
            f"ORDER BY a.timestamp DESC "
            f"LIMIT ${idx_limit} OFFSET ${idx_offset}"
        )
        async with pool.acquire() as conn:
            rows = await conn.fetch(sql, *all_params)
            result = []
            for r in rows:
                d = dict(r)
                d["metadata"] = parse_json_safe(d.get("metadata"), None)
                result.append(d)
            return result
