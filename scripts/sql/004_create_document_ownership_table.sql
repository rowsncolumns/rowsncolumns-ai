CREATE TABLE IF NOT EXISTS document_owners (
  doc_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS document_owners_user_updated_idx
  ON document_owners (user_id, updated_at DESC);
