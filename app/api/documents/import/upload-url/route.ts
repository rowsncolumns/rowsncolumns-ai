import { NextResponse } from "next/server";

import { auth } from "@/lib/auth/server";
import { SUPPORTED_IMPORT_EXTENSIONS } from "@/lib/documents/import/parsers";
import {
  formatMaxUploadSizeLabel,
  getMaxImportUploadBytes,
} from "@/lib/documents/import/upload-limits";
import {
  createR2PresignedPutUrl,
  getR2Config,
} from "@/lib/storage/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPLOAD_URL_TTL_SECONDS = 15 * 60;

const getFileExtension = (filename: string): string => {
  const parts = filename.toLowerCase().split(".");
  return parts.length > 1 ? (parts.at(-1) ?? "") : "";
};

const sanitizeForObjectKey = (value: string): string =>
  value
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 160);

const buildImportObjectKey = (input: {
  userId: string;
  uploadId: string;
  fileName: string;
}) => {
  const sanitizedUserId = sanitizeForObjectKey(input.userId);
  const sanitizedFileName = sanitizeForObjectKey(input.fileName) || "import-file";
  const datePrefix = new Date().toISOString().slice(0, 10);
  return `document-imports/${sanitizedUserId}/${datePrefix}/${input.uploadId}/${sanitizedFileName}`;
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

type UploadUrlRequestBody = {
  fileName?: unknown;
  fileSizeBytes?: unknown;
  contentType?: unknown;
};

const toTrimmedString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export async function POST(request: Request) {
  try {
    const maxUploadBytes = getMaxImportUploadBytes();
    const maxUploadLabel = formatMaxUploadSizeLabel(maxUploadBytes);

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

    const body = (await request.json().catch(() => null)) as
      | UploadUrlRequestBody
      | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Invalid upload request payload." },
        { status: 400 },
      );
    }

    const fileName = toTrimmedString(body.fileName);
    const fileSizeBytes =
      typeof body.fileSizeBytes === "number" ? body.fileSizeBytes : NaN;
    const contentType = toTrimmedString(body.contentType) ?? "";

    if (!fileName) {
      return NextResponse.json(
        { error: "File name is required." },
        { status: 400 },
      );
    }

    if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0) {
      return NextResponse.json(
        { error: "Invalid file size." },
        { status: 400 },
      );
    }

    if (fileSizeBytes > maxUploadBytes) {
      return NextResponse.json(
        {
          error: `File too large. Maximum supported upload size is ${maxUploadLabel}.`,
        },
        { status: 413 },
      );
    }

    const extension = getFileExtension(fileName);
    if (!SUPPORTED_IMPORT_EXTENSIONS.has(extension)) {
      return NextResponse.json(
        {
          error:
            "Unsupported file type. Upload an Excel (.xlsx/.xls), ODS, or CSV file.",
        },
        { status: 400 },
      );
    }

    const uploadId = crypto.randomUUID();
    const objectKey = buildImportObjectKey({
      userId,
      uploadId,
      fileName,
    });

    const resolvedContentType = getUploadContentType({
      extension,
      contentType,
    });
    const uploadUrl = await createR2PresignedPutUrl({
      key: objectKey,
      contentType: resolvedContentType,
      expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
    });

    return NextResponse.json({
      uploadUrl,
      objectKey,
      contentType: resolvedContentType,
      expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
      maxUploadBytes,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create upload URL.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
