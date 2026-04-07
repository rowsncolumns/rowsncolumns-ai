import { NextResponse } from "next/server";
import { z } from "zod";

import { isAdminUser } from "@/lib/auth/admin";
import { resolveActiveOrganizationIdForSession } from "@/lib/auth/organization";
import { auth } from "@/lib/auth/server";
import {
  documentExists,
  getDocumentTemplateMetadata,
  isDocumentOwner,
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
  templateScope: z.enum(["none", "personal", "organization", "global"]),
  templateTitle: z
    .string()
    .max(300, "templateTitle is too long.")
    .optional()
    .default(""),
  tagline: z.string().max(220, "tagline is too long.").optional().default(""),
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

const requireOwnerSession = async (documentId: string) => {
  const { data: session } = await auth.getSession();
  const user = session?.user;
  if (!user?.id) {
    return {
      error: NextResponse.json({ error: "Unauthorized." }, { status: 401 }),
      user: null as null,
    };
  }
  const orgId = await resolveActiveOrganizationIdForSession(session);
  if (!orgId) {
    return {
      error: NextResponse.json(
        {
          error: "No active organization. Create an organization first.",
          onboardingUrl: "/onboarding/organization",
        },
        { status: 409 },
      ),
      user: null as null,
    };
  }

  const isOwner = await isDocumentOwner({
    docId: documentId,
    userId: user.id,
    orgId,
  });
  if (!isOwner) {
    return {
      error: NextResponse.json({ error: "Forbidden." }, { status: 403 }),
      user: null as null,
    };
  }

  return {
    error: null as null,
    user,
    isAdmin: isAdminUser({
      id: user.id,
      email: user.email,
    }),
  };
};

export async function GET(_request: Request, context: RouteContext) {
  try {
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
    const ownerSession = await requireOwnerSession(documentId);
    if (ownerSession.error) {
      return ownerSession.error;
    }

    const metadata = await getDocumentTemplateMetadata({ docId: documentId });
    if (!metadata) {
      return NextResponse.json({ error: "Document not found." }, { status: 404 });
    }

    return NextResponse.json({
      documentId: metadata.docId,
      title: metadata.title,
      templateTitle: metadata.templateTitle,
      tagline: metadata.tagline,
      isTemplate: metadata.isTemplate,
      isGlobalTemplate: metadata.isGlobalTemplate,
      templateScope: metadata.templateScope,
      category: metadata.category,
      descriptionMarkdown: metadata.descriptionMarkdown,
      tags: metadata.tags,
      previewImageUrl: metadata.previewImageUrl,
      canPublishGlobal: ownerSession.isAdmin,
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
    const ownerSession = await requireOwnerSession(documentId);
    if (ownerSession.error) {
      return ownerSession.error;
    }

    const body = await request.json().catch(() => null);
    const parsedBody = updateTemplateSchema.safeParse(body);
    if (!parsedBody.success) {
      const message = parsedBody.error.issues[0]?.message ?? "Invalid request.";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    if (parsedBody.data.templateScope === "global" && !ownerSession.isAdmin) {
      return NextResponse.json(
        { error: "Only admins can publish global templates." },
        { status: 403 },
      );
    }

    const metadata = await upsertDocumentTemplateMetadata({
      docId: documentId,
      templateScope: parsedBody.data.templateScope,
      templateTitle: parsedBody.data.templateTitle,
      tagline: parsedBody.data.tagline,
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
      tagline: metadata.tagline,
      isTemplate: metadata.isTemplate,
      isGlobalTemplate: metadata.isGlobalTemplate,
      templateScope: metadata.templateScope,
      category: metadata.category,
      descriptionMarkdown: metadata.descriptionMarkdown,
      tags: metadata.tags,
      previewImageUrl: metadata.previewImageUrl,
      canPublishGlobal: ownerSession.isAdmin,
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
