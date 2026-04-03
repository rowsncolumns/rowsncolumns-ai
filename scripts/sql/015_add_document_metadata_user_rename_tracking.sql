ALTER TABLE document_metadata
  ADD COLUMN IF NOT EXISTS is_user_renamed BOOLEAN;

UPDATE document_metadata
SET is_user_renamed = FALSE
WHERE is_user_renamed IS NULL;

ALTER TABLE document_metadata
  ALTER COLUMN is_user_renamed SET DEFAULT FALSE;

ALTER TABLE document_metadata
  ALTER COLUMN is_user_renamed SET NOT NULL;

CREATE INDEX IF NOT EXISTS document_metadata_user_renamed_updated_idx
  ON document_metadata (is_user_renamed, updated_at DESC);
