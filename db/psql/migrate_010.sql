-- ============================================================================
-- migrate_010.sql — info_table.type accepts 'directive_review'
-- ============================================================================
-- Directive review is a fourth analysis item type alongside summary/mindmap/
-- report. Analysis items persist as info_table rows, so the type CHECK
-- constraint rejects every directive-review submit until it is widened.
--
-- A CHECK constraint cannot be extended in place, so it is dropped and
-- recreated. Idempotent: DROP ... IF EXISTS, then ADD.
-- ============================================================================

ALTER TABLE info_table
  DROP CONSTRAINT IF EXISTS info_table_type_check;

ALTER TABLE info_table
  ADD CONSTRAINT info_table_type_check
  CHECK (type IN ('summary','mindmap','report','directive_review'));
