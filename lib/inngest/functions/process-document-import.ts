import type ShareDBClient from "sharedb/lib/client";
import { NonRetriableError } from "inngest";

import { getShareDBDocument } from "@/lib/chat/utils";
import {
  getDocumentImportJobById,
  markDocumentImportJobCompleted,
  markDocumentImportJobFailed,
  markDocumentImportJobProcessing,
} from "@/lib/documents/import-jobs-repository";
import {
  type ImportDocumentSnapshot,
  parseSpreadsheetBuffer,
} from "@/lib/documents/import/parsers";
import {
  ensureDocumentMetadata,
  ensureDocumentOwnership,
  updateDocumentTitle,
} from "@/lib/documents/repository";
import { inngest } from "@/lib/inngest/client";
import { createOperationHistory } from "@/lib/operation-history/repository";
import { issueMcpShareDbAccessToken } from "@/lib/sharedb/mcp-token";
import { withShareDbRuntimeContext } from "@/lib/sharedb/runtime-context";
import { deleteR2Object, getR2ObjectBuffer } from "@/lib/storage/r2";

const SHAREDB_COLLECTION = process.env.SHAREDB_COLLECTION || "spreadsheets";

const getDocumentTitleFromFilename = (filename: string): string | null => {
  const trimmed = filename.trim();
  if (!trimmed) {
    return null;
  }

  const withoutExtension = trimmed.replace(/\.[^/.]+$/, "").trim();
  if (!withoutExtension) {
    return null;
  }

  return withoutExtension;
};

const fetchShareDbDocument = async (doc: ShareDBClient.Doc): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    doc.fetch((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
};

const createShareDbDocument = async (
  doc: ShareDBClient.Doc,
  data: ImportDocumentSnapshot,
): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    doc.create(data, (error) => {
      if (!error) {
        resolve();
        return;
      }

      const message =
        error instanceof Error ? error.message.toLowerCase() : String(error);
      if (message.includes("already created")) {
        resolve();
        return;
      }

      reject(error);
    });
  });

  if (doc.type === null) {
    await fetchShareDbDocument(doc);
  }
};

const createImportBaselineHistory = async (
  documentId: string,
  userId: string,
  sharedbVersion: number,
) => {
  await createOperationHistory({
    collection: SHAREDB_COLLECTION,
    docId: documentId,
    attribution: {
      source: "user",
      actorType: "user",
      actorId: userId,
      userId,
    },
    activityType: "write",
    sharedbVersionFrom: sharedbVersion,
    sharedbVersionTo: sharedbVersion,
    operationPayload: {
      forward: {
        kind: "raw_op",
        data: [],
      },
      inverse: {
        kind: "raw_op",
        data: [],
      },
    },
    metadata: {
      reason: "import_snapshot_baseline",
    },
  });
};

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return "Failed to import document.";
};

export const processDocumentImportJob = inngest.createFunction(
  {
    id: "documents-process-import-job",
    retries: 1,
    triggers: [{ event: "documents/import.requested" }],
  },
  async ({ event, step }) => {
    const jobId =
      typeof event.data?.jobId === "string" ? event.data.jobId.trim() : "";

    if (!jobId) {
      throw new NonRetriableError("Missing import job id.");
    }

    try {
      const job = await step.run("load-import-job", async () => {
        const current = await getDocumentImportJobById(jobId);
        if (!current) {
          throw new NonRetriableError("Import job not found.");
        }
        return current;
      });

      if (job.status === "completed") {
        return {
          ok: true,
          status: "completed",
          documentId: job.docId,
        } as const;
      }

      await step.run("mark-job-parsing", async () => {
        await markDocumentImportJobProcessing({
          id: jobId,
          phase: "parsing",
          progressPercent: 30,
        });
      });

      const fileBuffer = await getR2ObjectBuffer(job.storageKey);
      const snapshot = await parseSpreadsheetBuffer(
        fileBuffer,
        job.fileName,
        job.fileExtension,
      );

      await step.run("mark-job-saving", async () => {
        await markDocumentImportJobProcessing({
          id: jobId,
          phase: "saving",
          progressPercent: 75,
        });
      });

      await ensureDocumentOwnership({ docId: job.docId, userId: job.userId });
      await ensureDocumentMetadata({ docId: job.docId });

      const importTitle = getDocumentTitleFromFilename(job.fileName);
      if (importTitle) {
        try {
          await updateDocumentTitle({
            docId: job.docId,
            userId: job.userId,
            title: importTitle,
          });
        } catch (titleError) {
          console.warn(
            "[documents-import] failed to set imported document title",
            titleError,
          );
        }
      }

      const { doc, close } = await withShareDbRuntimeContext(
        {
          mcpTokenFactory: ({ docId, permission }) =>
            issueMcpShareDbAccessToken({ docId, permission }),
        },
        async () => getShareDBDocument(job.docId),
      );

      let writeResult: { created: boolean; version: number };

      try {
        if (doc.type === null) {
          await createShareDbDocument(doc, snapshot);
          writeResult = {
            created: true,
            version: doc.version ?? 0,
          };
        } else {
          writeResult = {
            created: false,
            version: doc.version ?? 0,
          };
        }
      } finally {
        close();
      }

      await step.run("mark-job-finalizing", async () => {
        await markDocumentImportJobProcessing({
          id: jobId,
          phase: "finalizing",
          progressPercent: 95,
        });
      });

      if (writeResult.created) {
        await createImportBaselineHistory(
          job.docId,
          job.userId,
          writeResult.version,
        );
      }

      await step.run("mark-job-completed", async () => {
        await markDocumentImportJobCompleted({
          id: jobId,
          progressPercent: 100,
        });
      });

      await step.run("cleanup-import-source-file", async () => {
        try {
          await deleteR2Object(job.storageKey);
        } catch (cleanupError) {
          console.warn(
            "[documents-import] failed to delete source file from R2",
            cleanupError,
          );
        }
      });

      return {
        ok: true,
        status: "completed",
        documentId: job.docId,
      } as const;
    } catch (error) {
      const message = getErrorMessage(error);
      await markDocumentImportJobFailed({
        id: jobId,
        errorMessage: message,
      });
      throw error;
    }
  },
);
