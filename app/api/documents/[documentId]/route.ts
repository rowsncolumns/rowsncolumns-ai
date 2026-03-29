import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth/server";
import { deleteOwnedDocument } from "@/lib/documents/repository";

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

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { data: session } = await auth.getSession();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const { documentId: rawDocumentId } = await context.params;
    const parsed = documentIdSchema.safeParse(rawDocumentId);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "Invalid request.";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const deleted = await deleteOwnedDocument({
      docId: parsed.data,
      userId,
    });

    if (!deleted) {
      return NextResponse.json(
        { error: "Document not found or not owned by this user." },
        { status: 404 },
      );
    }

    return NextResponse.json({ deleted: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete document.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
