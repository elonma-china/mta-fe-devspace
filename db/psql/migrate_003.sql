-- ============================================================================
-- migrate_003.sql — enforce at most one admin user per unit
-- ============================================================================
-- Brings a database on the post-migrate_002 schema (unit tree + flat per-unit
-- RBAC, admin capability via role.is_admin) up to the NEW invariant:
--
--   * each unit has AT MOST ONE admin user — i.e. at most one user whose
--     role_id points to a role with is_admin = TRUE within that unit.
--
-- Because admin capability lives on the role row (role.is_admin), not on the
-- user row, this cannot be expressed as a partial unique index on "user".
-- It is enforced with a BEFORE INSERT/UPDATE trigger that rejects a second
-- admin user in the same unit.
--
-- Existing duplicates are resolved by keeping the admin with the LOWEST user
-- id and demoting the rest to that unit's member role (is_admin = FALSE).
--
-- Idempotent: safe to run against a current DB, a partially-migrated DB, or a
-- DB already on the new schema. The db-migrate service wraps this file in a
-- single transaction and records it in schema_migrations, so it runs once.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Make sure every unit that currently has duplicate admins also has a
--    member role to demote the extras into. Units created by the app already
--    get a 'Người dùng' (member) role, but heal any that somehow lack one.
-- ---------------------------------------------------------------------------
INSERT INTO role (name, unit_id, is_admin)
SELECT 'Người dùng', d.unit_id, FALSE
FROM (
  SELECT u.unit_id
  FROM "user" u
  JOIN role r ON r.id = u.role_id
  WHERE r.is_admin = TRUE
  GROUP BY u.unit_id
  HAVING COUNT(*) > 1
) d
WHERE NOT EXISTS (
  SELECT 1 FROM role r2
  WHERE r2.unit_id = d.unit_id AND r2.is_admin = FALSE
)
ON CONFLICT (unit_id, name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Resolve existing duplicates: keep the lowest user id per unit as the
--    admin, demote the rest to that unit's member role (lowest non-admin id).
-- ---------------------------------------------------------------------------
WITH ranked AS (
  SELECT
    u.id,
    u.unit_id,
    ROW_NUMBER() OVER (PARTITION BY u.unit_id ORDER BY u.id) AS rn
  FROM "user" u
  JOIN role r ON r.id = u.role_id
  WHERE r.is_admin = TRUE
),
member_role AS (
  SELECT unit_id, MIN(id) AS role_id
  FROM role
  WHERE is_admin = FALSE
  GROUP BY unit_id
)
UPDATE "user" u
SET role_id = mr.role_id
FROM ranked rk
JOIN member_role mr ON mr.unit_id = rk.unit_id
WHERE u.id = rk.id
  AND rk.rn > 1;

-- ---------------------------------------------------------------------------
-- 3. Trigger: reject a second admin user in a unit.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_one_admin_per_unit()
RETURNS TRIGGER AS $$
DECLARE
  new_is_admin BOOLEAN;
  existing_admin INTEGER;
BEGIN
  -- Is the user's (new) role an admin role?
  SELECT COALESCE(r.is_admin, FALSE)
    INTO new_is_admin
    FROM role r
   WHERE r.id = NEW.role_id;

  IF new_is_admin THEN
    -- Any OTHER user in the same unit already holding an admin role?
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
