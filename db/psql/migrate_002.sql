-- ============================================================================
-- migrate_002.sql — current schema -> hybrid unit-tree + flat per-unit RBAC
-- ============================================================================
-- Brings a database on the CURRENT schema (db/psql/init.sql before this change:
-- flat role.level, no hierarchy) up to the NEW model:
--   - unit becomes a TREE (unit.parent_id, adjacency list)
--   - role becomes FLAT, scoped to a unit (role.unit_id NOT NULL), capability
--     marked by role.is_admin; role.level is dropped
--   - role names unique per unit instead of globally
--   - document gains an optional group_id -> document_group (flat search label)
--   - "super-admin" is structural: the admin of the ROOT unit covers the whole
--     tree, so the old level/is_admin-by-name bypass is removed.
--
-- Idempotent: safe to run against a current DB, a partially-migrated DB, or a
-- DB already on the new schema. The db-migrate service wraps this file in a
-- single transaction and records it in schema_migrations, so it runs once.
--
-- DECISION (flagged in the plan): this migration ensures a single root unit
-- (id 1, 'Tổng') and reparents every other existing top-level unit under it,
-- so whoever administers the root retains see-everything. Adjust the tree
-- afterwards via the admin UI if your real org structure differs.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. unit: tree
-- ---------------------------------------------------------------------------
ALTER TABLE unit
  ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES unit(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_unit_parent ON unit (parent_id);

-- Ensure a root unit (id 1, 'Tổng') exists.
INSERT INTO unit (id, name, parent_id) VALUES (1, 'Tổng', NULL)
ON CONFLICT (id) DO NOTHING;
-- Keep the serial sequence ahead of seeded ids.
SELECT setval('unit_id_seq', COALESCE((SELECT MAX(id)+1 FROM unit), 1), false);

-- Reparent every other root unit under the root, so the root admin's subtree
-- spans the whole organization. Only touches units that are currently roots
-- (parent_id IS NULL) and are not the root itself — idempotent.
UPDATE unit SET parent_id = 1 WHERE id <> 1 AND parent_id IS NULL;

-- ---------------------------------------------------------------------------
-- 2. role: flat, unit-scoped, is_admin; drop level
-- ---------------------------------------------------------------------------
ALTER TABLE role
  ADD COLUMN IF NOT EXISTS unit_id INTEGER REFERENCES unit(id) ON DELETE CASCADE;
ALTER TABLE role
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- Map legacy roles before dropping level (level >= 100 was the admin tier).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'role' AND column_name = 'level'
  ) THEN
    UPDATE role SET is_admin = (level >= 100) WHERE is_admin = FALSE;
  END IF;
END$$;

-- Defensively map the seeded legacy roles by id as well.
UPDATE role SET is_admin = TRUE  WHERE id = 1;
UPDATE role SET is_admin = FALSE WHERE id = 2;

-- Attach every unscoped role to the root unit.
UPDATE role SET unit_id = 1 WHERE unit_id IS NULL;

-- Now that data is backfilled, enforce NOT NULL and drop the legacy column.
ALTER TABLE role ALTER COLUMN unit_id SET NOT NULL;
ALTER TABLE role DROP COLUMN IF EXISTS level;

-- Role-name uniqueness: drop the old global unique on name, add per-unit unique.
ALTER TABLE role DROP CONSTRAINT IF EXISTS role_name_key;  -- implicit "name TEXT UNIQUE"
DROP INDEX IF EXISTS role_name_key;                        -- older variants
-- (Will fail loudly if duplicate (unit_id, name) rows exist — resolve first.)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'role_unit_id_name_key'
  ) THEN
    ALTER TABLE role ADD CONSTRAINT role_unit_id_name_key UNIQUE (unit_id, name);
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_role_unit ON role (unit_id);

-- ---------------------------------------------------------------------------
-- 3. user: ensure the default admin lands in the root unit with the admin role
-- ---------------------------------------------------------------------------
UPDATE "user"
SET unit_id = 1
WHERE username = 'admin' AND unit_id IS NULL;

UPDATE "user"
SET role_id = 1
WHERE username = 'admin' AND role_id IS NOT DISTINCT FROM 1;  -- no-op guard; admin keeps role 1

-- Enforce a unit for all users before applying the NOT NULL constraint.
UPDATE "user" SET unit_id = 1 WHERE unit_id IS NULL;
ALTER TABLE "user" ALTER COLUMN unit_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_unit ON "user" (unit_id);

-- ---------------------------------------------------------------------------
-- 4. document_group (flat label) + document.group_id
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS document_group (
  id   SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL
);

ALTER TABLE document
  ADD COLUMN IF NOT EXISTS group_id INTEGER REFERENCES document_group(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_document_group ON document (group_id);

-- ---------------------------------------------------------------------------
-- 5. supporting indexes for scoping joins
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_conversation_user ON conversation (user_id);
CREATE INDEX IF NOT EXISTS idx_document_user     ON document (user_id);
