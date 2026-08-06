"""Unit-tree access scoping helpers.

The access model is:

* A **non-admin** user may view/act on **only their own** resources.
* An **admin** user may view/act on resources owned by users in **their unit
  and all descendant units** (recursive down the unit tree).
* The admin of the **root unit** therefore covers the whole tree — that is the
  structural "super-admin"; there is no separate bypass flag.

These helpers build the recursive CTE and the SQLAlchemy boolean conditions used
by every repository, so the rule lives in exactly one place.
"""

from __future__ import annotations

import itertools
from dataclasses import dataclass
from typing import Any

from sqlalchemy import ColumnElement, Select, select, true
from sqlalchemy.sql.selectable import CTE

from app.models.orm import Unit

# Monotonic counter giving each recursive CTE a unique name. A fixed name
# ("accessible_units") collides when two unrelated scopes appear in one
# statement (e.g. the caller's scope + a focused target unit in the document
# repository list), raising SQLAlchemy's "Multiple, unrelated CTEs found with
# the same name" CompileError. A per-call suffix keeps each CTE distinct.
_cte_counter = itertools.count()

# The reserved root unit id. An admin on the root unit is the structural
# super-admin and must be scoped to *everything*, exactly like a unit-less admin
# (see ``scope_condition``). Mirrors ``ROOT_UNIT_ID`` in the route modules; kept
# here so the scoping rule has a single, self-contained definition.
ROOT_UNIT_ID = 1


@dataclass(frozen=True)
class Principal:
    """The authenticated caller, used to scope queries.

    ``permissions`` (story 66) is the set of capability action strings resolved
    from the caller's role (e.g. ``documents:manage``). It is layered alongside
    ``is_admin`` for backward compatibility — the read-scoping below still keys
    off ``is_admin``; the per-action gates use :meth:`can`.
    """

    id: int
    unit_id: int | None
    is_admin: bool
    permissions: frozenset[str] = frozenset()

    @classmethod
    def from_user(cls, user: dict[str, Any]) -> Principal:
        """Build a principal from the auth dependency's user dict."""
        return cls(
            id=int(user["id"]),
            unit_id=user.get("unit_id"),
            is_admin=bool(user.get("is_admin")),
            permissions=frozenset(user.get("permissions") or ()),
        )

    def can(self, action: str) -> bool:
        """Whether the caller holds the capability ``action`` (any scope)."""
        return action in self.permissions


def accessible_units_cte(unit_id: int) -> CTE:
    """Recursive CTE of ``unit_id`` plus every descendant unit id.

    Each call gets a unique CTE name so multiple scopes can coexist in a single
    statement without colliding.
    """
    anchor = (
        select(Unit.id.label("id"))
        .where(Unit.id == unit_id)
        .cte(f"accessible_units_{next(_cte_counter)}", recursive=True)
    )
    descendants = select(Unit.id).join(anchor, Unit.parent_id == anchor.c.id)
    return anchor.union_all(descendants)


def accessible_unit_ids(unit_id: int) -> Select[tuple[int]]:
    """SELECT of accessible unit ids, usable inside ``IN (...)``."""
    cte = accessible_units_cte(unit_id)
    return select(cte.c.id)


def scope_condition(
    principal: Principal,
    owner_id_col: ColumnElement[Any],
    owner_unit_col: ColumnElement[Any],
) -> ColumnElement[bool]:
    """WHERE condition restricting a resource to what ``principal`` may access.

    Args:
        principal: The authenticated caller.
        owner_id_col: Column holding the resource owner's user id.
        owner_unit_col: Column holding the resource owner's unit id.

    Returns:
        A boolean SQLAlchemy expression. Non-admins are limited to their own
        rows; admins to their unit subtree (root admin → everything).
    """
    if principal.is_admin:
        if principal.unit_id is None or principal.unit_id == ROOT_UNIT_ID:
            # Structural super-admin (no unit OR the root unit): sees everything.
            # Story 86: the root-unit admin was previously scoped to the root
            # SUBTREE (recursive parent_id), which silently dropped users in any
            # unit whose parent_id didn't chain back to root. The rest of the app
            # already treats the root unit as super; align here so an imperfect
            # tree can't hide users from the super-admin's lists.
            return true()
        return owner_unit_col.in_(accessible_unit_ids(principal.unit_id))
    # Non-admin: own resources only.
    return owner_id_col == principal.id
