"""Integration tests for unit-tree access scoping.

These run against a real PostgreSQL instance (the recursive CTE is
Postgres-specific). Set ``TEST_DATABASE_URL`` to a SQLAlchemy asyncpg URL, e.g.
``postgresql+asyncpg://postgres:postgres@localhost:55432/intramind``. The tests
skip when it is unset or the database is unreachable.

Tree built per test:

    root (unit 1, user root_admin)
     └── child (unit 2, users child_admin, child_member)
          └── grandchild (unit 3, user gc_member)
    sibling (unit 4, user sib_member)  ── also a child of root

Rule under test (app/models/access.py):
  * non-admin → own resources only
  * admin → own unit + all descendant units
  * root admin → everything
"""

from __future__ import annotations

import asyncio
import os

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.access import Principal
from app.models.orm import Base, Conversation, Role, Unit, User
from app.repositories.postgres import (
    SqlAlchemyConversationRepository,
    SqlAlchemyUserRepository,
)

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="TEST_DATABASE_URL not set; skipping DB-backed scoping tests",
)


async def _reset_schema(engine) -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)


async def _seed(session) -> dict[str, int]:
    """Create the unit tree, roles, users and one conversation per user."""
    root = Unit(name="root", parent_id=None)
    session.add(root)
    await session.flush()
    child = Unit(name="child", parent_id=root.id)
    sibling = Unit(name="sibling", parent_id=root.id)
    session.add_all([child, sibling])
    await session.flush()
    grandchild = Unit(name="grandchild", parent_id=child.id)
    session.add(grandchild)
    await session.flush()

    units = {
        "root": root.id,
        "child": child.id,
        "sibling": sibling.id,
        "grandchild": grandchild.id,
    }

    roles: dict[str, int] = {}
    for key, uid in units.items():
        admin = Role(name="admin", unit_id=uid, is_admin=True)
        member = Role(name="member", unit_id=uid, is_admin=False)
        session.add_all([admin, member])
        await session.flush()
        roles[f"{key}_admin"] = admin.id
        roles[f"{key}_member"] = member.id

    users = {
        "root_admin": (units["root"], roles["root_admin"]),
        "child_admin": (units["child"], roles["child_admin"]),
        "child_member": (units["child"], roles["child_member"]),
        "gc_member": (units["grandchild"], roles["grandchild_member"]),
        "sib_member": (units["sibling"], roles["sibling_member"]),
    }
    ids: dict[str, int] = dict(units)
    for name, (uid, rid) in users.items():
        u = User(name=name, username=name, password="x", unit_id=uid, role_id=rid)
        session.add(u)
        await session.flush()
        ids[name] = u.id
        session.add(
            Conversation(name=f"{name}-conv", user_id=u.id, initial_summary="")
        )
    await session.flush()
    await session.commit()
    return ids


def _principal(session_ids: dict[str, int], user: str, unit: int, admin: bool):
    return Principal(id=session_ids[user], unit_id=unit, is_admin=admin)


def _run(coro):
    return asyncio.run(coro)


async def _scenario():
    engine = create_async_engine(TEST_DATABASE_URL)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        await _reset_schema(engine)
        async with factory() as session:
            ids = await _seed(session)

        async with factory() as session:
            conv_repo = SqlAlchemyConversationRepository(session)
            user_repo = SqlAlchemyUserRepository(session)

            def names(rows):
                return {r["name"] for r in rows}

            # Non-admin child_member: only own conversation.
            p = _principal(ids, "child_member", ids["child"], admin=False)
            convs = await conv_repo.list_visible(p)
            assert names(convs) == {"child_member-conv"}

            # Admin of child: child + grandchild, not root/sibling.
            p = _principal(ids, "child_admin", ids["child"], admin=True)
            convs = await conv_repo.list_visible(p)
            assert names(convs) == {
                "child_admin-conv",
                "child_member-conv",
                "gc_member-conv",
            }

            # Root admin: everything.
            p = _principal(ids, "root_admin", ids["root"], admin=True)
            convs = await conv_repo.list_visible(p)
            assert names(convs) == {
                "root_admin-conv",
                "child_admin-conv",
                "child_member-conv",
                "gc_member-conv",
                "sib_member-conv",
            }

            # Unit-less admin = structural super-admin: sees everything.
            p = Principal(id=ids["root_admin"], unit_id=None, is_admin=True)
            convs = await conv_repo.list_visible(p)
            assert len(convs) == 5

            # User visibility mirrors the same rule.
            p = _principal(ids, "child_admin", ids["child"], admin=True)
            users = await user_repo.list_visible(p)
            assert {u["username"] for u in users} == {
                "child_admin",
                "child_member",
                "gc_member",
            }

            # is_unit_accessible: child admin can manage grandchild, not sibling.
            assert await user_repo.is_unit_accessible(p, ids["grandchild"]) is True
            assert await user_repo.is_unit_accessible(p, ids["sibling"]) is False
            assert await user_repo.is_unit_accessible(p, ids["root"]) is False
    finally:
        await engine.dispose()


def test_unit_tree_scoping_visibility_matches_rule():
    """Non-admins see own; admins see their subtree; root admin sees all."""
    _run(_scenario())
