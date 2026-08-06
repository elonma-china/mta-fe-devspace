"""Seed canonical reference data into a current-schema database.

This is a *seed* script, not a migration: schema changes live in
``db/psql/init.sql`` (applied on startup) and the versioned
``db/psql/migrate_NNN.sql`` files (applied by the ``db-migrate`` service).
This script assumes those have already run and only populates the canonical
reference graph the application needs to function:

* the **root unit** (id 1, 'Tổng') — the top of the unit tree;
* its two default **roles** — admin (``is_admin`` TRUE) and member
  (``is_admin`` FALSE), scoped to the root unit;
* the **super-admin** user (``admin``/``admin``) placed in the root unit with
  the root admin role. The admin of the root unit covers the whole tree, so it
  is the structural super-admin.

Every step is idempotent, so the script is safe to re-run. Connection settings
come from the same ``DB_*`` environment variables used by the compose stack.
"""

import asyncio
import logging
import os

import asyncpg
import bcrypt

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

ROOT_UNIT_ID = 1
ROOT_UNIT_NAME = "Tổng"
ADMIN_ROLE_ID = 1
MEMBER_ROLE_ID = 2
ADMIN_USERNAME = "admin"
ADMIN_PASSWORD = "admin"

# Story 66 — RBAC granular. The full capability catalog (mirrors
# migrate_007.sql / init.sql) and the role→permission seed mapping. Seeding the
# permission grants here (not only in migrate_007) is required because on a fresh
# database migrate_007's backfill runs BEFORE these roles exist.
ALL_ACTIONS = [
    "users:manage",
    "units:manage",
    "units:read",
    "roles:read",
    "roles:manage",
    "documents:read",
    "documents:manage",
    "docgroups:manage",
    "audit:read",
]
COMMANDER_ROLE_NAME = "Chỉ huy"
# Commander ("Chỉ huy") is VIEW-ONLY across all units (story 101): it READS
# repository documents + units of every unit but holds NO write capability — only
# the super admin creates groups / uploads documents at the command level. The
# write caps (documents:manage, docgroups:manage) were removed so every write
# route 403s for the commander (is_admin stays FALSE). Group LIST is a read, so it
# is gated on documents:read (which the commander keeps), not docgroups:manage.
COMMANDER_GRANTS = [
    ("documents:read", "all"),
    ("units:read", "all"),
]
# A non-root admin ("Quản trị viên" of a child unit) manages its subtree. MUST
# stay in sync with ``_UNIT_ADMIN_GRANTS`` in
# ``backend-fastapi/app/repositories/postgres.py`` (the runtime create-time grant
# for units made between deploys); the deploy-time reconcile below re-syncs them.
UNIT_ADMIN_GRANTS = [
    ("users:manage", "unit_subtree"),
    ("units:read", "unit_subtree"),
    ("roles:read", "unit_subtree"),
    ("documents:read", "unit_subtree"),
    ("documents:manage", "unit_subtree"),
    ("docgroups:manage", "unit_subtree"),
]
# (display name, username) — both seeded with password ADMIN_PASSWORD on the root
# unit, holding the commander role.
CHIEF_ACCOUNTS = [
    ("Thủ trưởng cục", "thutruong_cuc"),
    ("Thủ trưởng tổng cục", "thutruong_tongcuc"),
]


def _hash_password(plaintext: str) -> str:
    """Return a bcrypt hash of ``plaintext`` (10 rounds, matching the app)."""
    return bcrypt.hashpw(
        plaintext.encode(), bcrypt.gensalt(rounds=10)
    ).decode()


def _desired_for_role(
    name: str, unit_id: int | None, is_admin: bool
) -> list[tuple[str, str]]:
    """The desired (action, scope) permission set for a role's TYPE (story 69).

    Single source of truth, classified by (name, unit, is_admin):
    commander → document capabilities; root admin → every action (super);
    non-root admin → the unit-admin set; everyone else (members) → none.
    """
    if name == COMMANDER_ROLE_NAME:
        return list(COMMANDER_GRANTS)
    if is_admin:
        if unit_id == ROOT_UNIT_ID:
            return [(action, "all") for action in ALL_ACTIONS]
        return list(UNIT_ADMIN_GRANTS)
    return []


