CREATE TABLE IF NOT EXISTS document_share_links (
  doc_id TEXT PRIMARY KEY REFERENCES document_owners(doc_id) ON DELETE CASCADE,
  share_token TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_public BOOLEAN NOT NULL DEFAULT FALSE,
  created_by_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS document_share_links_token_unique_idx
  ON document_share_links (share_token);

CREATE INDEX IF NOT EXISTS document_share_links_doc_active_idx
  ON document_share_links (doc_id, is_active);
