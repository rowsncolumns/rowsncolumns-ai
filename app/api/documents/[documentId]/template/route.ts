import { NextResponse } from "next/server";
import { z } from "zod";

import { isAdminUser } from "@/lib/auth/admin";
import { auth } from "@/lib/auth/server";
import {
  documentExists,
  getDocumentTemplateMetadata,
  upsertDocumentTemplateMetadata,
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

const updateTemplateSchema = z.object({
  isTemplate: z.boolean(),
  templateTitle: z
    .string()
    .max(300, "templateTitle is too long.")
    .optional()
    .default(""),
  category: z.string().max(120, "category is too long.").optional().default(""),
  descriptionMarkdown: z
    .string()
    .max(25000, "descriptionMarkdown is too long.")
    .optional()
    .default(""),
  tags: z.array(z.string().max(80, "tag is too long.")).optional().default([]),
  previewImageUrl: z
    .string()
    .max(3000, "previewImageUrl is too long.")
    .optional()
    .default(""),
});

const requireAdminSession = async () => {
  const { data: session } = await auth.getSession();
  const user = session?.user;
  if (!user?.id) {
    return {
      error: NextResponse.json({ error: "Unauthorized." }, { status: 401 }),
      user: null as null,
    };
  }

  const isAdmin = isAdminUser({ id: user.id, email: user.email });
  if (!isAdmin) {
    return {
      error: NextResponse.json({ error: "Forbidden." }, { status: 403 }),
      user: null as null,
    };
  }

  return {
    error: null as null,
    user,
  };
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const adminSession = await requireAdminSession();
    if (adminSession.error) {
      return adminSession.error;
    }

    const { documentId: rawDocumentId } = await context.params;
    const parsedDocumentId = documentIdSchema.safeParse(rawDocumentId);
    if (!parsedDocumentId.success) {
      const message =
        parsedDocumentId.error.issues[0]?.message ?? "Invalid request.";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const documentId = parsedDocumentId.data;
    if (!(await documentExists(documentId))) {
      return NextResponse.json({ error: "Document not found." }, { status: 404 });
    }

    const metadata = await getDocumentTemplateMetadata({ docId: documentId });
    if (!metadata) {
      return NextResponse.json({ error: "Document not found." }, { status: 404 });
    }

    return NextResponse.json({
      documentId: metadata.docId,
      title: metadata.title,
      templateTitle: metadata.templateTitle,
      isTemplate: metadata.isTemplate,
      category: metadata.category,
      descriptionMarkdown: metadata.descriptionMarkdown,
      tags: metadata.tags,
      previewImageUrl: metadata.previewImageUrl,
      updatedAt: metadata.updatedAt,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load template metadata.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const adminSession = await requireAdminSession();
    if (adminSession.error) {
      return adminSession.error;
    }

    const { documentId: rawDocumentId } = await context.params;
    const parsedDocumentId = documentIdSchema.safeParse(rawDocumentId);
    if (!parsedDocumentId.success) {
      const message =
        parsedDocumentId.error.issues[0]?.message ?? "Invalid request.";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const documentId = parsedDocumentId.data;
    if (!(await documentExists(documentId))) {
      return NextResponse.json({ error: "Document not found." }, { status: 404 });
    }

    const body = await request.json().catch(() => null);
    const parsedBody = updateTemplateSchema.safeParse(body);
    if (!parsedBody.success) {
      const message = parsedBody.error.issues[0]?.message ?? "Invalid request.";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const metadata = await upsertDocumentTemplateMetadata({
      docId: documentId,
      isTemplate: parsedBody.data.isTemplate,
      templateTitle: parsedBody.data.templateTitle,
      category: parsedBody.data.category,
      descriptionMarkdown: parsedBody.data.descriptionMarkdown,
      tags: parsedBody.data.tags,
      previewImageUrl: parsedBody.data.previewImageUrl,
    });

    if (!metadata) {
      return NextResponse.json({ error: "Document not found." }, { status: 404 });
    }

    return NextResponse.json({
      documentId: metadata.docId,
      title: metadata.title,
      templateTitle: metadata.templateTitle,
      isTemplate: metadata.isTemplate,
      category: metadata.category,
      descriptionMarkdown: metadata.descriptionMarkdown,
      tags: metadata.tags,
      previewImageUrl: metadata.previewImageUrl,
      updatedAt: metadata.updatedAt,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to update template metadata.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
