-- ============================================================================
-- migrate_009.sql — user.updated_at for last-touched ordering (story 88)
-- ============================================================================
-- The user management list paginates client-side (10/page) but GET /users had
-- no ORDER BY, so it returned rows in Postgres heap order: a just-created user
-- landed on a later page ("doesn't show up") and editing a user (an UPDATE that
-- rewrites the tuple) made the row jump pages. This adds an updated_at marker so
-- the list can sort newest-touched first — a created OR edited user surfaces at
-- the top, older rows shift down, no confusion.
--
-- Backfill = created_at so existing rows keep a sensible (creation) order rather
-- than all collapsing to the migration instant. New inserts default to now();
-- the user-update path bumps it (app-side) so edits bubble up too.
--
-- Idempotent: add nullable → backfill only NULLs → set default + NOT NULL.
-- ============================================================================

ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP;

UPDATE "user"
  SET updated_at = created_at
  WHERE updated_at IS NULL;

ALTER TABLE "user"
  ALTER COLUMN updated_at SET DEFAULT now();

ALTER TABLE "user"
  ALTER COLUMN updated_at SET NOT NULL;
