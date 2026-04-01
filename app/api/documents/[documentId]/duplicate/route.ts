import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth/server";
import { createDocumentId } from "@/lib/documents/create-document-id";
import {
  documentExists,
  duplicateDocument,
  ensureDocumentAccess,
} from "@/lib/documents/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ documentId: string }>;
};

const documentIdSchema = z
  .string()
  .trim()
  .min(1, "documentId is required.")
  .max(200, "documentId is too long.");

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { data: session } = await auth.getSession();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const { documentId: rawDocumentId } = await context.params;
    const parsedDocumentId = documentIdSchema.safeParse(rawDocumentId);
    if (!parsedDocumentId.success) {
      const message =
        parsedDocumentId.error.issues[0]?.message ?? "Invalid request.";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const sourceDocId = parsedDocumentId.data;

    if (!(await documentExists(sourceDocId))) {
      return NextResponse.json({ error: "Document not found." }, { status: 404 });
    }

    const access = await ensureDocumentAccess({
      docId: sourceDocId,
      userId,
    });
    if (!access.canAccess) {
      return NextResponse.json({ error: "Document not found." }, { status: 404 });
    }

    const duplicatedDocId = createDocumentId();
    const duplicated = await duplicateDocument({
      sourceDocId,
      duplicatedDocId,
      userId,
    });

    if (!duplicated) {
      return NextResponse.json({ error: "Document not found." }, { status: 404 });
    }

    return NextResponse.json({
      sourceDocumentId: sourceDocId,
      documentId: duplicated.docId,
      title: duplicated.title,
      snapshotCopied: duplicated.snapshotCopied,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to duplicate document.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
