import { NextResponse } from "next/server";

import { auth } from "@/lib/auth/server";
import { createDocumentId } from "@/lib/documents/create-document-id";
import {
  createDocumentImportJob,
  markDocumentImportJobFailed,
} from "@/lib/documents/import-jobs-repository";
import { SUPPORTED_IMPORT_EXTENSIONS } from "@/lib/documents/import/parsers";
import {
  ensureDocumentMetadata,
  ensureDocumentOwnership,
  updateDocumentTitle,
} from "@/lib/documents/repository";
import { inngest } from "@/lib/inngest/client";
import { deleteR2Object, getR2Config, putR2Object } from "@/lib/storage/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

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

export async function POST(request: Request) {
  let uploadedObjectKey: string | null = null;
  let createdJobId: string | null = null;

  try {
    const { data: session } = await auth.getSession();
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    if (!getR2Config()) {
      return NextResponse.json(
        { error: "R2 is not configured for spreadsheet import." },
        { status: 500 },
      );
    }

    const formData = await request.formData();
    const fileInput = formData.get("file");

    if (!(fileInput instanceof File)) {
      return NextResponse.json(
        { error: "Please upload a file." },
        { status: 400 },
      );
    }

    const extension = getFileExtension(fileInput.name);
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

    if (fileInput.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        {
          error: "File too large. Maximum supported upload size is 20 MB.",
        },
        { status: 413 },
      );
    }

    const fileBuffer = Buffer.from(await fileInput.arrayBuffer());
    const documentId = createDocumentId();
    const jobId = crypto.randomUUID();
    const objectKey = buildImportObjectKey({
      userId,
      jobId,
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

    await ensureDocumentOwnership({ docId: documentId, userId });
    await ensureDocumentMetadata({ docId: documentId });

    const importTitle = getDocumentTitleFromFilename(fileInput.name);
    if (importTitle) {
      try {
        await updateDocumentTitle({
          docId: documentId,
          userId,
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
      fileName: fileInput.name || `upload.${extension}`,
      fileExtension: extension,
      fileSizeBytes: fileInput.size,
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
