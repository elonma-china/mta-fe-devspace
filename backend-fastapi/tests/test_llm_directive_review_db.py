"""DB-backed test: info_table.type CHECK constraint as enforced by the
literal db/psql/migrate_010.sql, not merely as described by the
SQLAlchemy CheckConstraint object.

``test_llm_directive_review.py::test_info_table_allows_directive_review_type``
only inspects the ``sqltext`` string of the ORM's CheckConstraint in
Python — it would still pass even if migrate_010.sql itself had a SQL
syntax or quoting bug, since that file (not orm.py) is what actually
runs against already-deployed databases.

This test executes the migration file's literal statements against a
real PostgreSQL instance and round-trips real INSERTs through it, so a
bug in the file's SQL text surfaces as a real failure here.

Like ``test_repo_doc_read_db.py`` / ``test_repo_doc_owner_scope_db.py``
this runs against a real PostgreSQL instance and skips cleanly when
``TEST_DATABASE_URL`` is unset.
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.orm import Base, Conversation, InfoTable, Role, Unit, User

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="TEST_DATABASE_URL not set; skipping DB-backed migration test",
)

_MIGRATION_SQL = (
    Path(__file__).resolve().parents[2] / "db" / "psql" / "migrate_010.sql"
)


async def _reset_schema(engine) -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
        # Re-apply the literal migration file so the constraint under
        # test is exactly what runs against deployed databases, not
        # just what the ORM's CheckConstraint object says in Python.
        sql = _MIGRATION_SQL.read_text()
        for statement in sql.split(";"):
            statement = statement.strip()
            if statement:
                await conn.execute(text(statement))


async def _seed(session) -> dict:
    unit = Unit(name="u", parent_id=None)
    session.add(unit)
    await session.flush()
    role = Role(name="admin", unit_id=unit.id, is_admin=True)
    session.add(role)
    await session.flush()
    user = User(
        name="u", username="u", password="x",
        unit_id=unit.id, role_id=role.id,
    )
    session.add(user)
    await session.flush()
    conv = Conversation(name="c", user_id=user.id, initial_summary="")
    session.add(conv)
    await session.flush()
    await session.commit()
    return {"conversation_id": conv.id}


async def _scenario() -> None:
    engine = create_async_engine(TEST_DATABASE_URL)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        await _reset_schema(engine)
        async with factory() as session:
            ids = await _seed(session)

        async with factory() as session:
            conv_id = ids["conversation_id"]

            # The new type inserts cleanly under the constraint that
            # migrate_010.sql actually installs.
            session.add(
                InfoTable(
                    conversation_id=conv_id,
                    type="directive_review",
                    name="Directive Review",
                )
            )
            await session.commit()

            # The three pre-existing types must still insert
            # successfully after the migration.
            for existing in ("summary", "mindmap", "report"):
                session.add(
                    InfoTable(
                        conversation_id=conv_id,
                        type=existing,
                        name=existing,
                    )
                )
            await session.commit()

            # A bogus type is rejected by the real Postgres CHECK
            # constraint (not just by app-level validation).
            session.add(
                InfoTable(
                    conversation_id=conv_id,
                    type="not_a_type",
                    name="bogus",
                )
            )
            with pytest.raises(IntegrityError):
                await session.commit()
            await session.rollback()
    finally:
        await engine.dispose()


def test_migrate_010_check_constraint_enforced_by_postgres() -> None:
    asyncio.run(_scenario())