def _reconcile_diff(
    current: dict[str, str],
    desired: list[tuple[str, str]],
    managed: set[str],
) -> dict[str, list]:
    """Compute the insert/update/delete to sync ``current`` → ``desired`` (pure).

    ``delete`` is limited to actions in ``managed`` (the known catalog) so an
    out-of-catalog grant is never wiped (story 69, decision a).
    """
    desired_map = dict(desired)
    insert: list[tuple[str, str]] = []
    update: list[tuple[str, str]] = []
    for action, scope in desired:
        cur = current.get(action)
        if cur is None:
            insert.append((action, scope))
        elif cur != scope:
            update.append((action, scope))
    delete = [
        action
        for action in current
        if action in managed and action not in desired_map
    ]
    return {"insert": insert, "update": update, "delete": delete}


async def _reconcile_permissions(
    conn: asyncpg.Connection,
    role_id: int,
    desired: list[tuple[str, str]],
) -> None:
    """Sync ``role_id``'s grants to ``desired`` (insert/update/delete) — story 69.

    Idempotent: on already-correct data nothing is written. Deletions are scoped
    to the managed catalog (``ALL_ACTIONS``), so re-running after a permission
    change applies it without wiping out-of-catalog grants.
    """
    rows = await conn.fetch(
        "SELECT p.action, rp.scope FROM role_permission rp "
        "JOIN permission p ON p.id = rp.permission_id "
        "WHERE rp.role_id = $1",
        role_id,
    )
    current = {r["action"]: r["scope"] for r in rows}
    diff = _reconcile_diff(current, desired, set(ALL_ACTIONS))
    for action, scope in diff["insert"]:
        await conn.execute(
            "INSERT INTO role_permission (role_id, permission_id, scope) "
            "SELECT $1, p.id, $3 FROM permission p WHERE p.action = $2 "
            "ON CONFLICT (role_id, permission_id) DO NOTHING;",
            role_id,
            action,
            scope,
        )
    for action, scope in diff["update"]:
        await conn.execute(
            "UPDATE role_permission SET scope = $3 FROM permission p "
            "WHERE role_permission.role_id = $1 "
            "AND role_permission.permission_id = p.id AND p.action = $2;",
            role_id,
            action,
            scope,
        )
    for action in diff["delete"]:
        await conn.execute(
            "DELETE FROM role_permission USING permission p "
            "WHERE role_permission.role_id = $1 "
            "AND role_permission.permission_id = p.id AND p.action = $2;",
            role_id,
            action,
        )


async def _reconcile_all_roles(conn: asyncpg.Connection) -> None:
    """Reconcile EVERY role's permissions to its role-type's desired set.

    Covers the root admin/member, the commander, AND every per-unit role created
    at runtime — so changing the desired set and redeploying takes effect on all
    of them (story 69).
    """
    roles = await conn.fetch(
        "SELECT id, name, unit_id, is_admin FROM role"
    )
    for r in roles:
        desired = _desired_for_role(r["name"], r["unit_id"], r["is_admin"])
        await _reconcile_permissions(conn, r["id"], desired)


async def _connect() -> asyncpg.Connection:
    """Open a connection using the ``DB_*`` environment variables."""
    return await asyncpg.connect(
        host=os.getenv("DB_HOST", "localhost"),
        port=int(os.getenv("DB_PORT", "5432")),
        user=os.getenv("DB_USER", "postgres"),
        password=os.getenv("DB_PASSWORD", "postgres"),
        database=os.getenv("DB_NAME", "intramind"),
    )


async def _seed_root_unit(conn: asyncpg.Connection) -> None:
    """Seed the root unit (id 1, 'Tổng') and advance the id sequence."""
    logger.info("Seeding root unit...")
    await conn.execute(
        """
        INSERT INTO unit (id, name, parent_id) VALUES ($1, $2, NULL)
        ON CONFLICT (id) DO NOTHING;
        """,
        ROOT_UNIT_ID,
        ROOT_UNIT_NAME,
    )
    await conn.execute(
        """
        SELECT setval(
            'unit_id_seq',
            COALESCE((SELECT MAX(id) + 1 FROM unit), 1),
            false
        );
        """
    )


async def _seed_root_roles(conn: asyncpg.Connection) -> None:
    """Seed the root unit's admin/member roles and advance the sequence."""
    logger.info("Seeding root-unit roles...")
    await conn.execute(
        """
        INSERT INTO role (id, name, unit_id, is_admin) VALUES
            ($1, 'Quản trị viên', $3, TRUE),
            ($2, 'Người dùng',    $3, FALSE)
        ON CONFLICT (id) DO UPDATE SET
            name     = EXCLUDED.name,
            unit_id  = EXCLUDED.unit_id,
            is_admin = EXCLUDED.is_admin;
        """,
        ADMIN_ROLE_ID,
        MEMBER_ROLE_ID,
        ROOT_UNIT_ID,
    )
    await conn.execute(
        """
        SELECT setval(
            'role_id_seq',
            COALESCE((SELECT MAX(id) + 1 FROM role), 1),
            false
        );
        """
    )
    # Story 69: role→permission grants are synced by _reconcile_all_roles at the
    # end of run_seed (a single authoritative pass over every role), so a
    # permission change takes effect on redeploy. Root admin = every action 'all';
    # member = none — both handled there.


