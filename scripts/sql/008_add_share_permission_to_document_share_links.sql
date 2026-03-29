ALTER TABLE document_share_links
  ADD COLUMN IF NOT EXISTS permission TEXT;

UPDATE document_share_links
SET permission = 'edit'
WHERE permission IS NULL;

ALTER TABLE document_share_links
  ALTER COLUMN permission SET DEFAULT 'edit';

ALTER TABLE document_share_links
  ALTER COLUMN permission SET NOT NULL;

ALTER TABLE document_share_links
  DROP CONSTRAINT IF EXISTS document_share_links_permission_check;

ALTER TABLE document_share_links
  ADD CONSTRAINT document_share_links_permission_check
  CHECK (permission IN ('view', 'edit'));

CREATE INDEX IF NOT EXISTS document_share_links_doc_permission_active_idx
  ON document_share_links (doc_id, permission)
  WHERE is_active = TRUE;
