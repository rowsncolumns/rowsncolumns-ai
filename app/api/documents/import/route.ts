import { NextResponse } from "next/server";
import type ShareDBClient from "sharedb/lib/client";

import { auth } from "@/lib/auth/server";
import { getShareDBDocument } from "@/lib/chat/utils";
import { createDocumentId } from "@/lib/documents/create-document-id";
import {
  type ImportDocumentSnapshot,
  parseSpreadsheetBuffer,
  SUPPORTED_IMPORT_EXTENSIONS,
} from "@/lib/documents/import/parsers";
import {
  ensureDocumentMetadata,
  ensureDocumentOwnership,
  updateDocumentTitle,
} from "@/lib/documents/repository";
import { createOperationHistory } from "@/lib/operation-history/repository";
import { issueMcpShareDbAccessToken } from "@/lib/sharedb/mcp-token";
import { withShareDbRuntimeContext } from "@/lib/sharedb/runtime-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const SHAREDB_COLLECTION = process.env.SHAREDB_COLLECTION || "spreadsheets";

const buildShareDbWsHeaders = (request: Request): Record<string, string> => {
  const headers: Record<string, string> = {};
  const cookie = request.headers.get("cookie")?.trim();
  if (cookie) {
    headers.cookie = cookie;
  }
  const authorization = request.headers.get("authorization")?.trim();
  if (authorization) {
    headers.authorization = authorization;
  }
  return headers;
};

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

export async function POST(request: Request) {
  try {
    const { data: session } = await auth.getSession();
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
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

    const buffer = Buffer.from(await fileInput.arrayBuffer());

    let snapshot: ImportDocumentSnapshot;
    try {
      snapshot = await parseSpreadsheetBuffer(
        buffer,
        fileInput.name,
        extension,
      );
    } catch (err) {
      return NextResponse.json(
        {
          error:
            "Unable to read this file. Please upload a valid Excel, ODS, or CSV file." +
            err,
        },
        { status: 400 },
      );
    }

    const documentId = createDocumentId();
    const importTitle = getDocumentTitleFromFilename(fileInput.name);
    await ensureDocumentOwnership({ docId: documentId, userId });
    await ensureDocumentMetadata({ docId: documentId });
    if (importTitle) {
      try {
        await updateDocumentTitle({
          docId: documentId,
          userId,
          title: importTitle,
        });
      } catch (titleError) {
        console.warn(
          "[import] failed to set imported document title",
          titleError,
        );
      }
    }

    const { doc, close } = await withShareDbRuntimeContext(
      {
        mcpTokenFactory: ({ docId, permission }) =>
          issueMcpShareDbAccessToken({ docId, permission }),
        wsHeaders: buildShareDbWsHeaders(request),
      },
      async () => getShareDBDocument(documentId),
    );

    try {
      if (doc.type === null) {
        await createShareDbDocument(doc, snapshot);
      } else {
        return NextResponse.json(
          { error: "Document already exists." },
          { status: 409 },
        );
      }

      try {
        await createImportBaselineHistory(documentId, userId, doc.version ?? 0);
      } catch (historyError) {
        console.warn(
          "[import] failed to create baseline history entry",
          historyError,
        );
      }

      return NextResponse.json({ documentId });
    } finally {
      close();
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to import document.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
