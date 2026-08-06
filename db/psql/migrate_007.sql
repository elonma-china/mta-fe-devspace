-- ============================================================================
-- migrate_007.sql — RBAC granular: permission catalog + role→permission (story 66)
-- ============================================================================
-- Moves authorization from the single boolean ``role.is_admin`` to a SET of
-- permissions per role, WITHOUT breaking existing behavior. ``role.is_admin`` is
-- KEPT (it still drives the one-admin-per-unit trigger and the legacy
-- ``require_admin`` gates); permissions are layered ALONGSIDE it.
--
-- The new "Chỉ huy" (commander) role can then read/manage repository documents
-- across all units WITHOUT user/unit administration — impossible to express with
-- a single is_admin flag.
--
-- Idempotent: CREATE ... IF NOT EXISTS + INSERT ... ON CONFLICT DO NOTHING. The
-- db-migrate service wraps this in one transaction and records it in
-- schema_migrations, so it runs once on existing volumes.
--
-- Fresh-DB note: init.sql already creates the two tables + seeds the catalog, so
-- on a fresh volume the CREATE/catalog statements here are no-ops. The role
-- backfill below targets roles that ALREADY exist; on a fresh DB the root roles
-- and the commander role are created later by db-seed (seed.py), which performs
-- their OWN permission mapping. Per-unit roles created at runtime are mapped by
-- the repository (``_ensure_unit_roles``). All three paths stay consistent.
-- ============================================================================

-- 1) Permission catalog (stable action strings).
CREATE TABLE IF NOT EXISTS permission (
  id     SERIAL PRIMARY KEY,
  action TEXT NOT NULL UNIQUE
);

-- 2) Role → permission, each carrying a scope (own | unit_subtree | all).
CREATE TABLE IF NOT EXISTS role_permission (
  role_id       INTEGER NOT NULL REFERENCES role (id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permission (id) ON DELETE CASCADE,
  scope         TEXT NOT NULL DEFAULT 'own'
                CHECK (scope IN ('own', 'unit_subtree', 'all')),
  PRIMARY KEY (role_id, permission_id)
);

INSERT INTO permission (action) VALUES
  ('users:manage'), ('units:manage'), ('units:read'), ('roles:read'),
  ('roles:manage'), ('documents:read'), ('documents:manage'),
  ('docgroups:manage'), ('audit:read')
ON CONFLICT (action) DO NOTHING;

-- 3) Backfill EXISTING roles so the permission gates reproduce is_admin exactly.
-- Anchor scope on the USER's unit at runtime (scope_condition uses
-- principal.unit_id), so role scope here is purely the tier label.

-- (A) Super admin = is_admin on the ROOT unit → every action, scope 'all'.
INSERT INTO role_permission (role_id, permission_id, scope)
SELECT r.id, p.id, 'all'
FROM role r CROSS JOIN permission p
WHERE r.is_admin AND r.unit_id = 1
ON CONFLICT DO NOTHING;

-- (B) Unit admin = is_admin on a NON-root unit → the management actions a unit
-- admin uses today, scope 'unit_subtree'.
INSERT INTO role_permission (role_id, permission_id, scope)
SELECT r.id, p.id, 'unit_subtree'
FROM role r CROSS JOIN permission p
WHERE r.is_admin AND r.unit_id <> 1
  AND p.action IN (
    'users:manage', 'units:read', 'roles:read',
    'documents:read', 'documents:manage', 'docgroups:manage'
  )
ON CONFLICT DO NOTHING;

-- (C) Regular users (the "Người dùng" role, is_admin FALSE) get NO permissions:
-- their existing access (own documents in chat) flows through get_current_user +
-- scope_condition, which is unchanged and does NOT consult the permission set.
-- Granting them documents:read here would (wrongly) let them pass the new
-- require_permission gate on the /admin/documents read routes. So this is
-- intentionally a no-op — only admin tiers and the commander hold capabilities.

-- 4) Commander role "Chỉ huy" + its permissions are NOT created here (story 71).
-- On a FRESH database this migration runs BEFORE db-seed, so the root unit (id 1)
-- does not exist yet — an `INSERT INTO role (... unit_id=1 ...)` here violates the
-- role→unit foreign key and aborts db-migrate, breaking the whole fresh deploy.
-- It is also redundant: db-seed (seed.py) creates the commander role and RECONCILES
-- every role's permission set on each deploy (story 69), on both fresh and existing
-- databases. So the commander role is owned by the seed, not this migration.
