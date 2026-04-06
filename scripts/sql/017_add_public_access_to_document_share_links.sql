ALTER TABLE document_share_links
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN;

UPDATE document_share_links
SET is_public = FALSE
WHERE is_public IS NULL;

ALTER TABLE document_share_links
  ALTER COLUMN is_public SET DEFAULT FALSE;

ALTER TABLE document_share_links
  ALTER COLUMN is_public SET NOT NULL;

CREATE INDEX IF NOT EXISTS document_share_links_doc_public_active_idx
  ON document_share_links (doc_id, is_public)
  WHERE is_active = TRUE;
