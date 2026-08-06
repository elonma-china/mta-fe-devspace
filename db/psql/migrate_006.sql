-- ============================================================================
-- migrate_006.sql — per-user document read tracking (story 54)
-- ============================================================================
-- Tracks which repository documents each user has READ, so the admin "Kho tài
-- liệu" header button can show an unread count and the management screen can
-- highlight unread rows. Applies to EVERY user (admin + regular).
--
-- Storage model (sparse): only a "has read" row is stored — UNREAD is the set
-- difference (a repository document with NO read row for that user). Combined
-- with a per-user baseline (only documents created after the baseline count as
-- unread), this keeps the table small as data grows: existing documents are
-- "read" implicitly via the baseline, and read rows for documents older than the
-- baseline are redundant and may be pruned.
--
-- Idempotent: safe to run repeatedly. The db-migrate service wraps this file in
-- a single transaction and records it in schema_migrations, so it runs once.
-- ============================================================================

-- 1) Per-(user, document) read marker. UNREAD = absence of a row (+ baseline).
CREATE TABLE IF NOT EXISTS document_read (
  user_id     INTEGER NOT NULL
    REFERENCES "user" (id) ON DELETE CASCADE,
  document_id UUID NOT NULL
    REFERENCES document (id) ON DELETE CASCADE,
  read_at     TIMESTAMP NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, document_id)
);

CREATE INDEX IF NOT EXISTS idx_document_read_user
  ON document_read (user_id);

-- 2) Per-user baseline: only documents created AFTER this instant count as
-- "unread". Set to now() at migration time so existing documents do NOT flood
-- the badge on launch; new users default to their creation time (server_default
-- in the ORM). It also anchors the prune of redundant read rows.
ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS repo_read_baseline TIMESTAMP;

UPDATE "user"
  SET repo_read_baseline = now()
  WHERE repo_read_baseline IS NULL;
