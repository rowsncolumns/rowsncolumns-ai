ALTER TABLE document_metadata
  ADD COLUMN IF NOT EXISTS is_template BOOLEAN;

UPDATE document_metadata
SET is_template = FALSE
WHERE is_template IS NULL;

ALTER TABLE document_metadata
  ALTER COLUMN is_template SET DEFAULT FALSE;

ALTER TABLE document_metadata
  ALTER COLUMN is_template SET NOT NULL;

ALTER TABLE document_metadata
  ADD COLUMN IF NOT EXISTS template_category TEXT;

ALTER TABLE document_metadata
  ADD COLUMN IF NOT EXISTS template_description_markdown TEXT;

ALTER TABLE document_metadata
  ADD COLUMN IF NOT EXISTS template_tags TEXT[];

UPDATE document_metadata
SET template_tags = '{}'::text[]
WHERE template_tags IS NULL;

ALTER TABLE document_metadata
  ALTER COLUMN template_tags SET DEFAULT '{}'::text[];

ALTER TABLE document_metadata
  ALTER COLUMN template_tags SET NOT NULL;

ALTER TABLE document_metadata
  ADD COLUMN IF NOT EXISTS template_preview_image_url TEXT;

CREATE INDEX IF NOT EXISTS document_metadata_is_template_updated_idx
  ON document_metadata (is_template, updated_at DESC);

CREATE INDEX IF NOT EXISTS document_metadata_template_category_idx
  ON document_metadata (template_category)
  WHERE is_template = TRUE;
