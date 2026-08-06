-- ============================================================================
-- migrate_005.sql — conversation_repo_doc link table (story 16)
-- ============================================================================
-- Lets a chat conversation REFERENCE repository documents without copying them.
-- The AI retrieval is keyed by document_id and there is no upstream copy/attach
-- primitive, so "using" a repository document in a conversation is a reference
-- link. The chat-query gate accepts a document id if it belongs to the
-- conversation OR appears here for that conversation.
--
-- Idempotent: safe to run repeatedly. The db-migrate service wraps this file in
-- a single transaction and records it in schema_migrations, so it runs once.
-- ============================================================================

CREATE TABLE IF NOT EXISTS conversation_repo_doc (
  conversation_id INTEGER NOT NULL
    REFERENCES conversation (id) ON DELETE CASCADE,
  document_id UUID NOT NULL
    REFERENCES document (id) ON DELETE CASCADE,
  PRIMARY KEY (conversation_id, document_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_repo_doc_conv
  ON conversation_repo_doc (conversation_id);
