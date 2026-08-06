-- ===========================================
-- init.sql — canonical schema, applied on every startup.
-- ===========================================
-- This file is SELF-HEALING and idempotent: it works both for a fresh database
-- and for an existing volume still on the pre-hybrid schema (flat role.level,
-- no unit tree). The CREATE TABLE IF NOT EXISTS statements handle fresh installs;
-- the guarded ALTER/UPDATE statements evolve an old table in place so startup
-- never crashes on a missing column.
--
-- NOTE: this file deliberately does NOT reparent existing units or otherwise
-- rewrite organizational data — that one-time data migration lives in
-- db/psql/migrate_002.sql (applied by the db-migrate service). init.sql only
-- guarantees the columns/constraints exist so the app can boot.
-- ===========================================

-- ===========================================
-- Units  (TREE — adjacency list)
-- ===========================================
CREATE TABLE IF NOT EXISTS unit (
  id        SERIAL PRIMARY KEY,
  name      TEXT UNIQUE NOT NULL,
  parent_id INTEGER REFERENCES unit(id) ON DELETE SET NULL
);

-- Heal an old unit table that predates the tree.
ALTER TABLE unit
  ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES unit(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_unit_parent ON unit (parent_id);

-- NOTE: the root unit (id 1, 'Tổng') is NOT seeded here. Reference data is
-- seeded out of band by the one-shot db-seed service (db/psql/seed.py), which
-- is the sole seeder. init.sql only guarantees the structure exists.

-- ===========================================
-- Roles  (FLAT, scoped to a unit; capability via is_admin)
-- ===========================================
CREATE TABLE IF NOT EXISTS role (
  id       SERIAL PRIMARY KEY,
  name     TEXT NOT NULL,
  unit_id  INTEGER NOT NULL REFERENCES unit(id) ON DELETE CASCADE,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  -- role names are unique within a unit, not globally
  UNIQUE (unit_id, name)
);

-- Heal an old role table (flat level, global-unique name) into the new shape.
ALTER TABLE role
  ADD COLUMN IF NOT EXISTS unit_id INTEGER REFERENCES unit(id) ON DELETE CASCADE;
ALTER TABLE role
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  -- Old admin tier was level >= 100; map it to is_admin before dropping level.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'role' AND column_name = 'level'
  ) THEN
    UPDATE role SET is_admin = (level >= 100) WHERE is_admin = FALSE;
  END IF;
END$$;

-- Attach any unscoped role to the root unit, then enforce NOT NULL.
UPDATE role SET unit_id = 1 WHERE unit_id IS NULL;
ALTER TABLE role ALTER COLUMN unit_id SET NOT NULL;
ALTER TABLE role DROP COLUMN IF EXISTS level;

-- Swap the legacy global unique on name for a per-unit unique.
ALTER TABLE role DROP CONSTRAINT IF EXISTS role_name_key;
DROP INDEX IF EXISTS role_name_key;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'role_unit_id_name_key'
  ) THEN
    ALTER TABLE role ADD CONSTRAINT role_unit_id_name_key UNIQUE (unit_id, name);
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_role_unit ON role (unit_id);

-- NOTE: the root unit's default roles (1 = admin, 2 = member) are NOT seeded
-- here either — see the note above. The db-seed service (db/psql/seed.py) is
-- the sole seeder of reference data. Per-unit admin/member pairs continue to be
-- created by the unit repository at runtime.

-- ===========================================
-- Permissions  (RBAC granular — story 66)
-- ===========================================
-- Authorization is a SET of permissions per role, layered ALONGSIDE the legacy
-- ``role.is_admin`` flag (which is kept — it drives the one-admin trigger and the
-- require_admin gates). A role's permission set is seeded by db-seed (root roles
-- + commander) and the unit repository (per-unit roles); migrate_007 backfills
-- pre-existing roles on an upgraded volume.
CREATE TABLE IF NOT EXISTS permission (
  id     SERIAL PRIMARY KEY,
  action TEXT NOT NULL UNIQUE
);

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

