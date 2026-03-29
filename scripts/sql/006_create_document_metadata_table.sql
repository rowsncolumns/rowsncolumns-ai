CREATE TABLE IF NOT EXISTS document_metadata (
  doc_id TEXT PRIMARY KEY REFERENCES document_owners(doc_id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS document_metadata_updated_idx
  ON document_metadata (updated_at DESC);
