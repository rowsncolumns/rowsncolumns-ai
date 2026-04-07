CREATE TABLE IF NOT EXISTS document_owners (
  doc_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  org_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE document_owners
  ADD COLUMN IF NOT EXISTS org_id TEXT;

CREATE INDEX IF NOT EXISTS document_owners_user_updated_idx
  ON document_owners (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS document_owners_org_updated_idx
  ON document_owners (org_id, updated_at DESC);
