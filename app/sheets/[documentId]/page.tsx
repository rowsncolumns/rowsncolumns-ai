import { cookies, headers } from "next/headers";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { getServerSessionSafe } from "@/lib/auth/session-safe";
import { isAdminUser } from "@/lib/auth/admin";
import {
  documentExists,
  ensureDocumentAccess,
  ensureDocumentMetadata,
} from "@/lib/documents/repository";
import { resolveLocaleAndCurrency } from "@/lib/locale-preference";
import { parseThemeCookie, THEME_COOKIE } from "@/lib/theme-preference";
import {
  DEFAULT_PANEL_LAYOUT,
  PANEL_LAYOUT_COOKIE,
  parsePanelLayoutCookie,
} from "@/app/doc/panel-layout";
import { NewBodyClass } from "@/app/doc/body-class";
import { NewWorkspace } from "@/app/doc/workspace";

type PageProps = {
  params: Promise<{ documentId: string }>;
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

export async function generateMetadata({
  params,
  searchParams,
}: PageProps): Promise<Metadata> {
  const { documentId } = await params;
  const resolvedSearchParams = await searchParams;
  const shareToken = resolveShareToken(resolvedSearchParams.share);
  const shortId = toShortDocumentId(documentId);
  const fallbackTitle = `Sheet ${shortId}`;
  const fallbackDescription = `Spreadsheet workspace for sheet ${shortId}.`;

  const session = await getServerSessionSafe();
  if (!session?.user) {
    return {
      title: fallbackTitle,
      description: fallbackDescription,
    };
  }

  if (!(await documentExists(documentId))) {
    return {
      title: fallbackTitle,
      description: fallbackDescription,
    };
  }

  const access = await ensureDocumentAccess({
    docId: documentId,
    userId: session.user.id,
    shareToken,
  });
  if (!access.canAccess) {
    return {
      title: fallbackTitle,
      description: fallbackDescription,
    };
  }

  const documentMetadata = await ensureDocumentMetadata({ docId: documentId });

  return {
    title: documentMetadata.title,
    description: `Spreadsheet workspace for ${documentMetadata.title}.`,
  };
}

export default async function SheetPage({ params, searchParams }: PageProps) {
  const { documentId } = await params;
  const resolvedSearchParams = await searchParams;
  const shareToken = resolveShareToken(resolvedSearchParams.share);

  const callbackPath = shareToken
    ? `/sheets/${documentId}?share=${encodeURIComponent(shareToken)}`
    : `/sheets/${documentId}`;

  const session = await getServerSessionSafe();
  if (!session?.user) {
    redirect(`/auth/sign-in?callbackURL=${encodeURIComponent(callbackPath)}`);
  }

  if (!(await documentExists(documentId))) {
    notFound();
  }

  const access = await ensureDocumentAccess({
    docId: documentId,
    userId: session.user.id,
    shareToken,
  });

  if (!access.canAccess) {
    notFound();
  }

  const documentMetadata = await ensureDocumentMetadata({ docId: documentId });

  const cookieStore = await cookies();
  const headerStore = await headers();
  const defaultLayout =
    parsePanelLayoutCookie(cookieStore.get(PANEL_LAYOUT_COOKIE)?.value) ??
    DEFAULT_PANEL_LAYOUT;
  const initialThemeMode = parseThemeCookie(
    cookieStore.get(THEME_COOKIE)?.value,
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
  const isAdmin = isAdminUser({
    id: session.user.id,
    email: session.user.email,
  });

  return (
    <>
      <NewBodyClass />
      <NewWorkspace
        defaultLayout={defaultLayout}
        documentId={documentId}
        initialDocumentTitle={documentMetadata.title}
        canManageShare={access.isOwner}
        canEdit={access.permission === "edit"}
        initialThemeMode={initialThemeMode}
        initialIsMobileLayout={initialIsMobileLayout}
        isAdmin={isAdmin}
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
