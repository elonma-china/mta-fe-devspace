"""Story 115 — DB-backed tests for role-aware repository notifications.

Like ``test_repo_doc_read_db.py`` these run against a real PostgreSQL instance
(recursive CTE / concat / uploader join are Postgres-specific) and skip when
``TEST_DATABASE_URL`` is unset.

Model under test (``count_repo_notifications``, app/repositories/postgres.py):
  * admin (super OR unit) → 0.
  * commander (not admin, documents:read, root unit) → only docs whose UPLOADER
    is a super admin (``User.is_admin`` AND unit ∈ {None, ROOT}), across EVERY
    repository conversation, minus baseline/read.
  * regular member → identical to ``count_unread_repo_documents`` (own unit repo).
"""

from __future__ import annotations

import asyncio
import os
import uuid
from datetime import datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.access import ROOT_UNIT_ID, Principal
from app.models.orm import Base, Conversation, Document, Role, Unit, User
from app.repositories.postgres import (
    SqlAlchemyDocumentRepository,
    repository_conversation_name,
)

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="TEST_DATABASE_URL not set; skipping DB-backed notification tests",
)

_BASELINE = datetime(2026, 1, 1, 12, 0, 0)
_NEW = _BASELINE + timedelta(days=1)   # after baseline → counts as unread


async def _reset_schema(engine) -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)


async def _seed(session) -> dict:
    # Root unit must be ROOT_UNIT_ID (1) — fresh schema autoincrements from 1.
    root = Unit(name="root", parent_id=None)
    session.add(root)
    await session.flush()
    assert root.id == ROOT_UNIT_ID, "seed expects root unit id == ROOT_UNIT_ID"
    child = Unit(name="child", parent_id=root.id)
    session.add(child)
    await session.flush()

    admin_role = Role(name="admin", unit_id=root.id, is_admin=True)
    member_role = Role(name="member", unit_id=child.id, is_admin=False)
    session.add_all([admin_role, member_role])
    await session.flush()

    # Uploaders: a super admin (on root) and a unit admin (on child).
    super_admin = User(
        name="super", username="super", password="x",
        unit_id=root.id, role_id=admin_role.id, repo_read_baseline=_BASELINE,
    )
    unit_admin = User(
        name="uadmin", username="uadmin", password="x",
        unit_id=child.id, role_id=admin_role.id, repo_read_baseline=_BASELINE,
    )
    # Callers whose baseline we read (commander on root, member on child).
    commander = User(
        name="chief", username="chief", password="x",
        unit_id=root.id, role_id=member_role.id, repo_read_baseline=_BASELINE,
    )
    member = User(
        name="member", username="member", password="x",
        unit_id=child.id, role_id=member_role.id, repo_read_baseline=_BASELINE,
    )
    session.add_all([super_admin, unit_admin, commander, member])
    await session.flush()

    # Per-unit hidden repository conversations.
    root_repo = Conversation(
        name=repository_conversation_name(root.id),
        user_id=super_admin.id, initial_summary="",
    )
    child_repo = Conversation(
        name=repository_conversation_name(child.id),
        user_id=unit_admin.id, initial_summary="",
    )
    session.add_all([root_repo, child_repo])
    await session.flush()

    # Docs: super uploads into root repo AND into child repo (focusing child);
    # unit admin uploads into child repo. All post-baseline → unread.
    super_in_root = Document(
        id=uuid.uuid4(), conversation_id=root_repo.id, user_id=super_admin.id,
        name="super_root.pdf", status="COMPLETED", created_at=_NEW,
    )
    super_in_child = Document(
        id=uuid.uuid4(), conversation_id=child_repo.id, user_id=super_admin.id,
        name="super_child.pdf", status="COMPLETED", created_at=_NEW,
    )
    unitadmin_in_child = Document(
        id=uuid.uuid4(), conversation_id=child_repo.id, user_id=unit_admin.id,
        name="uadmin_child.pdf", status="COMPLETED", created_at=_NEW,
    )
    session.add_all([super_in_root, super_in_child, unitadmin_in_child])
    await session.flush()
    await session.commit()
    return {
        "root": root.id, "child": child.id,
        "super": super_admin.id, "uadmin": unit_admin.id,
        "commander": commander.id, "member": member.id,
    }


async def _scenario() -> None:
    engine = create_async_engine(TEST_DATABASE_URL)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        await _reset_schema(engine)
        async with factory() as session:
            ids = await _seed(session)

        async with factory() as session:
            repo = SqlAlchemyDocumentRepository(session)
            super_p = Principal(id=ids["super"], unit_id=ids["root"], is_admin=True)
            uadmin_p = Principal(id=ids["uadmin"], unit_id=ids["child"], is_admin=True)
            commander_p = Principal(
                id=ids["commander"], unit_id=ids["root"], is_admin=False,
                permissions=frozenset({"documents:read"}),
            )
            member_p = Principal(
                id=ids["member"], unit_id=ids["child"], is_admin=False,
            )

            # admins → 0 (no badge), despite unread docs existing.
            assert await repo.count_repo_notifications(super_p) == 0
            assert await repo.count_repo_notifications(uadmin_p) == 0

            # commander → ONLY the two super-admin uploads (root + child),
            # NOT the unit-admin upload.
            assert await repo.count_repo_notifications(commander_p) == 2

            # member → own (child) unit repo, ANY uploader = parity with the old
            # count (super_child + uadmin_child = 2).
            assert await repo.count_repo_notifications(member_p) == 2
            assert await repo.count_repo_notifications(member_p) == (
                await repo.count_unread_repo_documents(member_p)
            )

            # After the commander reads one super doc, its notification drops to 1.
            listing_ids = list(ids.values())  # noqa: F841 (kept for clarity)
            docs = (await repo.list_unit_repository_for_user(
                commander_p, target_unit_id=ids["root"]
            ))["items"]
            a_super_doc = next(d["id"] for d in docs)
            await repo.mark_repo_document_read(commander_p, a_super_doc)
            assert await repo.count_repo_notifications(commander_p) == 1
    finally:
        await engine.dispose()


def test_repo_notifications_role_aware() -> None:
    asyncio.run(_scenario())
