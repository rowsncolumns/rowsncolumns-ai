import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth/server";
import {
  deactivateDocumentShareLink,
  getDocumentShareLinkState,
  getOrCreateDocumentShareLink,
  updateDocumentSharePublicAccess,
  updateDocumentSharePermission,
} from "@/lib/documents/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createShareLinkSchema = z.object({
  documentId: z
    .string()
    .trim()
    .min(1, "documentId is required.")
    .max(200, "documentId is too long."),
});

const updateShareSettingsSchema = z
  .object({
    documentId: z
      .string()
      .trim()
      .min(1, "documentId is required.")
      .max(200, "documentId is too long."),
    permission: z.enum(["view", "edit"]).optional(),
    isPublic: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.permission === undefined && value.isPublic === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "permission or isPublic is required.",
        path: ["permission"],
      });
    }
  });

export async function GET(request: Request) {
  try {
    const { data: session } = await auth.getSession();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const url = new URL(request.url);
    const parsed = createShareLinkSchema.safeParse({
      documentId: url.searchParams.get("documentId"),
    });
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "Invalid request.";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const state = await getDocumentShareLinkState({
      docId: parsed.data.documentId,
      userId,
    });

    if (!state.isOwner) {
      return NextResponse.json(
        { error: "Only the document owner can view sharing settings." },
        { status: 403 },
      );
    }

    if (!state.shareLink) {
      return NextResponse.json({
        isActive: false,
        isPublic: false,
        permission: "view",
      });
    }

    const origin = new URL(request.url).origin;
    const shareUrl = `${origin}/sheets/${encodeURIComponent(state.shareLink.docId)}?share=${encodeURIComponent(state.shareLink.shareToken)}`;

    return NextResponse.json({
      shareUrl,
      shareToken: state.shareLink.shareToken,
      isActive: state.shareLink.isActive,
      isPublic: state.shareLink.isPublic,
      permission: state.shareLink.permission,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load share state.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

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
    const shareUrl = `${origin}/sheets/${encodeURIComponent(shareLink.docId)}?share=${encodeURIComponent(shareLink.shareToken)}`;

    return NextResponse.json({
      shareUrl,
      shareToken: shareLink.shareToken,
      isActive: shareLink.isActive,
      isPublic: shareLink.isPublic,
      permission: shareLink.permission,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create share link.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
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

    const result = await deactivateDocumentShareLink({
      docId: parsed.data.documentId,
      userId,
    });

    if (!result.isOwner) {
      return NextResponse.json(
        { error: "Only the document owner can update sharing settings." },
        { status: 403 },
      );
    }

    return NextResponse.json({
      isActive: false,
      wasActive: result.wasActive,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to disable sharing.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const { data: session } = await auth.getSession();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const parsed = updateShareSettingsSchema.safeParse(body);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "Invalid request.";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    let shareLink = null;
    if (parsed.data.permission !== undefined) {
      shareLink = await updateDocumentSharePermission({
        docId: parsed.data.documentId,
        userId,
        permission: parsed.data.permission,
      });
    }
    if (parsed.data.isPublic !== undefined) {
      shareLink = await updateDocumentSharePublicAccess({
        docId: parsed.data.documentId,
        userId,
        isPublic: parsed.data.isPublic,
      });
    }

    if (!shareLink) {
      return NextResponse.json(
        { error: "Only the document owner can update sharing settings." },
        { status: 403 },
      );
    }

    const origin = new URL(request.url).origin;
    const shareUrl = `${origin}/sheets/${encodeURIComponent(shareLink.docId)}?share=${encodeURIComponent(shareLink.shareToken)}`;

    return NextResponse.json({
      shareUrl,
      shareToken: shareLink.shareToken,
      isActive: shareLink.isActive,
      isPublic: shareLink.isPublic,
      permission: shareLink.permission,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to update share permission.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
