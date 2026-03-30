import { NextResponse } from "next/server";

import { auth } from "@/lib/auth/server";
import { createDocumentId } from "@/lib/documents/create-document-id";
import {
  ensureDocumentMetadata,
  ensureDocumentOwnership,
} from "@/lib/documents/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const { data: session } = await auth.getSession();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const documentId = createDocumentId();

    // Ownership must be created first (metadata has FK to owners)
    await ensureDocumentOwnership({ docId: documentId, userId });
    await ensureDocumentMetadata({ docId: documentId });

    return NextResponse.json({ documentId });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create document.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
