import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth/server";
import { getOrCreateDocumentShareLink } from "@/lib/documents/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createShareLinkSchema = z.object({
  documentId: z
    .string()
    .trim()
    .min(1, "documentId is required.")
    .max(200, "documentId is too long."),
});

export async function POST(request: Request) {
  try {
    const { data: session } = await auth.getSession();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const parsed = createShareLinkSchema.safeParse(body);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "Invalid request.";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const shareLink = await getOrCreateDocumentShareLink({
      docId: parsed.data.documentId,
      userId,
    });

    if (!shareLink) {
      return NextResponse.json(
        { error: "Only the document owner can share this document." },
        { status: 403 },
      );
    }

    const origin = new URL(request.url).origin;
    const shareUrl = `${origin}/doc/${encodeURIComponent(shareLink.docId)}?share=${encodeURIComponent(shareLink.shareToken)}`;

    return NextResponse.json({
      shareUrl,
      shareToken: shareLink.shareToken,
      isActive: shareLink.isActive,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create share link.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
