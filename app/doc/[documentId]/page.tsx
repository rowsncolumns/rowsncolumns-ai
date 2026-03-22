import { cookies } from "next/headers";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { auth } from "@/lib/auth/server";
import { ensureDocumentAccess } from "@/lib/documents/repository";
import { parseThemeCookie, THEME_COOKIE } from "@/lib/theme-preference";

import {
  DEFAULT_PANEL_LAYOUT,
  PANEL_LAYOUT_COOKIE,
  parsePanelLayoutCookie,
} from "../panel-layout";
import { NewWorkspace } from "../workspace";

type PageProps = {
  params: Promise<{ documentId: string }>;
  searchParams: Promise<{ share?: string | string[] }>;
};

const toShortDocumentId = (documentId: string): string =>
  documentId.slice(0, 8);

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { documentId } = await params;
  const shortId = toShortDocumentId(documentId);

  return {
    title: `Document ${shortId}`,
    description: `Spreadsheet workspace for document ${shortId}.`,
  };
}

export default async function DocumentPage({ params, searchParams }: PageProps) {
  const { documentId } = await params;
  const resolvedSearchParams = await searchParams;
  const shareTokenValue = resolvedSearchParams.share;
  const shareToken = Array.isArray(shareTokenValue)
    ? shareTokenValue[0]
    : shareTokenValue;

  const callbackPath = shareToken
    ? `/doc/${documentId}?share=${encodeURIComponent(shareToken)}`
    : `/doc/${documentId}`;

  const { data: session } = await auth.getSession();
  if (!session?.user) {
    redirect(`/auth/sign-in?callbackURL=${encodeURIComponent(callbackPath)}`);
  }

  const access = await ensureDocumentAccess({
    docId: documentId,
    userId: session.user.id,
    shareToken,
  });

  if (!access.canAccess) {
    notFound();
  }

  const cookieStore = await cookies();
  const defaultLayout =
    parsePanelLayoutCookie(cookieStore.get(PANEL_LAYOUT_COOKIE)?.value) ??
    DEFAULT_PANEL_LAYOUT;
  const initialThemeMode = parseThemeCookie(
    cookieStore.get(THEME_COOKIE)?.value,
  );

  return (
    <NewWorkspace
      defaultLayout={defaultLayout}
      documentId={documentId}
      canManageShare={access.isOwner}
      initialThemeMode={initialThemeMode}
      currentUser={{
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
      }}
    />
  );
}
