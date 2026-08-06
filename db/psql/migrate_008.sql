-- ============================================================================
-- migrate_008.sql — document groups per-unit (story 77)
-- ============================================================================
-- Moves document groups from a single GLOBAL namespace (name UNIQUE across the
-- whole system) to a PER-UNIT namespace: each group belongs to a unit and the
-- name is unique only WITHIN that unit, so two units may both have a "Hành
-- chính" group.
--
-- Expand → backfill → contract, all idempotent + safe on BOTH a fresh volume
-- (where init.sql already created the final schema) and an existing volume:
--   * fresh: the column + composite constraint already exist (init.sql), there
--     are no rows → every statement below is a no-op.
--   * existing: adds unit_id, backfills existing groups to the ROOT unit (id 1,
--     which has existed since the original seed), drops the old global UNIQUE
--     and adds the composite UNIQUE(name, unit_id).
--
-- Backfill choice (story 77, approved): existing groups → ROOT unit. Safe and
-- lossless; a super-admin can re-home them later. We never INSERT seed-dependent
-- rows here (story 71 rule), and the backfill UPDATE touches 0 rows on a fresh DB
-- (so it can't hit the unit FK before db-seed creates the root unit).
-- ============================================================================

-- 1) Expand: add the unit column (FK to unit, cascade on unit delete).
ALTER TABLE document_group
  ADD COLUMN IF NOT EXISTS unit_id INTEGER REFERENCES unit(id) ON DELETE CASCADE;

-- 2) Backfill: existing (global) groups belong to the ROOT unit. No-op on fresh.
UPDATE document_group SET unit_id = 1 WHERE unit_id IS NULL;

-- 3) Contract: drop the old global UNIQUE on name (auto-named by init.sql), then
--    add the composite UNIQUE only if it isn't already present (fresh has it).
ALTER TABLE document_group DROP CONSTRAINT IF EXISTS document_group_name_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'document_group_name_unit_key'
  ) THEN
    ALTER TABLE document_group
      ADD CONSTRAINT document_group_name_unit_key UNIQUE (name, unit_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_document_group_unit ON document_group (unit_id);
