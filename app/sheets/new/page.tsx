import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { uuidString } from "@rowsncolumns/utils";

import { ensureDocumentMetadata, ensureDocumentOwnership } from "@/lib/documents/repository";
import { getServerSessionSafe } from "@/lib/auth/session-safe";

export const metadata: Metadata = {
  title: "Create Sheet",
  description: "Create a new spreadsheet sheet workspace.",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function NewSheetPage() {
  const session = await getServerSessionSafe();
  if (!session?.user) {
    redirect("/auth/sign-in?callbackURL=%2Fsheets%2Fnew");
  }

  const documentId = uuidString();
  await ensureDocumentOwnership({ docId: documentId, userId: session.user.id });
  await ensureDocumentMetadata({ docId: documentId });
  redirect(`/sheets/${documentId}`);
}
