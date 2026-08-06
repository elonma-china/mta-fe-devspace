-- ============================================================================
-- migrate_001.sql — converge a pre-normalization database to the init.sql schema
-- ============================================================================
-- Brings an OLD-version database (the schema in backend/Database/init.sql:
--   - "user" with unit_name / is_admin
--   - conversation with data_source / documents / info_tables JSONB) up to the
-- CURRENT schema defined in db/psql/init.sql.
--
-- It normalizes user/unit/role and creates the normalized document /
-- info_table tables. It does NOT backfill the legacy JSONB document and
-- info_table content; those columns are dropped.
--
-- Idempotent: safe to run against an old DB, a partially-migrated DB, or a
-- fresh (already-current) DB. The db-migrate service wraps this file in a
-- single transaction and records it in schema_migrations, so it runs once.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Reference tables: unit + role (new in current schema)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS unit (
  id   SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS role (
  id    SERIAL PRIMARY KEY,
  name  TEXT UNIQUE NOT NULL,
  level INTEGER NOT NULL DEFAULT 1
);

-- Seed default roles (idempotent upsert)
INSERT INTO role (id, name, level) VALUES
  (1, 'Quản trị viên', 100),
  (2, 'Người dùng', 1)
ON CONFLICT (id) DO UPDATE SET
  name  = EXCLUDED.name,
  level = EXCLUDED.level;

-- Keep the serial sequence ahead of the seeded ids
SELECT setval('role_id_seq', COALESCE((SELECT MAX(id) + 1 FROM role), 1), false);

-- ---------------------------------------------------------------------------
-- 2. user: unit_name/is_admin  ->  unit_id/role_id
-- ---------------------------------------------------------------------------
ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS unit_id INTEGER REFERENCES unit(id) ON DELETE SET NULL;
ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS role_id INTEGER REFERENCES role(id) ON DELETE SET NULL;

-- Columns already present in the old schema, added defensively in case an even
-- older variant is being migrated.
ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS lock_status BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill from legacy columns only if they still exist.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user' AND column_name = 'unit_name'
  ) THEN
    -- Extract distinct unit names into the new unit table.
    INSERT INTO unit (name)
    SELECT DISTINCT unit_name
    FROM "user"
    WHERE unit_name IS NOT NULL AND unit_name <> ''
    ON CONFLICT (name) DO NOTHING;

    -- Map each user to its unit id.
    UPDATE "user" u
    SET unit_id = un.id
    FROM unit un
    WHERE u.unit_name = un.name AND u.unit_id IS NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user' AND column_name = 'is_admin'
  ) THEN
    -- Admins -> role 1, everyone else -> role 2.
    UPDATE "user"
    SET role_id = CASE WHEN is_admin = TRUE THEN 1 ELSE 2 END
    WHERE role_id IS NULL;
  END IF;
END$$;

-- Any user still without a role defaults to "Người dùng" (2).
UPDATE "user" SET role_id = 2 WHERE role_id IS NULL;

-- Tighten role_id to match init.sql (NOT NULL DEFAULT 2).
ALTER TABLE "user" ALTER COLUMN role_id SET NOT NULL;
ALTER TABLE "user" ALTER COLUMN role_id SET DEFAULT 2;

-- Drop legacy columns now that data has been migrated.
ALTER TABLE "user" DROP COLUMN IF EXISTS unit_name;
ALTER TABLE "user" DROP COLUMN IF EXISTS is_admin;

-- ---------------------------------------------------------------------------
-- 3. conversation: drop legacy JSONB columns, add mongo_key, relax defaults
-- ---------------------------------------------------------------------------
ALTER TABLE conversation
  ADD COLUMN IF NOT EXISTS mongo_key VARCHAR;
ALTER TABLE conversation
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;

-- init.sql defaults these; old schema declared them NOT NULL without a default.
ALTER TABLE conversation ALTER COLUMN initial_summary SET DEFAULT '';
ALTER TABLE conversation ALTER COLUMN date_updated SET DEFAULT NOW();

-- Legacy JSONB columns, replaced by the normalized tables below. Not backfilled
-- the current backend reads document/info_table instead.
ALTER TABLE conversation DROP COLUMN IF EXISTS data_source;
ALTER TABLE conversation DROP COLUMN IF EXISTS documents;
ALTER TABLE conversation DROP COLUMN IF EXISTS info_tables;

-- ---------------------------------------------------------------------------
-- 4. Normalized document / info_table tables (new in current schema)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS document (
  id              UUID PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES "user"(id),
  name            TEXT NOT NULL,
  sha256          TEXT,
  status          TEXT NOT NULL DEFAULT 'PENDING',
  chunk_count     INTEGER NOT NULL DEFAULT 0,
  task_id         TEXT,
  message         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_conv
  ON document (conversation_id);

CREATE TABLE IF NOT EXISTS info_table (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id INTEGER NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  type            TEXT NOT NULL CHECK (type IN ('summary','mindmap','report')),
  name            TEXT NOT NULL,
  content         TEXT,
  selected        JSONB,
  status          TEXT NOT NULL DEFAULT 'PENDING',
  task_id         TEXT,
  date_created    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  date_updated    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_info_table_conv
  ON info_table (conversation_id);

-- ---------------------------------------------------------------------------
-- 5. audit_log (present in old schema; ensured here for completeness)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id              SERIAL PRIMARY KEY,
  timestamp       TEXT NOT NULL,
  user_id         INTEGER,
  action          TEXT NOT NULL,
  entity_type     TEXT NOT NULL,
  entity_id       TEXT,
  conversation_id INTEGER,
  ip_address      TEXT,
  user_agent      TEXT,
  metadata        JSONB
);

CREATE INDEX IF NOT EXISTS idx_audit_ts     ON audit_log (timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_user   ON audit_log (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_conv   ON audit_log (conversation_id);
