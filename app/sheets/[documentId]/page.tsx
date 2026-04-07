import { notFound, redirect } from "next/navigation";

import {
  buildOrganizationSheetPath,
  listOrganizationsForSession,
  resolveActiveOrganizationIdForSession,
} from "@/lib/auth/organization";
import {
  documentExists,
  ensureDocumentAccess,
  getDocumentOwnerOrganizationId,
  getPublicDocumentAccessByShareToken,
  isTemplateDocumentPubliclyViewable,
} from "@/lib/documents/repository";
import { getServerSessionSafe } from "@/lib/auth/session-safe";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type RouteParams = Promise<{ documentId: string }>;

const buildQueryString = (
  params: Record<string, string | string[] | undefined>,
  options?: { includeShare?: boolean },
): string => {
  const query = new URLSearchParams();
  const includeShare = options?.includeShare === true;

  for (const [key, value] of Object.entries(params)) {
    if (key === "share" && !includeShare) {
      continue;
    }
    if (typeof value === "string") {
      const normalized = value.trim();
      if (normalized) {
        query.append(key, normalized);
      }
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const normalized = item?.trim();
        if (normalized) {
          query.append(key, normalized);
        }
      }
    }
  }

  const serialized = query.toString();
  return serialized ? `?${serialized}` : "";
};

export const dynamic = "force-dynamic";

export default async function LegacySheetRedirectPage({
  params,
  searchParams,
}: {
  params: RouteParams;
  searchParams: SearchParams;
}) {
  const { documentId } = await params;
  const safeDocumentId = documentId.trim();
  if (!safeDocumentId) {
    redirect("/sheets");
  }

  const parsedSearchParams = await searchParams;
  const redirectQueryString = buildQueryString(parsedSearchParams, {
    includeShare: true,
  });
  const shareTokenRaw = parsedSearchParams.share;
  const shareToken =
    typeof shareTokenRaw === "string"
      ? shareTokenRaw
      : Array.isArray(shareTokenRaw)
        ? shareTokenRaw[0]
        : undefined;
  const callbackPath = safeDocumentId
    ? `/sheets/${encodeURIComponent(safeDocumentId)}${redirectQueryString}`
    : "/sheets";

  if (!(await documentExists(safeDocumentId))) {
    notFound();
  }

  const session = await getServerSessionSafe();
  if (!session?.user) {
    const [publicAccess, isPublicTemplate, documentOrgId] = await Promise.all([
      getPublicDocumentAccessByShareToken({
        docId: safeDocumentId,
        shareToken,
      }),
      isTemplateDocumentPubliclyViewable({
        docId: safeDocumentId,
      }),
      getDocumentOwnerOrganizationId(safeDocumentId),
    ]);

    if ((publicAccess.canAccess || isPublicTemplate) && documentOrgId) {
      redirect(
        `${buildOrganizationSheetPath({
          organizationId: documentOrgId,
          documentId: safeDocumentId,
        })}${redirectQueryString}`,
      );
    }

    redirect(`/auth/sign-in?callbackURL=${encodeURIComponent(callbackPath)}`);
  }

  const organizations = await listOrganizationsForSession();
  if (organizations.length === 0) {
    redirect(
      `/onboarding/organization?callbackURL=${encodeURIComponent(callbackPath)}`,
    );
  }

  const activeOrganizationId =
    await resolveActiveOrganizationIdForSession(session);
  const availableOrganizationIds = new Set(
    organizations.map((organization) => organization.id),
  );
  const orderedOrganizationIds: string[] = [];
  const preferredOrganizationId =
    activeOrganizationId && availableOrganizationIds.has(activeOrganizationId)
      ? activeOrganizationId
      : null;
  if (preferredOrganizationId) {
    orderedOrganizationIds.push(preferredOrganizationId);
  }
  for (const organization of organizations) {
    if (organization.id === preferredOrganizationId) {
      continue;
    }
    orderedOrganizationIds.push(organization.id);
  }

  for (const organizationId of orderedOrganizationIds) {
    const access = await ensureDocumentAccess({
      docId: safeDocumentId,
      userId: session.user.id,
      orgId: organizationId,
      shareToken,
    });
    if (!access.canAccess) {
      continue;
    }

    redirect(
      `${buildOrganizationSheetPath({
        organizationId,
        documentId: safeDocumentId,
      })}${redirectQueryString}`,
    );
  }

  notFound();
}
