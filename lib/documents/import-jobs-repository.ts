import { db } from "@/lib/db/postgres";

export type DocumentImportJobStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed";

export type DocumentImportJobPhase =
  | "queued"
  | "parsing"
  | "saving"
  | "finalizing"
  | "completed"
  | "failed";

type DocumentImportJobRow = {
  id: string;
  doc_id: string;
  user_id: string;
  file_name: string;
  file_extension: string;
  file_size_bytes: number;
  storage_key: string;
  status: DocumentImportJobStatus;
  phase: DocumentImportJobPhase;
  progress_percent: number;
  error_message: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  started_at: Date | string | null;
  completed_at: Date | string | null;
};

export type DocumentImportJobRecord = {
  id: string;
  docId: string;
  userId: string;
  fileName: string;
  fileExtension: string;
  fileSizeBytes: number;
  storageKey: string;
  status: DocumentImportJobStatus;
  phase: DocumentImportJobPhase;
  progressPercent: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

const mapRow = (row: DocumentImportJobRow): DocumentImportJobRecord => ({
  id: row.id,
  docId: row.doc_id,
  userId: row.user_id,
  fileName: row.file_name,
  fileExtension: row.file_extension,
  fileSizeBytes: Number(row.file_size_bytes),
  storageKey: row.storage_key,
  status: row.status,
  phase: row.phase,
  progressPercent: row.progress_percent,
  errorMessage: row.error_message,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
  startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
  completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
});

export const createDocumentImportJob = async (input: {
  id: string;
  docId: string;
  userId: string;
  fileName: string;
  fileExtension: string;
  fileSizeBytes: number;
  storageKey: string;
}): Promise<DocumentImportJobRecord> => {
  const rows = await db<DocumentImportJobRow[]>`
    INSERT INTO public.document_import_jobs (
      id,
      doc_id,
      user_id,
      file_name,
      file_extension,
      file_size_bytes,
      storage_key,
      status,
      phase,
      progress_percent
    )
    VALUES (
      ${input.id},
      ${input.docId},
      ${input.userId},
      ${input.fileName},
      ${input.fileExtension},
      ${input.fileSizeBytes},
      ${input.storageKey},
      'queued',
      'queued',
      5
    )
    RETURNING
      id,
      doc_id,
      user_id,
      file_name,
      file_extension,
      file_size_bytes,
      storage_key,
      status,
      phase,
      progress_percent,
      error_message,
      created_at,
      updated_at,
      started_at,
      completed_at
  `;

  const row = rows[0];
  if (!row) {
    throw new Error("Failed to create import job.");
  }

  return mapRow(row);
};

export const getDocumentImportJobById = async (
  id: string,
): Promise<DocumentImportJobRecord | null> => {
  const rows = await db<DocumentImportJobRow[]>`
    SELECT
      id,
      doc_id,
      user_id,
      file_name,
      file_extension,
      file_size_bytes,
      storage_key,
      status,
      phase,
      progress_percent,
      error_message,
      created_at,
      updated_at,
      started_at,
      completed_at
    FROM public.document_import_jobs
    WHERE id = ${id}
    LIMIT 1
  `;

  const row = rows[0];
  return row ? mapRow(row) : null;
};

export const getDocumentImportJobByIdForUser = async (
  id: string,
  userId: string,
): Promise<DocumentImportJobRecord | null> => {
  const rows = await db<DocumentImportJobRow[]>`
    SELECT
      id,
      doc_id,
      user_id,
      file_name,
      file_extension,
      file_size_bytes,
      storage_key,
      status,
      phase,
      progress_percent,
      error_message,
      created_at,
      updated_at,
      started_at,
      completed_at
    FROM public.document_import_jobs
    WHERE id = ${id}
      AND user_id = ${userId}
    LIMIT 1
  `;

  const row = rows[0];
  return row ? mapRow(row) : null;
};

export const markDocumentImportJobProcessing = async (input: {
  id: string;
  phase: Extract<DocumentImportJobPhase, "parsing" | "saving" | "finalizing">;
  progressPercent: number;
}) => {
  await db`
    UPDATE public.document_import_jobs
    SET
      status = 'processing',
      phase = ${input.phase},
      progress_percent = ${input.progressPercent},
      error_message = NULL,
      started_at = COALESCE(started_at, NOW()),
      updated_at = NOW()
    WHERE id = ${input.id}
  `;
};

export const markDocumentImportJobCompleted = async (input: {
  id: string;
  progressPercent?: number;
}) => {
  await db`
    UPDATE public.document_import_jobs
    SET
      status = 'completed',
      phase = 'completed',
      progress_percent = ${input.progressPercent ?? 100},
      error_message = NULL,
      completed_at = NOW(),
      updated_at = NOW()
    WHERE id = ${input.id}
  `;
};

export const markDocumentImportJobFailed = async (input: {
  id: string;
  errorMessage: string;
}) => {
  await db`
    UPDATE public.document_import_jobs
    SET
      status = 'failed',
      phase = 'failed',
      error_message = ${input.errorMessage.slice(0, 1000)},
      completed_at = NOW(),
      updated_at = NOW()
    WHERE id = ${input.id}
  `;
};
