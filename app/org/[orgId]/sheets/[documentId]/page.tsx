import { cookies, headers } from "next/headers";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { getServerSessionSafe } from "@/lib/auth/session-safe";
import { isAdminUser } from "@/lib/auth/admin";
import {
  buildOrganizationSheetPath,
  getActiveOrganizationIdFromSession,
  listOrganizationsForSession,
} from "@/lib/auth/organization";
import { getOrganizationBillingEntitlement } from "@/lib/billing/repository";
import {
  documentExists,
  getPublicDocumentAccessByShareToken,
  isTemplateDocumentPubliclyViewable,
  ensureDocumentAccess,
  ensureDocumentMetadata,
} from "@/lib/documents/repository";
import { resolveLocaleAndCurrency } from "@/lib/locale-preference";
import { parseThemeCookie, THEME_COOKIE } from "@/lib/theme-preference";
import {
  ASSISTANT_COLLAPSED_COOKIE,
  DEFAULT_PANEL_LAYOUT,
  PANEL_LAYOUT_COOKIE,
  parseAssistantCollapsedCookie,
  parsePanelLayoutCookie,
} from "@/app/doc/panel-layout";
import { NewBodyClass } from "@/app/doc/body-class";
import { NewWorkspace } from "@/app/doc/workspace";
import { ActiveOrganizationSync } from "@/components/active-organization-sync";

type PageProps = {
  params: Promise<{ orgId: string; documentId: string }>;
  searchParams: Promise<{ share?: string | string[] }>;
};

const MOBILE_USER_AGENT_REGEX =
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;

const toShortDocumentId = (documentId: string): string =>
  documentId.slice(0, 8);

const resolveShareToken = (
  shareTokenValue: string | string[] | undefined,
): string | undefined =>
  Array.isArray(shareTokenValue) ? shareTokenValue[0] : shareTokenValue;

const getRequestCountryCode = (headerStore: Headers): string | null =>
  headerStore.get("x-vercel-ip-country") ??
  headerStore.get("cf-ipcountry") ??
  headerStore.get("x-country-code") ??
  headerStore.get("x-appengine-country");

const createPublicViewerIdentity = (documentId: string) => {
  const sessionId = crypto.randomUUID();
  const shortId = sessionId.slice(0, 6).toUpperCase();
  return {
    id: `public:${documentId}:${sessionId}`,
    name: `User ${shortId}`,
    email: null,
    image: null,
  };
};

export async function generateMetadata({
  params,
  searchParams,
}: Pick<PageProps, "params" | "searchParams">): Promise<Metadata> {
  const { orgId: rawOrgId, documentId } = await params;
  const orgId = rawOrgId.trim();
  const shortId = toShortDocumentId(documentId);
  const fallbackMetadata: Metadata = {
    title: `Sheet ${shortId}`,
    description: `Spreadsheet workspace for sheet ${shortId}.`,
  };

  if (!orgId) {
    return fallbackMetadata;
  }

  if (!(await documentExists(documentId))) {
    return fallbackMetadata;
  }

  const resolvedSearchParams = await searchParams;
  const shareToken = resolveShareToken(resolvedSearchParams.share);
  const session = await getServerSessionSafe();

  if (!session?.user) {
    const [publicAccess, isPublicTemplate] = await Promise.all([
      getPublicDocumentAccessByShareToken({
        docId: documentId,
        shareToken,
      }),
      isTemplateDocumentPubliclyViewable({
        docId: documentId,
      }),
    ]);

    if (!publicAccess.canAccess && !isPublicTemplate) {
      return fallbackMetadata;
    }

    const metadata = await ensureDocumentMetadata({ docId: documentId });
    return {
      title: metadata.title,
      description: `Spreadsheet workspace for ${metadata.title}.`,
    };
  }

  const organizations = await listOrganizationsForSession();
  const organization = organizations.find((item) => item.id === orgId) ?? null;
  if (!organization) {
    return fallbackMetadata;
  }

  const access = await ensureDocumentAccess({
    docId: documentId,
    userId: session.user.id,
    orgId: organization.id,
    shareToken,
  });

  if (!access.canAccess) {
    return fallbackMetadata;
  }

  const metadata = await ensureDocumentMetadata({ docId: documentId });

  return {
    title: metadata.title,
    description: `Spreadsheet workspace for ${metadata.title}.`,
  };
}

