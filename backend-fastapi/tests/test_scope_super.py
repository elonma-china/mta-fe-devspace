"""Unit tests for the super-admin scoping rule (compile-only, no DB).

Story 86: a root-unit admin (``unit_id == ROOT_UNIT_ID``) must be scoped as a
structural super-admin — i.e. ``scope_condition`` returns an unconditional
``true()`` instead of a recursive ``unit_id IN accessible_units(root)`` subtree.

On a healthy unit tree both forms select the same rows (root's subtree = every
unit), so this only matters when the tree is imperfect (an orphaned unit whose
``parent_id`` doesn't chain back to root): the subtree form silently drops those
units' users from the root-admin's list, the ``true()`` form does not. The rest
of the app already treats ``unit_id == ROOT_UNIT_ID`` as super (routes/user.py),
so this aligns the scope helper with that definition.
"""

from __future__ import annotations

from sqlalchemy.dialects import postgresql

from app.models.access import ROOT_UNIT_ID, Principal, scope_condition
from app.models.orm import User


def _compile(expr) -> str:
    return str(expr.compile(dialect=postgresql.dialect()))


def test_structural_super_admin_sees_everything() -> None:
    """Admin with no unit → unconditional true()."""
    p = Principal(id=1, unit_id=None, is_admin=True)
    assert _compile(scope_condition(p, User.id, User.unit_id)) == "true"


def test_root_unit_admin_is_super_not_subtree() -> None:
    """Admin on the ROOT unit → same unconditional true() as the structural
    super-admin (not a recursive subtree scan)."""
    root_admin = Principal(id=1, unit_id=ROOT_UNIT_ID, is_admin=True)
    structural = Principal(id=1, unit_id=None, is_admin=True)
    assert _compile(
        scope_condition(root_admin, User.id, User.unit_id)
    ) == _compile(scope_condition(structural, User.id, User.unit_id))
    assert _compile(scope_condition(root_admin, User.id, User.unit_id)) == "true"


def test_unit_admin_still_scoped_to_subtree() -> None:
    """A non-root unit admin stays scoped (NOT super) — no over-broadening."""
    p = Principal(id=1, unit_id=2, is_admin=True)
    sql = _compile(scope_condition(p, User.id, User.unit_id))
    assert sql != "true"
    assert "IN" in sql.upper()


def test_non_admin_scoped_to_own_rows() -> None:
    """A non-admin sees only their own rows (unchanged)."""
    p = Principal(id=7, unit_id=2, is_admin=False)
    sql = _compile(scope_condition(p, User.id, User.unit_id))
    assert sql != "true"
