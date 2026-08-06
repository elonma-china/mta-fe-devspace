-- ============================================================================
-- migrate_004.sql — add document reference number and summary to document
-- ============================================================================
-- Adds two optional metadata columns to the document table:
--
--   * doc_number — "Số văn bản" (document reference number)
--   * summary    — "Trích yếu" (summary)
--
-- Idempotent: safe to run against a current DB, a partially-migrated DB, or a
-- DB already on the new schema. The db-migrate service wraps this file in a
-- single transaction and records it in schema_migrations, so it runs once.
-- ============================================================================

ALTER TABLE document
  ADD COLUMN IF NOT EXISTS doc_number TEXT,  -- Số văn bản (document reference)
  ADD COLUMN IF NOT EXISTS summary    TEXT;  -- Trích yếu (summary)
