"""Audit log routes (admin only)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from app.constants.audit import AuditActions, AuditEntityTypes
from app.middlewares.auth import require_admin
from app.models.audit_model import AuditModel
from app.models.schemas import AuditLogResponse, AuditPagination

router = APIRouter()


@router.get("/audit-logs", response_model=AuditLogResponse, dependencies=[Depends(require_admin)])
async def list_logs(request: Request):
    q = dict(request.query_params)

    limit_num = max(1, int(q.get("limit", 100)))
    page_num = max(1, int(q.get("page", 1)))
    offset = (page_num - 1) * limit_num

    clauses: list[str] = []
    params: list = []
    idx = 1

    if q.get("userId"):
        clauses.append(f"a.user_id = ${idx}")
        params.append(int(q["userId"]))
        idx += 1
    if q.get("action"):
        clauses.append(f"a.action = ${idx}")
        params.append(q["action"])
        idx += 1
    if q.get("entityType"):
        clauses.append(f"a.entity_type = ${idx}")
        params.append(q["entityType"])
        idx += 1
    if q.get("startDate"):
        clauses.append(f"a.timestamp >= ${idx}")
        params.append(q["startDate"])
        idx += 1
    if q.get("endDate"):
        clauses.append(f"a.timestamp <= ${idx}")
        params.append(q["endDate"])
        idx += 1
    if q.get("userName"):
        clauses.append(f"(u.name ILIKE ${idx} OR u.username ILIKE ${idx})")
        params.append(f"%{q['userName']}%")
        idx += 1
    if q.get("ip"):
        clauses.append(f"a.ip_address ILIKE ${idx}")
        params.append(f"%{q['ip']}%")
        idx += 1
    if q.get("entityId"):
        clauses.append(f"a.entity_id = ${idx}")
        params.append(q["entityId"])
        idx += 1
    if q.get("conversationId"):
        clauses.append(f"a.conversation_id = ${idx}")
        params.append(int(q["conversationId"]))
        idx += 1

    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    total_info = await AuditModel.count(where, params)
    rows = await AuditModel.find(where, params, limit_num, offset)

    return AuditLogResponse(
        data=rows,
        pagination=AuditPagination(
            total=total_info["total"],
            page=page_num,
            limit=limit_num,
        ),
    )


@router.get("/audit-logs/fields", dependencies=[Depends(require_admin)])
async def get_fields():
    actions = [v for k, v in vars(AuditActions).items() if not k.startswith("_")]
    entity_types = [v for k, v in vars(AuditEntityTypes).items() if not k.startswith("_")]
    return [
        "id",
        "timestamp",
        "user_id",
        "user_name",
        "ip_address",
        "user_agent",
        "entity_id",
        "conversation_id",
        {"action": actions},
        {"entity_type": entity_types},
    ]
