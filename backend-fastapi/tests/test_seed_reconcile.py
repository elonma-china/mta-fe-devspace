"""Story 69 — role→permission reconcile in the seed.

The seed must SYNC each role's permission set to the desired set for its role-type
(insert missing, update changed scope, delete extras WITHIN the managed catalog),
so updating permissions and redeploying actually takes effect — unlike the old
insert-once ``ON CONFLICT DO NOTHING``. On already-correct data the reconcile is a
no-op (empty diff).

The seed script lives at ``db/psql/seed.py`` (a standalone script, not a package),
so it is loaded by path here to unit-test its pure helpers without a database.
"""

from __future__ import annotations

import importlib.util
import pathlib

_SEED_PATH = (
    pathlib.Path(__file__).resolve().parents[2] / "db" / "psql" / "seed.py"
)
_spec = importlib.util.spec_from_file_location("seed_mod", _SEED_PATH)
seed = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(seed)

ALL = set(seed.ALL_ACTIONS)


# ── _desired_for_role: the single source of truth per role-type ────────


def test_desired_super_admin_is_all_actions_all_scope() -> None:
    desired = dict(seed._desired_for_role("Quản trị viên", 1, True))
    assert set(desired) == ALL
    assert all(scope == "all" for scope in desired.values())


def test_desired_unit_admin_is_six_actions_subtree() -> None:
    desired = dict(seed._desired_for_role("Quản trị viên", 5, True))
    assert set(desired) == {
        "users:manage",
        "units:read",
        "roles:read",
        "documents:read",
        "documents:manage",
        "docgroups:manage",
    }
    assert all(scope == "unit_subtree" for scope in desired.values())


def test_desired_commander_is_read_only_across_units() -> None:
    # Story 101: the commander ("Chỉ huy") is VIEW-ONLY — it reads documents +
    # units across all units but holds NO write capability. The write caps
    # (documents:manage, docgroups:manage) were removed so uploading, creating/
    # editing/deleting groups and documents all 403 for the commander.
    desired = dict(seed._desired_for_role(seed.COMMANDER_ROLE_NAME, 1, False))
    assert desired == {
        "documents:read": "all",
        "units:read": "all",
    }
    assert "documents:manage" not in desired
    assert "docgroups:manage" not in desired


def test_desired_member_is_empty() -> None:
    assert seed._desired_for_role("Người dùng", 5, False) == []


# ── _reconcile_diff: pure insert/update/delete computation ─────────────


def test_reconcile_diff_no_change_on_correct_data() -> None:
    desired = [("documents:read", "all"), ("documents:manage", "all")]
    current = {"documents:read": "all", "documents:manage": "all"}
    diff = seed._reconcile_diff(current, desired, ALL)
    assert diff["insert"] == []
    assert diff["update"] == []
    assert diff["delete"] == []


def test_reconcile_diff_inserts_missing() -> None:
    diff = seed._reconcile_diff({}, [("documents:read", "all")], ALL)
    assert diff["insert"] == [("documents:read", "all")]
    assert diff["update"] == [] and diff["delete"] == []


def test_reconcile_diff_updates_changed_scope() -> None:
    diff = seed._reconcile_diff(
        {"documents:read": "own"}, [("documents:read", "all")], ALL
    )
    assert diff["update"] == [("documents:read", "all")]
    assert diff["insert"] == [] and diff["delete"] == []


def test_reconcile_diff_deletes_extra_within_catalog() -> None:
    diff = seed._reconcile_diff({"audit:read": "all"}, [], ALL)
    assert diff["delete"] == ["audit:read"]


def test_reconcile_diff_keeps_grants_outside_managed_catalog() -> None:
    # Chốt (a): only catalog actions are reconciled; an out-of-catalog grant
    # (e.g. a future action seed.py doesn't know) is left untouched.
    diff = seed._reconcile_diff({"custom:thing": "all"}, [], ALL)
    assert diff["delete"] == []
