ALTER TABLE document_metadata
  ADD COLUMN IF NOT EXISTS template_tagline TEXT;

CREATE INDEX IF NOT EXISTS document_metadata_template_tagline_idx
  ON document_metadata (template_tagline)
  WHERE is_template = TRUE;
