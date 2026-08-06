"""Baseline: hybrid unit-tree + flat per-unit RBAC schema.

This is the Alembic baseline for a fresh database. It applies the canonical
schema defined in ``db/psql/init.sql`` (single source of truth, including the
root unit / default roles seed) so ``alembic upgrade head`` builds an empty DB
to the current model. Existing databases on the pre-hybrid schema are brought
forward by ``db/psql/migrate_002.sql`` instead; stamp this revision on them.

Revision ID: 0001_baseline
Revises:
Create Date: 2026-05-23
"""

from __future__ import annotations

from alembic import op

from app.models.orm import Base

revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None

# Seed statements, run individually (asyncpg forbids multi-statement prepares).
_SEED = (
    "INSERT INTO unit (id, name, parent_id) VALUES (1, 'Tổng', NULL) "
    "ON CONFLICT (id) DO NOTHING",
    "SELECT setval('unit_id_seq', COALESCE((SELECT MAX(id)+1 FROM unit), 1), false)",
    "INSERT INTO role (id, name, unit_id, is_admin) VALUES "
    "(1, 'Quản trị viên', 1, TRUE), (2, 'Người dùng', 1, FALSE) "
    "ON CONFLICT (id) DO NOTHING",
    "SELECT setval('role_id_seq', COALESCE((SELECT MAX(id)+1 FROM role), 1), false)",
)


def upgrade() -> None:
    """Create all tables from the ORM metadata, then seed root unit/roles."""
    bind = op.get_bind()
    Base.metadata.create_all(bind)
    for stmt in _SEED:
        op.execute(stmt)


def downgrade() -> None:
    """Drop every table created by the baseline."""
    op.execute(
        "DROP TABLE IF EXISTS audit_log, info_table, document, "
        "document_group, conversation, \"user\", role, unit CASCADE"
    )
