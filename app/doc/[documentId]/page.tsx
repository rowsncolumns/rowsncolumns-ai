import type { Metadata } from "next";
import { redirect } from "next/navigation";

type PageProps = {
  params: Promise<{ documentId: string }>;
  searchParams: Promise<{ share?: string | string[] }>;
};

export const metadata: Metadata = {
  title: "Sheets",
  description: "Redirecting to sheets.",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function LegacyDocumentPage({
  params,
  searchParams,
}: PageProps) {
  const { documentId } = await params;
  const resolvedSearchParams = await searchParams;
  const shareTokenValue = resolvedSearchParams.share;
  const shareToken = Array.isArray(shareTokenValue)
    ? shareTokenValue[0]
    : shareTokenValue;

  if (shareToken?.trim()) {
    redirect(
      `/sheets/${documentId}?share=${encodeURIComponent(shareToken.trim())}`,
    );
  }

  redirect(`/sheets/${documentId}`);
}
