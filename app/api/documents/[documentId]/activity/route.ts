import { NextResponse } from "next/server";

import { auth } from "@/lib/auth/server";
import { documentExists, ensureDocumentAccess } from "@/lib/documents/repository";
import { getFlags } from "@/lib/feature-flags";
import { resolveAuditHistoryAccess } from "@/lib/operation-history/access";
import {
  operationHistoryActivityQuerySchema,
  operationHistoryDocumentIdSchema,
} from "@/lib/operation-history/api-schemas";
import { listActivities, countActivities } from "@/lib/operation-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ documentId: string }>;
};

/**
 * GET /api/documents/[documentId]/activity
 *
 * List operation history (activities) for a document.
 *
 * Query params:
 * - limit: number (1-100, default 20)
 * - cursor: pagination cursor
 * - from: ISO timestamp filter
 * - to: ISO timestamp filter
 * - by: actor_id filter
 * - activityTypes: comma-separated (write,rollback,restore)
 * - sources: comma-separated (agent,user,backend)
 * - includeCount: boolean (include total count)
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    // Check feature flag
    const flags = getFlags();
    if (!flags.enableActivityApi) {
      return NextResponse.json(
        { error: "Activity API is not enabled." },
        { status: 404 }
      );
    }

    // Auth check
    const { data: session } = await auth.getSession();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    const auditAccess = await resolveAuditHistoryAccess({
      userId,
      email: session.user?.email,
    });
    if (!auditAccess.allowed) {
      return NextResponse.json(
        {
          error:
            "Audit history is available only on the Max plan or for admin users.",
        },
        { status: 403 }
      );
    }

    // Validate documentId
    const { documentId: rawDocumentId } = await context.params;
    const parsedDocumentId = operationHistoryDocumentIdSchema.safeParse(rawDocumentId);
    if (!parsedDocumentId.success) {
      const message =
        parsedDocumentId.error.issues[0]?.message ?? "Invalid request.";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const documentId = parsedDocumentId.data;
    if (!(await documentExists(documentId))) {
      return NextResponse.json(
        { error: "Document not found." },
        { status: 404 }
      );
    }

    const access = await ensureDocumentAccess({
      docId: documentId,
      userId,
    });
    if (!access.canAccess) {
      return NextResponse.json(
        { error: "Document not found." },
        { status: 404 }
      );
    }

    // Parse query params
    const url = new URL(request.url);
    const queryParams = Object.fromEntries(url.searchParams.entries());
    const parsedQuery = operationHistoryActivityQuerySchema.safeParse(queryParams);
    if (!parsedQuery.success) {
      const message =
        parsedQuery.error.issues[0]?.message ?? "Invalid query parameters.";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const { limit, cursor, from, to, by, activityTypes, sources, includeCount } =
      parsedQuery.data;

    // Fetch activities
    const filters = { from, to, by, activityTypes, sources };
    const result = await listActivities(documentId, limit, cursor, filters);

    // Optionally include total count
    let totalCount: number | undefined;
    if (includeCount) {
      totalCount = await countActivities(documentId, filters);
    }

    return NextResponse.json({
      items: result.items,
      nextCursor: result.nextCursor,
      permission: access.permission,
      ...(totalCount !== undefined && { totalCount }),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch activities.";
    console.error("[activity] Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
