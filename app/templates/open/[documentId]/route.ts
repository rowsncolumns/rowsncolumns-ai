import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth/server";
import { createDocumentId } from "@/lib/documents/create-document-id";
import { duplicateTemplateDocument } from "@/lib/documents/repository";

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

export async function GET(request: Request, context: RouteContext) {
  const { documentId: rawDocumentId } = await context.params;
  const parsedDocumentId = documentIdSchema.safeParse(rawDocumentId);
  if (!parsedDocumentId.success) {
    return NextResponse.redirect(new URL("/templates", request.url));
  }

  const sourceDocId = parsedDocumentId.data;
  const { data: session } = await auth.getSession();
  const userId = session?.user?.id;

  if (!userId) {
    const signInUrl = new URL("/auth/sign-in", request.url);
    signInUrl.searchParams.set(
      "callbackURL",
      `/templates/open/${encodeURIComponent(sourceDocId)}`,
    );
    return NextResponse.redirect(signInUrl);
  }

  try {
    const duplicated = await duplicateTemplateDocument({
      sourceDocId,
      duplicatedDocId: createDocumentId(),
      userId,
    });

    if (!duplicated) {
      return NextResponse.redirect(new URL("/templates", request.url));
    }

    return NextResponse.redirect(
      new URL(`/sheets/${encodeURIComponent(duplicated.docId)}`, request.url),
    );
  } catch {
    return NextResponse.redirect(new URL("/templates", request.url));
  }
}
