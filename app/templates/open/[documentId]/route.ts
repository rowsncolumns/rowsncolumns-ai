import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth/server";
import {
  buildOrganizationSheetPath,
  resolveActiveOrganizationIdForSession,
} from "@/lib/auth/organization";
import { getOrganizationRoleForUser } from "@/lib/auth/organization-membership";
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
  const requestUrl = new URL(request.url);
  const requestedOrgId =
    requestUrl.searchParams.get("orgId")?.trim() || null;
  const parsedDocumentId = documentIdSchema.safeParse(rawDocumentId);
  if (!parsedDocumentId.success) {
    return NextResponse.redirect(new URL("/templates", request.url));
  }

  const sourceDocId = parsedDocumentId.data;
  const { data: session } = await auth.getSession();
  const userId = session?.user?.id;

  if (!userId) {
    const signInUrl = new URL("/auth/sign-in", request.url);
    const callbackPath = requestedOrgId
      ? `/templates/open/${encodeURIComponent(sourceDocId)}?orgId=${encodeURIComponent(requestedOrgId)}`
      : `/templates/open/${encodeURIComponent(sourceDocId)}`;
    signInUrl.searchParams.set("callbackURL", callbackPath);
    return NextResponse.redirect(signInUrl);
  }

  let orgId: string | null = null;
  if (requestedOrgId) {
    const requestedRole = await getOrganizationRoleForUser({
      userId,
      organizationId: requestedOrgId,
    });
    if (requestedRole) {
      orgId = requestedOrgId;
    }
  }
  if (!orgId) {
    orgId = await resolveActiveOrganizationIdForSession(session);
  }

  if (!orgId) {
    const onboardingUrl = new URL("/onboarding/organization", request.url);
    const callbackPath = requestedOrgId
      ? `/templates/open/${encodeURIComponent(sourceDocId)}?orgId=${encodeURIComponent(requestedOrgId)}`
      : `/templates/open/${encodeURIComponent(sourceDocId)}`;
    onboardingUrl.searchParams.set("callbackURL", callbackPath);
    return NextResponse.redirect(onboardingUrl);
  }

  try {
    const duplicated = await duplicateTemplateDocument({
      sourceDocId,
      duplicatedDocId: createDocumentId(),
      userId,
      orgId,
    });

    if (!duplicated) {
      return NextResponse.redirect(new URL("/templates", request.url));
    }

    return NextResponse.redirect(
      new URL(
        buildOrganizationSheetPath({
          organizationId: orgId,
          documentId: duplicated.docId,
        }),
        request.url,
      ),
    );
  } catch {
    return NextResponse.redirect(new URL("/templates", request.url));
  }
}
