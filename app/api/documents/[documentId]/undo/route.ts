import { NextResponse } from "next/server";

import { auth } from "@/lib/auth/server";
import { resolveActiveOrganizationIdForSession } from "@/lib/auth/organization";
import {
  documentExists,
  ensureDocumentAccess,
} from "@/lib/documents/repository";
import { getFlags } from "@/lib/feature-flags";
import { resolveAuditHistoryAccess } from "@/lib/operation-history/access";
import { issueMcpShareDbAccessToken } from "@/lib/sharedb/mcp-token";
import { withShareDbRuntimeContext } from "@/lib/sharedb/runtime-context";
import {
  operationHistoryDocumentIdSchema,
  operationHistoryUndoRequestSchema,
} from "@/lib/operation-history/api-schemas";
import {
  canUndoOperation,
  getOperationHistoryById,
  previewUndo,
  undoLatestOperation,
  undoOperationById,
} from "@/lib/operation-history";
import { getShareDBDocument } from "@/lib/chat/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ documentId: string }>;
};

const buildShareDbWsHeaders = (request: Request): Record<string, string> => {
  const headers: Record<string, string> = {};
  const cookie = request.headers.get("cookie")?.trim();
  if (cookie) {
    headers.cookie = cookie;
  }
  const authorization = request.headers.get("authorization")?.trim();
  if (authorization) {
    headers.authorization = authorization;
  }
  return headers;
};

