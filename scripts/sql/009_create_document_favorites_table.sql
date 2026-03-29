CREATE TABLE IF NOT EXISTS document_favorites (
  doc_id TEXT NOT NULL REFERENCES document_owners(doc_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (doc_id, user_id)
);

CREATE INDEX IF NOT EXISTS document_favorites_user_updated_idx
  ON document_favorites (user_id, updated_at DESC);
