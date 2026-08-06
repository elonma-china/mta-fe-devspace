"""Story 54 — DB-backed tests for repository read tracking (set-difference,
per-user, baseline, prune).

Like ``test_scoping.py`` these run against a real PostgreSQL instance (the
``ON CONFLICT`` upsert + recursive CTE + concat are Postgres-specific). They skip
when ``TEST_DATABASE_URL`` is unset or the database is unreachable.

Model under test (app/repositories/postgres.py):
  * UNREAD = a repository document with no ``document_read`` row for that user AND
    ``created_at > user.repo_read_baseline`` (sparse storage; set difference).
  * ``count_unread_repo_documents`` / ``list_documents_by_unit(viewer_user_id=)``
    expose it; ``mark_repo_document_read`` upserts (idempotent) and, once the user
    has caught up, advances the baseline and prunes redundant read rows.
"""

from __future__ import annotations

import asyncio
import os
from datetime import datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.access import Principal
from app.models.orm import (
    Base,
    Conversation,
    Document,
    DocumentRead,
    Role,
    Unit,
    User,
)
from app.repositories.postgres import (
    SqlAlchemyDocumentRepository,
    repository_conversation_name,
)

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="TEST_DATABASE_URL not set; skipping DB-backed read-tracking tests",
)

_BASELINE = datetime(2026, 1, 1, 12, 0, 0)
_OLD = _BASELINE - timedelta(days=1)   # before baseline → implicitly read
_NEW = _BASELINE + timedelta(days=1)   # after baseline → counts as unread


async def _reset_schema(engine) -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)


async def _seed(session) -> dict:
    unit = Unit(name="u", parent_id=None)
    session.add(unit)
    await session.flush()
    admin_role = Role(name="admin", unit_id=unit.id, is_admin=True)
    session.add(admin_role)
    await session.flush()

    admin = User(
        name="admin", username="admin", password="x",
        unit_id=unit.id, role_id=admin_role.id, repo_read_baseline=_BASELINE,
    )
    other = User(
        name="other", username="other", password="x",
        unit_id=unit.id, role_id=admin_role.id, repo_read_baseline=_BASELINE,
    )
    session.add_all([admin, other])
    await session.flush()

    # The unit's hidden repository conversation, owned by the admin.
    repo_conv = Conversation(
        name=repository_conversation_name(unit.id),
        user_id=admin.id, initial_summary="",
    )
    session.add(repo_conv)
    await session.flush()

    import uuid
    old_doc = Document(
        id=uuid.uuid4(), conversation_id=repo_conv.id, user_id=admin.id,
        name="old.pdf", status="COMPLETED", created_at=_OLD,
    )
    new_doc = Document(
        id=uuid.uuid4(), conversation_id=repo_conv.id, user_id=admin.id,
        name="new.pdf", status="COMPLETED", created_at=_NEW,
    )
    session.add_all([old_doc, new_doc])
    await session.flush()
    await session.commit()
    return {
        "unit": unit.id, "admin": admin.id, "other": other.id,
        "old_doc": str(old_doc.id), "new_doc": str(new_doc.id),
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
            admin_p = Principal(id=ids["admin"], unit_id=ids["unit"], is_admin=True)
            other_p = Principal(id=ids["other"], unit_id=ids["unit"], is_admin=True)

            # Only the post-baseline doc is unread (old is implicitly read).
            assert await repo.count_unread_repo_documents(admin_p) == 1

            # list flags is_unread per the viewer: new=True, old=False.
            listing = await repo.list_documents_by_unit(
                admin_p, target_unit_id=ids["unit"], viewer_user_id=ids["admin"]
            )
            by_id = {it["id"]: it for it in listing["items"]}
            assert by_id[ids["new_doc"]]["is_unread"] is True
            assert by_id[ids["old_doc"]]["is_unread"] is False

            # Marking read is visibility-gated + idempotent.
            assert await repo.mark_repo_document_read(admin_p, ids["new_doc"]) is True
            assert await repo.mark_repo_document_read(admin_p, ids["new_doc"]) is True

            # The other admin is unaffected (per-user state).
            assert await repo.count_unread_repo_documents(other_p) == 1

            # Admin has now caught up → compaction advanced the baseline and
            # pruned the read rows (table stays small), and count stays 0.
            assert await repo.count_unread_repo_documents(admin_p) == 0
            rows = (
                await session.execute(
                    select(DocumentRead).where(DocumentRead.user_id == ids["admin"])
                )
            ).all()
            assert rows == []  # redundant rows pruned after catch-up

            # A foreign / non-existent doc is not markable → False (route → 404).
            assert (
                await repo.mark_repo_document_read(
                    admin_p, "00000000-0000-0000-0000-000000000000"
                )
                is False
            )
    finally:
        await engine.dispose()


def test_repo_read_tracking_set_difference_and_prune() -> None:
    asyncio.run(_scenario())
