-- ============================================================================
-- seed_test_tree.sql — TEST FIXTURE (manual, not auto-applied)
-- ============================================================================
-- Seeds a nested unit tree for testing the unit-tree + per-unit RBAC features:
--
--   Tổng (root, id 1)
--     └─ Viện 1..3
--          └─ Phòng <i>.<j>   (3–5 per Viện)
--               └─ Ban <i>.<j>.<k>   (3–5 per Phòng)
--
-- Roles per level (the HEAD role is the unit admin, is_admin = TRUE; this is
-- the single admin role that the one-admin-per-unit rule expects):
--   Viện : Viện trưởng*, Viện phó, Trợ lý
--   Phòng: Trưởng phòng*, Phó phòng, Trợ lý, Nhân viên
--   Ban  : Trưởng ban*, Phó ban, Nhân viên, Trợ lý
--   (* = is_admin)
--
-- The 3–5 child counts are DETERMINISTIC (derived from the indices) so the
-- script is idempotent — re-running inserts nothing new and never grows the
-- tree. unit.name is globally unique, hence the numbered names.
--
-- NOT run by the db-migrate service or seed.py; apply manually:
--   psql ... -f db/psql/seed_test_tree.sql
-- ============================================================================

DO $$
DECLARE
  vien_count  INTEGER := 3;
  i INTEGER; j INTEGER; k INTEGER;
  phong_count INTEGER;
  ban_count   INTEGER;
  vien_id  INTEGER;
  phong_id INTEGER;
  ban_id   INTEGER;
BEGIN
  FOR i IN 1..vien_count LOOP
    INSERT INTO unit (name, parent_id) VALUES ('Viện ' || i, 1)
      ON CONFLICT (name) DO NOTHING;
    SELECT id INTO vien_id FROM unit WHERE name = 'Viện ' || i;

    INSERT INTO role (name, unit_id, is_admin) VALUES
      ('Viện trưởng', vien_id, TRUE),
      ('Viện phó',    vien_id, FALSE),
      ('Trợ lý',      vien_id, FALSE)
    ON CONFLICT (unit_id, name) DO NOTHING;

    -- 3..5 Phòng per Viện (deterministic).
    phong_count := 3 + ((i - 1) % 3);
    FOR j IN 1..phong_count LOOP
      INSERT INTO unit (name, parent_id)
        VALUES ('Phòng ' || i || '.' || j, vien_id)
        ON CONFLICT (name) DO NOTHING;
      SELECT id INTO phong_id FROM unit
        WHERE name = 'Phòng ' || i || '.' || j;

      INSERT INTO role (name, unit_id, is_admin) VALUES
        ('Trưởng phòng', phong_id, TRUE),
        ('Phó phòng',    phong_id, FALSE),
        ('Trợ lý',       phong_id, FALSE),
        ('Nhân viên',    phong_id, FALSE)
      ON CONFLICT (unit_id, name) DO NOTHING;

      -- 3..5 Ban per Phòng (deterministic).
      ban_count := 3 + ((i + j) % 3);
      FOR k IN 1..ban_count LOOP
        INSERT INTO unit (name, parent_id)
          VALUES ('Ban ' || i || '.' || j || '.' || k, phong_id)
          ON CONFLICT (name) DO NOTHING;
        SELECT id INTO ban_id FROM unit
          WHERE name = 'Ban ' || i || '.' || j || '.' || k;

        INSERT INTO role (name, unit_id, is_admin) VALUES
          ('Trưởng ban', ban_id, TRUE),
          ('Phó ban',    ban_id, FALSE),
          ('Nhân viên',  ban_id, FALSE),
          ('Trợ lý',     ban_id, FALSE)
        ON CONFLICT (unit_id, name) DO NOTHING;
      END LOOP;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Test tree seeded (3 Viện, 3–5 Phòng each, 3–5 Ban each).';
END $$;
