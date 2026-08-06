"""Story 62 — DB-backed tests: repository documents are scoped by UNIT
(conversation), NOT by the uploader's unit (owner).

A super-admin uploads/manages documents on behalf of a unit; those rows are owned
by the super-admin (root unit) but live in the unit's hidden repository
conversation. The unit's own admin must still SEE and ACCESS them (ADR-005: the
repository is keyed per unit, not per owner). Before the fix, the admin list and
``find_visible`` filtered by ``owner.unit_id`` (subtree), hiding super-admin
uploads from the unit admin — the reported "tài liệu biến mất" bug.

Runs against a real PostgreSQL (recursive CTE + concat are Postgres-specific);
skips when ``TEST_DATABASE_URL`` is unset.
"""

from __future__ import annotations

import asyncio
import os
import uuid

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.access import Principal
from app.models.orm import Base, Conversation, Document, Role, Unit, User
from app.repositories.postgres import (
    SqlAlchemyDocumentRepository,
    repository_conversation_name,
)

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="TEST_DATABASE_URL not set; skipping DB-backed owner-scope tests",
)


async def _reset_schema(engine) -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)


async def _seed(session) -> dict:
    root = Unit(name="root", parent_id=None)
    session.add(root)
    await session.flush()
    unit_x = Unit(name="X", parent_id=root.id)
    unit_y = Unit(name="Y", parent_id=root.id)
    session.add_all([unit_x, unit_y])
    await session.flush()

    role = Role(name="admin", unit_id=root.id, is_admin=True)
    session.add(role)
    await session.flush()

    # super-admin sits at the ROOT unit; unit admins at their own unit.
    super_admin = User(name="sa", username="sa", password="x",
                       unit_id=root.id, role_id=role.id)
    admin_x = User(name="ax", username="ax", password="x",
                   unit_id=unit_x.id, role_id=role.id)
    admin_y = User(name="ay", username="ay", password="x",
                   unit_id=unit_y.id, role_id=role.id)
    session.add_all([super_admin, admin_x, admin_y])
    await session.flush()

    # Unit X's hidden repository conversation.
    repo_x = Conversation(
        name=repository_conversation_name(unit_x.id),
        user_id=super_admin.id, initial_summary="",
    )
    repo_y = Conversation(
        name=repository_conversation_name(unit_y.id),
        user_id=super_admin.id, initial_summary="",
    )
    session.add_all([repo_x, repo_y])
    await session.flush()

    # doc_own: uploaded by unit X's own member; doc_sa: uploaded by the super-admin
    # (root unit) on behalf of unit X. Both live in unit X's repository.
    doc_own = Document(id=uuid.uuid4(), conversation_id=repo_x.id,
                       user_id=admin_x.id, name="own.pdf", status="COMPLETED")
    doc_sa = Document(id=uuid.uuid4(), conversation_id=repo_x.id,
                      user_id=super_admin.id, name="sa.pdf", status="APPROVED")
    session.add_all([doc_own, doc_sa])
    await session.flush()
    await session.commit()
    return {
        "root": root.id, "unit_x": unit_x.id, "unit_y": unit_y.id,
        "super_admin": super_admin.id, "admin_x": admin_x.id, "admin_y": admin_y.id,
        "doc_own": str(doc_own.id), "doc_sa": str(doc_sa.id),
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
            admin_x = Principal(id=ids["admin_x"], unit_id=ids["unit_x"], is_admin=True)
            admin_y = Principal(id=ids["admin_y"], unit_id=ids["unit_y"], is_admin=True)
            super_admin = Principal(id=ids["super_admin"], unit_id=ids["root"], is_admin=True)

            # (a) Unit X admin sees BOTH docs in X's repository — including the one
            # uploaded by the super-admin (root owner). This is the bug fix.
            listing = await repo.list_documents_by_unit(
                admin_x, target_unit_id=ids["unit_x"]
            )
            got = {it["id"] for it in listing["items"]}
            assert ids["doc_own"] in got
            assert ids["doc_sa"] in got, "super-admin-uploaded doc hidden from unit admin"
            assert listing["total"] == 2

            # Super-admin focusing unit X sees the same set.
            sa_listing = await repo.list_documents_by_unit(
                super_admin, target_unit_id=ids["unit_x"]
            )
            assert {it["id"] for it in sa_listing["items"]} == got

            # (b) Unit X admin can ACCESS the super-admin-owned doc (view/edit/approve
            # all gate on find_visible) — no more 404 / "see but can't open".
            assert await repo.find_visible(admin_x, ids["doc_sa"]) is not None

            # (c) Isolation: unit Y admin sees neither doc (they live in X's repo) and
            # cannot find_visible the foreign-owned doc.
            y_listing = await repo.list_documents_by_unit(
                admin_y, target_unit_id=ids["unit_y"]
            )
            assert y_listing["total"] == 0
            assert await repo.find_visible(admin_y, ids["doc_sa"]) is None

            # Chat-doc owner-scope is unchanged: a doc in a NON-repo conversation
            # owned by someone outside the admin's subtree stays hidden.
            # (covered by existing test_scoping / test_doc_repository.)
    finally:
        await engine.dispose()


def test_repo_documents_scoped_by_unit_not_owner() -> None:
    asyncio.run(_scenario())