export default async function SheetPage({ params, searchParams }: PageProps) {
  const { orgId: rawOrgId, documentId } = await params;
  const orgId = rawOrgId.trim();
  if (!orgId) {
    notFound();
  }

  const resolvedSearchParams = await searchParams;
  const shareToken = resolveShareToken(resolvedSearchParams.share);

  const baseDocumentPath = buildOrganizationSheetPath({
    organizationId: orgId,
    documentId,
  });
  const callbackPath = shareToken
    ? `${baseDocumentPath}?share=${encodeURIComponent(shareToken)}`
    : baseDocumentPath;
  const sheetsBasePath = `/org/${encodeURIComponent(orgId)}/sheets`;

  const session = await getServerSessionSafe();

  if (!(await documentExists(documentId))) {
    notFound();
  }

  const cookieStore = await cookies();
  const headerStore = await headers();
  const defaultLayout =
    parsePanelLayoutCookie(cookieStore.get(PANEL_LAYOUT_COOKIE)?.value) ??
    DEFAULT_PANEL_LAYOUT;
  const initialThemeMode = parseThemeCookie(
    cookieStore.get(THEME_COOKIE)?.value,
  );
  const initialAssistantCollapsed = parseAssistantCollapsedCookie(
    cookieStore.get(ASSISTANT_COLLAPSED_COOKIE)?.value,
  );
  const secChUaMobile = headerStore.get("sec-ch-ua-mobile");
  const userAgent = headerStore.get("user-agent") ?? "";
  const { locale, currency } = resolveLocaleAndCurrency({
    acceptLanguage: headerStore.get("accept-language"),
    countryCode: getRequestCountryCode(headerStore),
  });
  const initialIsMobileLayout =
    secChUaMobile === "?1" ||
    (secChUaMobile === null && MOBILE_USER_AGENT_REGEX.test(userAgent));

  if (!session?.user) {
    const [publicAccess, isPublicTemplate] = await Promise.all([
      getPublicDocumentAccessByShareToken({
        docId: documentId,
        shareToken,
      }),
      isTemplateDocumentPubliclyViewable({
        docId: documentId,
      }),
    ]);

    if (!publicAccess.canAccess && !isPublicTemplate) {
      if (!shareToken?.trim()) {
        redirect(
          `/auth/sign-in?callbackURL=${encodeURIComponent(callbackPath)}`,
        );
      }
      notFound();
    }

    const documentMetadata = await ensureDocumentMetadata({
      docId: documentId,
    });

    return (
      <>
        <NewBodyClass />
        <NewWorkspace
          defaultLayout={defaultLayout}
          documentId={documentId}
          initialDocumentTitle={documentMetadata.title}
          sheetsBasePath={sheetsBasePath}
          canManageShare={false}
          canEdit={false}
          canUseAuditHistory={false}
          initialThemeMode={initialThemeMode}
          initialAssistantCollapsed={initialAssistantCollapsed}
          initialIsMobileLayout={initialIsMobileLayout}
          isTemplateDocument={isPublicTemplate}
          isReadOnlyTemplateView={isPublicTemplate}
          isAdmin={false}
          locale={locale}
          currency={currency}
          currentUser={createPublicViewerIdentity(documentId)}
        />
      </>
    );
  }

  const organizations = await listOrganizationsForSession();
  const organization = organizations.find((item) => item.id === orgId) ?? null;
  if (!organization) {
    notFound();
  }

  const access = await ensureDocumentAccess({
    docId: documentId,
    userId: session.user.id,
    orgId: organization.id,
    shareToken,
  });

  if (!access.canAccess) {
    notFound();
  }

  const isAdmin = isAdminUser({
    id: session.user.id,
    email: session.user.email,
  });
  const [documentMetadata, isTemplateDocument, billing] = await Promise.all([
    ensureDocumentMetadata({ docId: documentId }),
    isTemplateDocumentPubliclyViewable({
      docId: documentId,
    }),
    getOrganizationBillingEntitlement(organization.id),
  ]);
  const isReadOnlyTemplateView = isTemplateDocument && !access.isOwner;
  const canUseAuditHistory = isAdmin || billing.plan === "max";

  return (
    <>
      <NewBodyClass />
      <ActiveOrganizationSync
        organizationId={organization.id}
        sessionActiveOrganizationId={getActiveOrganizationIdFromSession(session)}
      />
      <NewWorkspace
        defaultLayout={defaultLayout}
        documentId={documentId}
        initialDocumentTitle={documentMetadata.title}
        sheetsBasePath={sheetsBasePath}
        canManageShare={access.isOwner}
        canEdit={access.permission === "edit" && !isReadOnlyTemplateView}
        initialThemeMode={initialThemeMode}
        initialAssistantCollapsed={initialAssistantCollapsed}
        initialIsMobileLayout={initialIsMobileLayout}
        isTemplateDocument={isTemplateDocument}
        isReadOnlyTemplateView={isReadOnlyTemplateView}
        isAdmin={isAdmin}
        canUseAuditHistory={canUseAuditHistory}
        locale={locale}
        currency={currency}
        currentUser={{
          id: session.user.id,
          name: session.user.name,
          email: session.user.email,
          image: session.user.image,
        }}
      />
    </>
  );
}
