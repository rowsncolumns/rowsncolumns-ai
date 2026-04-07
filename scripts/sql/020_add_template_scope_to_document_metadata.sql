ALTER TABLE public.document_metadata
  ADD COLUMN IF NOT EXISTS template_scope TEXT;

UPDATE public.document_metadata
SET template_scope = CASE
  WHEN is_template = TRUE THEN 'global'
  ELSE 'none'
END
WHERE template_scope IS NULL
  OR BTRIM(template_scope) = '';

UPDATE public.document_metadata
SET template_scope = CASE
  WHEN LOWER(BTRIM(template_scope)) IN ('none', 'personal', 'organization', 'global')
    THEN LOWER(BTRIM(template_scope))
  WHEN is_template = TRUE THEN 'global'
  ELSE 'none'
END;

ALTER TABLE public.document_metadata
  ALTER COLUMN template_scope SET DEFAULT 'none';

ALTER TABLE public.document_metadata
  ALTER COLUMN template_scope SET NOT NULL;

ALTER TABLE public.document_metadata
  DROP CONSTRAINT IF EXISTS document_metadata_template_scope_check;

ALTER TABLE public.document_metadata
  ADD CONSTRAINT document_metadata_template_scope_check
  CHECK (template_scope IN ('none', 'personal', 'organization', 'global'));

CREATE INDEX IF NOT EXISTS document_metadata_template_scope_updated_idx
  ON public.document_metadata (template_scope, updated_at DESC);

CREATE INDEX IF NOT EXISTS document_metadata_template_scope_category_idx
  ON public.document_metadata (template_category)
  WHERE template_scope <> 'none';

CREATE INDEX IF NOT EXISTS document_metadata_template_scope_title_idx
  ON public.document_metadata (template_title)
  WHERE template_scope <> 'none';

CREATE INDEX IF NOT EXISTS document_metadata_template_scope_tagline_idx
  ON public.document_metadata (template_tagline)
  WHERE template_scope <> 'none';