async def _seed_super_admin(conn: asyncpg.Connection) -> None:
    """Ensure the super-admin user exists in the root unit with admin role."""
    row = await conn.fetchrow(
        'SELECT id FROM "user" WHERE username = $1', ADMIN_USERNAME
    )
    if row is not None:
        # Keep an existing super-admin pinned to the root unit/role.
        logger.info("Super-admin exists; pinning to root unit/role...")
        await conn.execute(
            'UPDATE "user" SET unit_id = $2, role_id = $3 '
            "WHERE username = $1",
            ADMIN_USERNAME,
            ROOT_UNIT_ID,
            ADMIN_ROLE_ID,
        )
        return

    logger.info("Creating super-admin account: %s/%s", ADMIN_USERNAME,
                ADMIN_PASSWORD)
    await conn.execute(
        'INSERT INTO "user" (name, username, password, unit_id, role_id) '
        "VALUES ($1, $2, $3, $4, $5)",
        "Admin",
        ADMIN_USERNAME,
        _hash_password(ADMIN_PASSWORD),
        ROOT_UNIT_ID,
        ADMIN_ROLE_ID,
    )


async def _seed_commander_role(conn: asyncpg.Connection) -> int:
    """Ensure the "Chỉ huy" commander role exists and return its id (story 66).

    Anchored to the root unit with ``is_admin`` FALSE, granted read+manage of
    repository documents across all units. Idempotent.
    """
    role_id = await conn.fetchval(
        "SELECT id FROM role WHERE unit_id = $1 AND name = $2",
        ROOT_UNIT_ID,
        COMMANDER_ROLE_NAME,
    )
    if role_id is None:
        logger.info("Creating commander role '%s'...", COMMANDER_ROLE_NAME)
        role_id = await conn.fetchval(
            "INSERT INTO role (name, unit_id, is_admin) "
            "VALUES ($1, $2, FALSE) RETURNING id",
            COMMANDER_ROLE_NAME,
            ROOT_UNIT_ID,
        )
    # Permissions are synced by _reconcile_all_roles (story 69).
    return role_id


async def _seed_chief_accounts(
    conn: asyncpg.Connection, commander_role_id: int
) -> None:
    """Ensure the two commander accounts exist with the commander role (story 66).

    Idempotent: an existing account is re-pinned to the commander role/root unit;
    a missing one is created with the default password. Passwords are NOT reset
    on re-run (only the role/unit are pinned).
    """
    for name, username in CHIEF_ACCOUNTS:
        row = await conn.fetchrow(
            'SELECT id FROM "user" WHERE username = $1', username
        )
        if row is not None:
            await conn.execute(
                'UPDATE "user" SET unit_id = $2, role_id = $3 '
                "WHERE username = $1",
                username,
                ROOT_UNIT_ID,
                commander_role_id,
            )
            continue
        logger.info("Creating commander account: %s", username)
        await conn.execute(
            'INSERT INTO "user" (name, username, password, unit_id, role_id) '
            "VALUES ($1, $2, $3, $4, $5)",
            name,
            username,
            _hash_password(ADMIN_PASSWORD),
            ROOT_UNIT_ID,
            commander_role_id,
        )


async def run_seed() -> None:
    """Seed the root unit, its roles, and the super-admin user."""
    logger.info("Starting database seed...")
    conn = await _connect()
    try:
        async with conn.transaction():
            await _seed_root_unit(conn)
            await _seed_root_roles(conn)
            await _seed_super_admin(conn)
            commander_role_id = await _seed_commander_role(conn)
            await _seed_chief_accounts(conn, commander_role_id)
            # Story 69: authoritative pass — sync EVERY role's permission set to
            # its role-type's desired set (insert/update/delete), so a permission
            # change takes effect on redeploy. No-op on already-correct data.
            await _reconcile_all_roles(conn)
        logger.info("Seed completed successfully!")
    except Exception:
        logger.exception("Seed failed")
        raise
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(run_seed())
