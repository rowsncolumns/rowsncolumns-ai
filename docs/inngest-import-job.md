# Inngest Document Import Job

This document describes the current spreadsheet import workflow powered by Inngest.

## Overview

The import flow is asynchronous:

1. Client uploads a spreadsheet file to `POST /api/documents/import`.
2. API stores the raw file in R2 and creates a `document_import_jobs` row.
3. API emits an Inngest event: `documents/import.requested`.
4. Inngest function processes the job: download file, parse, persist to ShareDB, finalize job.
5. Client polls job status and redirects when completed.

## Exact Responsibility Split

Short answer:

- The queue API uploads the source file to R2.
- The Inngest job reads that file from R2, parses it, and writes the snapshot to ShareDB.

In more detail:

1. `POST /api/documents/import` uploads raw bytes to R2 and creates the import job row.
2. Inngest function `documents-process-import-job` downloads the R2 object.
3. Inngest parses the file to a spreadsheet snapshot.
4. Inngest writes the snapshot to the ShareDB document.
5. Inngest marks job complete and attempts to delete the temporary R2 object.

## Entry Points

- Queue API: `app/api/documents/import/route.ts`
- Status API: `app/api/documents/import/jobs/[jobId]/route.ts`
- Inngest endpoint: `app/api/inngest/route.ts`
- Function implementation: `lib/inngest/functions/process-document-import.ts`
- Job persistence: `lib/documents/import-jobs-repository.ts`
- R2 helper: `lib/storage/r2.ts`
- Client polling/upload logic: `lib/documents/client.ts`

## Queue API Behavior

`POST /api/documents/import` does the following:

1. Authenticates user session.
2. Validates extension (`xlsx`, `xls`, `ods`, `csv`) and file size (`<= 20 MB`).
3. Uploads raw file bytes to R2 under `document-imports/<user>/<date>/<jobId>/<filename>`.
4. Creates document ownership + metadata rows for a new `docId`.
5. Creates `document_import_jobs` row with initial state.
6. Sends `documents/import.requested` event to Inngest.
7. Returns `{ jobId }`.

If queueing fails:

- Job is marked failed when possible.
- Uploaded R2 object is deleted when possible.

## Inngest Function Behavior

Function id: `documents-process-import-job`  
Trigger: `documents/import.requested`  
Retries: `1`

Processing steps:

1. Load job by `jobId`.
2. If job already completed, return success early.
3. Mark job `processing/parsing` at `30%`.
4. Download raw file from R2.
5. Parse spreadsheet into ShareDB snapshot (`parseSpreadsheetBuffer`).
6. Mark job `processing/saving` at `75%`.
7. Ensure document ownership/metadata and update title from filename.
8. Connect to ShareDB (with issued MCP token) and create the document snapshot if doc not already present.
9. Mark job `processing/finalizing` at `95%`.
10. Create baseline operation-history entry for the import (if snapshot was newly created).
11. Mark job `completed/completed` at `100%`.
12. Attempt cleanup of source file from R2.

Failure handling:

- Any thrown error marks job as `failed/failed` with truncated `error_message`.
- Error is rethrown so Inngest can apply retry policy.

## Job State Model

Status values:

- `queued`
- `processing`
- `completed`
- `failed`

Phase values:

- `queued`
- `parsing`
- `saving`
- `finalizing`
- `completed`
- `failed`

Progress policy:

- Initial insert: `5`
- Parsing: `30`
- Saving: `75`
- Finalizing: `95`
- Completed: `100`

## Client Behavior

`createDocumentFromUpload` in `lib/documents/client.ts`:

1. Tracks upload progress using `XMLHttpRequest.upload.onprogress`.
2. Calls queue API.
3. If API returns `documentId`, resolves immediately (legacy compatibility).
4. If API returns `jobId`, polls `GET /api/documents/import/jobs/:jobId` every `1s`.
5. Poll timeout is `8 minutes`.
6. Resolves with `documentId` on completed status.
7. Throws on failed status or timeout.

UI stage semantics:

- `uploading`: network upload in progress.
- `saving`: background import is running (includes parsing + persistence).
- `redirecting`: handled by dialog after a successful resolve.

## Database Migration

Table: `public.document_import_jobs`  
Migration SQL: `scripts/sql/016_create_document_import_jobs_table.sql`  
Runner script: `scripts/create-document-import-jobs-table.ts`  
NPM command: `npm run db:migrate:document-import-jobs`

## Required Environment Variables

For import queue + processing:

- `INNGEST_EVENT_KEY`
- `INNGEST_SIGNING_KEY` (production/cloud mode)
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET` or `R2_BUCKET_NAME`
- `DATABASE_URL` (or equivalent DB config used by app)
- `SHAREDB_URL`
- `SHAREDB_MCP_TOKEN_SECRET`

Optional ShareDB token config:

- `SHAREDB_MCP_TOKEN_ISSUER`
- `SHAREDB_MCP_TOKEN_AUDIENCE`

## Local Development Notes

For local Inngest development:

1. Set `INNGEST_DEV=1`.
2. Do not use cloud signing keys locally (comment out `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY`).
3. Start app (`npm run dev`).
4. Start Inngest dev server:
   - `npx inngest-cli dev --no-discovery -u http://localhost:3000/api/inngest`
