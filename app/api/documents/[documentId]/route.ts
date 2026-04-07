import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth/server";
import { resolveActiveOrganizationIdForSession } from "@/lib/auth/organization";
import {
  deleteOwnedDocument,
  isOwnedGlobalTemplateDocument,
  setDocumentFavorite,
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

const updateFavoriteSchema = z.object({
  favorite: z.boolean(),
});

export async function DELETE(_request: Request, context: RouteContext) {
  try {
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

    const { documentId: rawDocumentId } = await context.params;
    const parsed = documentIdSchema.safeParse(rawDocumentId);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "Invalid request.";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const isGlobalTemplate = await isOwnedGlobalTemplateDocument({
      docId: parsed.data,
      userId,
      orgId,
    });
    if (isGlobalTemplate) {
      return NextResponse.json(
        { error: "Global template sheets cannot be deleted." },
        { status: 409 },
      );
    }

    const deleted = await deleteOwnedDocument({
      docId: parsed.data,
      userId,
      orgId,
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

export async function PATCH(request: Request, context: RouteContext) {
  try {
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

    const { documentId: rawDocumentId } = await context.params;
    const parsedDocumentId = documentIdSchema.safeParse(rawDocumentId);
    if (!parsedDocumentId.success) {
      const message =
        parsedDocumentId.error.issues[0]?.message ?? "Invalid request.";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const body = await request.json().catch(() => null);
    const parsedBody = updateFavoriteSchema.safeParse(body);
    if (!parsedBody.success) {
      const message = parsedBody.error.issues[0]?.message ?? "Invalid request.";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const updated = await setDocumentFavorite({
      docId: parsedDocumentId.data,
      userId,
      orgId,
      favorite: parsedBody.data.favorite,
    });

    if (!updated) {
      return NextResponse.json(
        { error: "Document not found or inaccessible by this user." },
        { status: 404 },
      );
    }

    return NextResponse.json({
      documentId: parsedDocumentId.data,
      favorite: parsedBody.data.favorite,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update favorite.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