/**
 * POST /api/documents/[documentId]/undo
 *
 * Undo an operation for a document.
 *
 * Request body:
 * - operationId: UUID (optional - if not provided, undoes latest)
 * - preview: boolean (optional - if true, just preview without applying)
 * - confirm: boolean (required unless preview=true; must be true)
 * - reason: string (optional audit reason, max 500 chars)
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    // Check feature flag
    const flags = getFlags();
    if (!flags.enableRollbackApi) {
      return NextResponse.json(
        { error: "Rollback API is not enabled." },
        { status: 404 },
      );
    }

    // Auth check
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
    const auditAccess = await resolveAuditHistoryAccess({
      userId,
      email: session.user?.email,
      orgId,
    });
    if (!auditAccess.allowed) {
      return NextResponse.json(
        {
          error:
            "Audit history is available only on the Max plan or for admin users.",
        },
        { status: 403 },
      );
    }
    const userDisplayName =
      session.user?.name?.trim() || session.user?.email?.trim() || undefined;

    // Validate documentId
    const { documentId: rawDocumentId } = await context.params;
    const parsedDocumentId =
      operationHistoryDocumentIdSchema.safeParse(rawDocumentId);
    if (!parsedDocumentId.success) {
      const message =
        parsedDocumentId.error.issues[0]?.message ?? "Invalid request.";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const documentId = parsedDocumentId.data;
    if (!(await documentExists(documentId))) {
      return NextResponse.json(
        { error: "Document not found." },
        { status: 404 },
      );
    }

    // Check document access
    const access = await ensureDocumentAccess({
      docId: documentId,
      userId,
      orgId,
    });
    if (!access.canAccess) {
      return NextResponse.json(
        { error: "Document not found." },
        { status: 404 },
      );
    }
    if (access.permission !== "edit") {
      return NextResponse.json(
        {
          error:
            "You do not have permission to undo changes for this document.",
        },
        { status: 403 },
      );
    }

    // Parse request body
    const body = await request.json().catch(() => ({}));
    const parsedBody = operationHistoryUndoRequestSchema.safeParse(body);
    if (!parsedBody.success) {
      const message =
        parsedBody.error.issues[0]?.message ?? "Invalid request body.";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const {
      operationId,
      preview,
      confirm,
      reason: undoReason,
    } = parsedBody.data;

    // If caller targets a specific operation, ensure it belongs to this document.
    if (operationId) {
      const operation = await getOperationHistoryById(operationId);
      if (!operation || operation.docId !== documentId) {
        return NextResponse.json(
          { error: "Operation not found." },
          { status: 404 },
        );
      }
    }

    // Preview mode
    if (preview) {
      if (operationId) {
        const previewResult = await previewUndo(operationId);
        return NextResponse.json({
          preview: true,
          canUndo: previewResult.canUndo,
          reason: previewResult.reason,
          operation: previewResult.operation
            ? {
                id: previewResult.operation.id,
                actorType: previewResult.operation.actorType,
                actorId: previewResult.operation.actorId,
                activityType: previewResult.operation.activityType,
                createdAt: previewResult.operation.createdAt,
              }
            : null,
        });
      } else {
        // For latest operation preview, we'd need to fetch it first
        return NextResponse.json({
          preview: true,
          error: "Preview requires operationId",
        });
      }
    }

    if (confirm !== true) {
      return NextResponse.json(
        {
          error:
            "Explicit confirmation is required. Retry with confirm=true to proceed.",
        },
        { status: 400 },
      );
    }

    // Get ShareDB document
    const shareDbResult = await withShareDbRuntimeContext(
      {
        mcpTokenFactory: ({ docId, permission }) =>
          issueMcpShareDbAccessToken({ docId, permission }),
        wsHeaders: buildShareDbWsHeaders(request),
      },
      async () => getShareDBDocument(documentId),
    );
    if (!shareDbResult) {
      return NextResponse.json(
        { error: "Document not found." },
        { status: 404 },
      );
    }

    const { doc, close } = shareDbResult;

    try {
      // Perform undo
      const attribution = {
        source: "user" as const,
        actorType: "user",
        actorId: userId,
        userId,
      };

      let result;
      if (operationId) {
        // Check if operation can be undone
        const { canUndo, reason: canUndoReason } =
          await canUndoOperation(operationId);
        if (!canUndo) {
          return NextResponse.json(
            { error: canUndoReason ?? "Cannot undo this operation." },
            { status: 400 },
          );
        }

        result = await undoOperationById(doc, operationId, attribution, {
          confirmedByUser: true,
          reason: undoReason,
          confirmationMethod: "explicit_ui_confirmation",
          performedBy: userDisplayName,
        });
      } else {
        result = await undoLatestOperation(doc, attribution, {
          confirmedByUser: true,
          reason: undoReason,
          confirmationMethod: "explicit_ui_confirmation",
          performedBy: userDisplayName,
        });
      }

      if (!result.success) {
        return NextResponse.json(
          { error: result.error ?? "Undo failed." },
          { status: 400 },
        );
      }

      return NextResponse.json({
        success: true,
        operationId: result.operationId,
        rollbackOperationId: result.rollbackOperationId,
        versionFrom: result.versionFrom,
        versionTo: result.versionTo,
      });
    } finally {
      close();
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to undo operation.";
    console.error("[undo] Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/documents/[documentId]/undo?operationId=xxx
 *
 * Check if an operation can be undone.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    // Check feature flag
    const flags = getFlags();
    if (!flags.enableRollbackApi) {
      return NextResponse.json(
        { error: "Rollback API is not enabled." },
        { status: 404 },
      );
    }

    // Auth check
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
    const auditAccess = await resolveAuditHistoryAccess({
      userId,
      email: session.user?.email,
      orgId,
    });
    if (!auditAccess.allowed) {
      return NextResponse.json(
        {
          error:
            "Audit history is available only on the Max plan or for admin users.",
        },
        { status: 403 },
      );
    }

    // Validate documentId and access (edit permission required to query undo status)
    const { documentId: rawDocumentId } = await context.params;
    const parsedDocumentId =
      operationHistoryDocumentIdSchema.safeParse(rawDocumentId);
    if (!parsedDocumentId.success) {
      const message =
        parsedDocumentId.error.issues[0]?.message ?? "Invalid request.";
      return NextResponse.json({ error: message }, { status: 400 });
    }
    const documentId = parsedDocumentId.data;
    if (!(await documentExists(documentId))) {
      return NextResponse.json(
        { error: "Document not found." },
        { status: 404 },
      );
    }

    const access = await ensureDocumentAccess({
      docId: documentId,
      userId,
      orgId,
    });
    if (!access.canAccess) {
      return NextResponse.json(
        { error: "Document not found." },
        { status: 404 },
      );
    }
    if (access.permission !== "edit") {
      return NextResponse.json(
        {
          error:
            "You do not have permission to undo changes for this document.",
        },
        { status: 403 },
      );
    }

    // Get operationId from query
    const url = new URL(request.url);
    const operationId = url.searchParams.get("operationId");

    if (!operationId) {
      return NextResponse.json(
        { error: "operationId query parameter is required." },
        { status: 400 },
      );
    }

    const operation = await getOperationHistoryById(operationId);
    if (!operation || operation.docId !== documentId) {
      return NextResponse.json(
        { error: "Operation not found." },
        { status: 404 },
      );
    }

    const { canUndo, reason } = await canUndoOperation(operationId);

    return NextResponse.json({
      operationId,
      canUndo,
      reason,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to check undo status.";
    console.error("[undo] Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
