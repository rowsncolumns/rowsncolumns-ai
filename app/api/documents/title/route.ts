import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth/server";
import { resolveActiveOrganizationIdForSession } from "@/lib/auth/organization";
import { updateDocumentTitle } from "@/lib/documents/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateDocumentTitleSchema = z.object({
  documentId: z
    .string()
    .trim()
    .min(1, "documentId is required.")
    .max(200, "documentId is too long."),
  title: z
    .string()
    .max(500, "title is too long.")
    .default(""),
});

export async function PATCH(request: Request) {
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

    const body = await request.json().catch(() => null);
    const parsed = updateDocumentTitleSchema.safeParse(body);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "Invalid request.";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const titleRecord = await updateDocumentTitle({
      docId: parsed.data.documentId,
      userId,
      orgId,
      title: parsed.data.title,
    });

    if (!titleRecord) {
      return NextResponse.json(
        { error: "Only the document owner can rename this document." },
        { status: 403 },
      );
    }

    return NextResponse.json({
      documentId: titleRecord.docId,
      title: titleRecord.title,
      updatedAt: titleRecord.updatedAt,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update document.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
