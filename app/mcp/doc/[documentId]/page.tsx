import { cookies, headers } from "next/headers";
import type { Metadata } from "next";

import { NewWorkspace } from "@/app/doc/workspace";
import {
  DEFAULT_PANEL_LAYOUT,
  PANEL_LAYOUT_COOKIE,
  parsePanelLayoutCookie,
} from "@/app/doc/panel-layout";
import { resolveLocaleAndCurrency } from "@/lib/locale-preference";
import { parseThemeCookie, THEME_COOKIE } from "@/lib/theme-preference";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ documentId: string }>;
};

const MOBILE_USER_AGENT_REGEX =
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;

const toShortDocumentId = (documentId: string): string =>
  documentId.slice(0, 8);

const getRequestCountryCode = (headerStore: Headers): string | null =>
  headerStore.get("x-vercel-ip-country") ??
  headerStore.get("cf-ipcountry") ??
  headerStore.get("x-country-code") ??
  headerStore.get("x-appengine-country");

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { documentId } = await params;
  const shortId = toShortDocumentId(documentId);

  return {
    title: `MCP Document ${shortId}`,
    description: `Public MCP spreadsheet workspace for document ${shortId}.`,
    robots: {
      index: false,
      follow: false,
    },
  };
}

export default async function McpPublicDocumentPage({ params }: PageProps) {
  const { documentId } = await params;

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
  const initialIsMobileLayout =
    secChUaMobile === "?1" ||
    (secChUaMobile === null && MOBILE_USER_AGENT_REGEX.test(userAgent));

  const { locale, currency } = resolveLocaleAndCurrency({
    acceptLanguage: headerStore.get("accept-language"),
    countryCode: getRequestCountryCode(headerStore),
  });

  return (
    <NewWorkspace
      defaultLayout={defaultLayout}
      documentId={documentId}
      canManageShare={false}
      initialThemeMode={initialThemeMode}
      initialIsMobileLayout={initialIsMobileLayout}
      isAdmin={false}
      locale={locale}
      currency={currency}
      currentUser={{
        id: `mcp-${crypto.randomUUID()}`,
        name: "MCP User",
        email: null,
      }}
    />
  );
}
