import { cookies, headers } from "next/headers";
import type { Metadata } from "next";

import { SpreadsheetOnlyWorkspace } from "@/app/doc/workspace";
import { resolveLocaleAndCurrency } from "@/lib/locale-preference";
import { parseThemeCookie, THEME_COOKIE } from "@/lib/theme-preference";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ documentId: string }>;
};

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

  const initialThemeMode = parseThemeCookie(
    cookieStore.get(THEME_COOKIE)?.value,
  );

  const { locale, currency } = resolveLocaleAndCurrency({
    acceptLanguage: headerStore.get("accept-language"),
    countryCode: getRequestCountryCode(headerStore),
  });

  return (
    <SpreadsheetOnlyWorkspace
      documentId={documentId}
      canManageShare={false}
      initialThemeMode={initialThemeMode}
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
