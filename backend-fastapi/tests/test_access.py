"""Unit tests for access-scoping SQL helpers (compile-only, no DB).

The recursive CTE is Postgres-specific, but we only need to compile the
statement to catch the "Multiple, unrelated CTEs found with the same name"
collision that broke the document-repository list (story 08 → fixed in 09).
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.dialects import postgresql

from app.models.access import accessible_unit_ids
from app.models.orm import User


def _compile(stmt) -> str:
    return str(stmt.compile(dialect=postgresql.dialect()))


def test_two_accessible_unit_ids_in_one_query_compile_distinct_ctes() -> None:
    """Combining two ``accessible_unit_ids`` scopes in one statement must compile
    (distinct CTE names), not raise a name-collision CompileError.

    This is the exact shape ``list_documents_by_unit`` builds: the caller's own
    scope plus a focused target unit.
    """
    stmt = select(User.id).where(
        User.unit_id.in_(accessible_unit_ids(2)),
        User.unit_id.in_(accessible_unit_ids(4)),
    )

    sql = _compile(stmt)

    # Both recursive CTEs are present under DIFFERENT names (no collision).
    assert sql.count("accessible_units") >= 2


def test_same_unit_twice_compiles() -> None:
    """Even the same unit id used twice must not collide (distinct CTE objects)."""
    stmt = select(User.id).where(
        User.unit_id.in_(accessible_unit_ids(2)),
        User.id.in_(select(User.id).where(User.unit_id.in_(accessible_unit_ids(2)))),
    )

    # Must not raise CompileError.
    _compile(stmt)
