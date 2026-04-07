import { NextResponse } from "next/server";

import { auth } from "@/lib/auth/server";
import { resolveActiveOrganizationIdForSession } from "@/lib/auth/organization";
import { createDocumentId } from "@/lib/documents/create-document-id";
import {
  createDocumentImportJob,
  markDocumentImportJobFailed,
} from "@/lib/documents/import-jobs-repository";
import { SUPPORTED_IMPORT_EXTENSIONS } from "@/lib/documents/import/parsers";
import {
  formatMaxUploadSizeLabel,
  getMaxImportUploadBytes,
} from "@/lib/documents/import/upload-limits";
import {
  ensureDocumentMetadata,
  ensureDocumentOwnership,
  updateDocumentTitle,
} from "@/lib/documents/repository";
import { inngest } from "@/lib/inngest/client";
import {
  deleteR2Object,
  getR2Config,
  headR2Object,
  putR2Object,
} from "@/lib/storage/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const getFileExtension = (filename: string): string => {
  const parts = filename.toLowerCase().split(".");
  return parts.length > 1 ? (parts.at(-1) ?? "") : "";
};

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

const sanitizeForObjectKey = (value: string): string =>
  value
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 160);

const toTrimmedString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const getUploadContentType = (input: { extension: string; contentType: string }) => {
  const incoming = input.contentType.trim().toLowerCase();
  if (incoming) {
    return incoming;
  }

  if (input.extension === "csv") return "text/csv";
  if (input.extension === "xls") return "application/vnd.ms-excel";
  if (input.extension === "xlsx") {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (input.extension === "ods") {
    return "application/vnd.oasis.opendocument.spreadsheet";
  }

  return "application/octet-stream";
};

const buildImportObjectKey = (input: {
  userId: string;
  jobId: string;
  fileName: string;
}) => {
  const sanitizedUserId = sanitizeForObjectKey(input.userId);
  const sanitizedFileName = sanitizeForObjectKey(input.fileName) || "import-file";
  const datePrefix = new Date().toISOString().slice(0, 10);
  return `document-imports/${sanitizedUserId}/${datePrefix}/${input.jobId}/${sanitizedFileName}`;
};

const getUserImportKeyPrefix = (userId: string) => {
  const sanitizedUserId = sanitizeForObjectKey(userId);
  return `document-imports/${sanitizedUserId}/`;
};

type DirectImportRequestBody = {
  objectKey?: unknown;
  fileName?: unknown;
  fileExtension?: unknown;
  fileSizeBytes?: unknown;
};

export async function POST(request: Request) {
  let uploadedObjectKey: string | null = null;
  let createdJobId: string | null = null;

  try {
    const maxUploadBytes = getMaxImportUploadBytes();
    const maxUploadLabel = formatMaxUploadSizeLabel(maxUploadBytes);

    const { data: session } = await auth.getSession();
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    const orgId = await resolveActiveOrganizationIdForSession(session);
    if (!orgId) {
      return NextResponse.json(
        {
          error: "No active organization. Create an organization first.",
          onboardingUrl: "/onboarding/organization",
        },
        { status: 409 },
      );
    }

    if (!getR2Config()) {
      return NextResponse.json(
        { error: "R2 is not configured for spreadsheet import." },
        { status: 500 },
      );
    }

    const requestContentType =
      request.headers.get("content-type")?.toLowerCase() ?? "";

    let fileName = "";
    let extension = "";
    let fileSizeBytes = 0;
    let objectKey = "";

    if (requestContentType.includes("application/json")) {
      const body = (await request.json().catch(() => null)) as
        | DirectImportRequestBody
        | null;
      if (!body || typeof body !== "object") {
        return NextResponse.json(
          { error: "Invalid import request payload." },
          { status: 400 },
        );
      }

      const requestedObjectKey = toTrimmedString(body.objectKey);
      const requestedFileName = toTrimmedString(body.fileName);
      const requestedExtension = toTrimmedString(body.fileExtension)?.toLowerCase();
      const requestedFileSize =
        typeof body.fileSizeBytes === "number" ? body.fileSizeBytes : NaN;

      if (!requestedObjectKey || !requestedFileName) {
        return NextResponse.json(
          { error: "Missing uploaded file metadata." },
          { status: 400 },
        );
      }

      if (!Number.isFinite(requestedFileSize) || requestedFileSize <= 0) {
        return NextResponse.json(
          { error: "Invalid file size." },
          { status: 400 },
        );
      }

      const resolvedExtension = requestedExtension || getFileExtension(requestedFileName);
      if (!SUPPORTED_IMPORT_EXTENSIONS.has(resolvedExtension)) {
        return NextResponse.json(
          {
            error:
              "Unsupported file type. Upload an Excel (.xlsx/.xls), ODS, or CSV file.",
          },
          { status: 400 },
        );
      }

      const userKeyPrefix = getUserImportKeyPrefix(userId);
      if (!requestedObjectKey.startsWith(userKeyPrefix)) {
        return NextResponse.json(
          { error: "Uploaded object key is not valid for this user." },
          { status: 400 },
        );
      }

      const uploadedMetadata = await headR2Object(requestedObjectKey);
      if (!uploadedMetadata) {
        return NextResponse.json(
          { error: "Uploaded file not found. Please upload again." },
          { status: 400 },
        );
      }

      const resolvedSize =
        uploadedMetadata.contentLength && uploadedMetadata.contentLength > 0
          ? uploadedMetadata.contentLength
          : requestedFileSize;

      if (resolvedSize <= 0) {
        return NextResponse.json(
          { error: "Uploaded file is empty." },
          { status: 400 },
        );
      }

      if (resolvedSize > maxUploadBytes) {
        return NextResponse.json(
          {
            error: `File too large. Maximum supported upload size is ${maxUploadLabel}.`,
          },
          { status: 413 },
        );
      }

      fileName = requestedFileName;
      extension = resolvedExtension;
      fileSizeBytes = resolvedSize;
      objectKey = requestedObjectKey;
      uploadedObjectKey = objectKey;
    } else {
      const formData = await request.formData();
      const fileInput = formData.get("file");

      if (!(fileInput instanceof File)) {
        return NextResponse.json(
          { error: "Please upload a file." },
          { status: 400 },
        );
      }

      extension = getFileExtension(fileInput.name);
      if (!SUPPORTED_IMPORT_EXTENSIONS.has(extension)) {
        return NextResponse.json(
          {
            error:
              "Unsupported file type. Upload an Excel (.xlsx/.xls), ODS, or CSV file.",
          },
          { status: 400 },
        );
      }

      if (fileInput.size <= 0) {
        return NextResponse.json(
          { error: "Uploaded file is empty." },
          { status: 400 },
        );
      }

      if (fileInput.size > maxUploadBytes) {
        return NextResponse.json(
          {
            error: `File too large. Maximum supported upload size is ${maxUploadLabel}.`,
          },
          { status: 413 },
        );
      }

      const fileBuffer = Buffer.from(await fileInput.arrayBuffer());
      const uploadId = crypto.randomUUID();
      objectKey = buildImportObjectKey({
        userId,
        jobId: uploadId,
        fileName: fileInput.name || `upload.${extension}`,
      });

      await putR2Object({
        key: objectKey,
        body: fileBuffer,
        contentType: getUploadContentType({
          extension,
          contentType: fileInput.type,
        }),
        cacheControl: "private, max-age=86400",
        contentDisposition: "attachment",
      });
      uploadedObjectKey = objectKey;
      fileName = fileInput.name || `upload.${extension}`;
      fileSizeBytes = fileInput.size;
    }

    const documentId = createDocumentId();
    const jobId = crypto.randomUUID();

    await ensureDocumentOwnership({ docId: documentId, userId, orgId });
    await ensureDocumentMetadata({ docId: documentId });

    const importTitle = getDocumentTitleFromFilename(fileName);
    if (importTitle) {
      try {
        await updateDocumentTitle({
          docId: documentId,
          userId,
          orgId,
          title: importTitle,
        });
      } catch (titleError) {
        console.warn(
          "[documents-import] failed to set imported document title",
          titleError,
        );
      }
    }

    await createDocumentImportJob({
      id: jobId,
      docId: documentId,
      userId,
      fileName: fileName || `upload.${extension}`,
      fileExtension: extension,
      fileSizeBytes,
      storageKey: objectKey,
    });
    createdJobId = jobId;

    await inngest.send({
      name: "documents/import.requested",
      data: {
        jobId,
      },
    });

    return NextResponse.json({
      jobId,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to queue import.";

    if (createdJobId) {
      try {
        await markDocumentImportJobFailed({
          id: createdJobId,
          errorMessage: message,
        });
      } catch (jobError) {
        console.warn(
          "[documents-import] failed to update import job failure state",
          jobError,
        );
      }
    }

    if (uploadedObjectKey) {
      try {
        await deleteR2Object(uploadedObjectKey);
      } catch (cleanupError) {
        console.warn(
          "[documents-import] failed to cleanup uploaded source object",
          cleanupError,
        );
      }
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
