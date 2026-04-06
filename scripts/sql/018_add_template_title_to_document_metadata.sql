ALTER TABLE document_metadata
  ADD COLUMN IF NOT EXISTS template_title TEXT;

CREATE INDEX IF NOT EXISTS document_metadata_template_title_idx
  ON document_metadata (template_title)
  WHERE is_template = TRUE;
