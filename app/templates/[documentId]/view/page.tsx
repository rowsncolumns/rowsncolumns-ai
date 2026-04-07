import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { NewBodyClass } from "@/app/doc/body-class";
import {
  ASSISTANT_COLLAPSED_COOKIE,
  DEFAULT_PANEL_LAYOUT,
  PANEL_LAYOUT_COOKIE,
  parseAssistantCollapsedCookie,
  parsePanelLayoutCookie,
} from "@/app/doc/panel-layout";
import { NewWorkspace } from "@/app/doc/workspace";
import { getServerSessionSafe } from "@/lib/auth/session-safe";
import { resolveActiveOrganizationIdForSession } from "@/lib/auth/organization";
import {
  ensureDocumentMetadata,
  getTemplateDocumentById,
} from "@/lib/documents/repository";
import { resolveLocaleAndCurrency } from "@/lib/locale-preference";
import { parseThemeCookie, THEME_COOKIE } from "@/lib/theme-preference";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type RouteParams = Promise<{ documentId: string }>;

const MOBILE_USER_AGENT_REGEX =
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;

const parseSingleValue = (
  value: string | string[] | undefined,
): string | null => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
};

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

export const dynamic = "force-dynamic";

export default async function TemplateWorkbookViewPage({
  params,
  searchParams,
}: {
  params: RouteParams;
  searchParams: SearchParams;
}) {
  const { documentId: rawDocumentId } = await params;
  const documentId = rawDocumentId.trim();
  if (!documentId) {
    notFound();
  }

  const queryParams = await searchParams;
  const requestedOrgId = parseSingleValue(queryParams.orgId)?.trim();
  if (requestedOrgId) {
    redirect(`/templates/${encodeURIComponent(documentId)}/view`);
  }

  const session = await getServerSessionSafe();
  const activeOrganizationId = session?.user
    ? await resolveActiveOrganizationIdForSession(session)
    : null;
  const template = await getTemplateDocumentById({
    docId: documentId,
    orgId: activeOrganizationId,
  });
  if (!template) {
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
        sheetsBasePath="/templates"
        breadcrumbHref={`/templates/${encodeURIComponent(documentId)}`}
        breadcrumbLabel="Template details"
        canManageShare={false}
        canEdit={false}
        canUseAuditHistory={false}
        initialThemeMode={initialThemeMode}
        initialAssistantCollapsed={initialAssistantCollapsed}
        initialIsMobileLayout={initialIsMobileLayout}
        isTemplateDocument
        isReadOnlyTemplateView
        isAdmin={false}
        locale={locale}
        currency={currency}
        currentUser={
          session?.user
            ? {
                id: session.user.id,
                name: session.user.name,
                email: session.user.email,
                image: session.user.image,
              }
            : createPublicViewerIdentity(documentId)
        }
      />
    </>
  );
}