-- ===========================================
-- Users  (one unit per user)
-- ===========================================
CREATE TABLE IF NOT EXISTS "user" (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  username      TEXT NOT NULL UNIQUE,
  password      TEXT NOT NULL,
  unit_id       INTEGER NOT NULL REFERENCES unit(id) ON DELETE CASCADE,
  role_id       INTEGER NOT NULL DEFAULT 2 REFERENCES role(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  token_version INTEGER NOT NULL DEFAULT 0,
  lock_status   BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_user_unit ON "user" (unit_id);

-- ===========================================
-- Invariant: at most one admin user per unit
-- ===========================================
-- Admin capability lives on the role row (role.is_admin), not on the user, so
-- this cannot be a partial unique index on "user". A BEFORE INSERT/UPDATE
-- trigger rejects a second admin user in the same unit. init.sql only installs
-- the structure (idempotent); the one-time demotion of any pre-existing
-- duplicate admins lives in db/psql/migrate_003.sql.
CREATE OR REPLACE FUNCTION enforce_one_admin_per_unit()
RETURNS TRIGGER AS $$
DECLARE
  new_is_admin BOOLEAN;
  existing_admin INTEGER;
BEGIN
  SELECT COALESCE(r.is_admin, FALSE)
    INTO new_is_admin
    FROM role r
   WHERE r.id = NEW.role_id;

  IF new_is_admin THEN
    SELECT u.id
      INTO existing_admin
      FROM "user" u
      JOIN role r ON r.id = u.role_id
     WHERE u.unit_id = NEW.unit_id
       AND r.is_admin = TRUE
       AND u.id <> NEW.id
     LIMIT 1;

    IF existing_admin IS NOT NULL THEN
      RAISE EXCEPTION
        'Unit % already has an admin user (id %); only one admin per unit is allowed',
        NEW.unit_id, existing_admin
        USING ERRCODE = 'unique_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_one_admin_per_unit ON "user";
CREATE TRIGGER trg_one_admin_per_unit
  BEFORE INSERT OR UPDATE OF role_id, unit_id ON "user"
  FOR EACH ROW
  EXECUTE FUNCTION enforce_one_admin_per_unit();

-- ===========================================
-- Conversations
-- ===========================================
CREATE TABLE IF NOT EXISTS conversation (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR NOT NULL,
  user_id         INTEGER NOT NULL,
  is_public       BOOLEAN NOT NULL DEFAULT TRUE,
  mongo_key       VARCHAR,
  date_created    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  date_updated    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  initial_summary VARCHAR NOT NULL DEFAULT '',
  last_synced_at  TIMESTAMPTZ,
  FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_conversation_user ON conversation (user_id);

-- ===========================================
-- Document groups  (flat "topic" label — for searching only)
-- ===========================================
-- Story 77: groups are scoped to a unit. The name is unique only WITHIN a unit
-- (composite key), so two units may both have a "Hành chính" group. unit_id is
-- nullable only to let the migration expand step backfill existing rows.
CREATE TABLE IF NOT EXISTS document_group (
  id      SERIAL PRIMARY KEY,
  name    TEXT NOT NULL,
  unit_id INTEGER REFERENCES unit(id) ON DELETE CASCADE,
  CONSTRAINT document_group_name_unit_key UNIQUE (name, unit_id)
);

-- ===========================================
-- Documents  (normalized — was JSONB in conversation)
-- ===========================================
CREATE TABLE IF NOT EXISTS document (
  id              UUID PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES "user"(id),
  group_id        INTEGER REFERENCES document_group(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  doc_number      TEXT,             -- Số văn bản (document reference)
  summary         TEXT,             -- Trích yếu (summary)
  sha256          TEXT,
  status          TEXT NOT NULL DEFAULT 'PENDING',
  chunk_count     INTEGER NOT NULL DEFAULT 0,
  task_id         TEXT,
  message         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Heal an old document table that predates document groups.
ALTER TABLE document
  ADD COLUMN IF NOT EXISTS group_id INTEGER REFERENCES document_group(id) ON DELETE SET NULL;

-- Heal a document table that predates the doc_number / summary columns.
ALTER TABLE document
  ADD COLUMN IF NOT EXISTS doc_number TEXT,  -- Số văn bản (document reference)
  ADD COLUMN IF NOT EXISTS summary    TEXT;  -- Trích yếu (summary)

CREATE INDEX IF NOT EXISTS idx_document_conv  ON document (conversation_id);
CREATE INDEX IF NOT EXISTS idx_document_user  ON document (user_id);
CREATE INDEX IF NOT EXISTS idx_document_group ON document (group_id);

-- ===========================================
-- Info Tables  (normalized — was JSONB in conversation)
-- ===========================================
CREATE TABLE IF NOT EXISTS info_table (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id INTEGER NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  type            TEXT NOT NULL CHECK (type IN ('summary','mindmap','report','directive_review')),
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

-- ===========================================
-- Audit log
-- ===========================================
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

-- ===========================================
-- Migration baseline
-- ===========================================
-- This file already produces the CURRENT schema, so a fresh volume is "at head"
-- and the historical migrate_NNN.sql files (which upgrade OLD schemas in place)
-- must NOT run against it — migrate_001 in particular assumes the pre-tree role
-- shape and would fail. Record those versions as already applied so the
-- db-migrate runner skips them. Only baseline migrations whose effect init.sql
-- already incorporates; genuinely new migrations are left out so they still run.
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO schema_migrations (version) VALUES
  ('migrate_001'),
  ('migrate_002')
ON CONFLICT (version) DO NOTHING;
