CREATE TABLE IF NOT EXISTS public.document_import_jobs (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_extension TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL,
  storage_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  phase TEXT NOT NULL DEFAULT 'queued',
  progress_percent INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT document_import_jobs_status_check
    CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  CONSTRAINT document_import_jobs_phase_check
    CHECK (phase IN ('queued', 'parsing', 'saving', 'finalizing', 'completed', 'failed')),
  CONSTRAINT document_import_jobs_progress_percent_check
    CHECK (progress_percent >= 0 AND progress_percent <= 100),
  CONSTRAINT document_import_jobs_file_size_check
    CHECK (file_size_bytes > 0)
);

CREATE INDEX IF NOT EXISTS document_import_jobs_user_created_idx
  ON public.document_import_jobs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS document_import_jobs_doc_id_idx
  ON public.document_import_jobs (doc_id);
