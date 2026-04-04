import { NextResponse } from "next/server";

import { auth } from "@/lib/auth/server";
import { createDocumentId } from "@/lib/documents/create-document-id";
import {
  ensureDocumentMetadata,
  ensureDocumentOwnership,
  listOwnedDocuments,
  type DocumentListFilter,
} from "@/lib/documents/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const parseLimit = (value: string | null) => {
  if (!value) {
    return 24;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return 24;
  }
  return Math.max(1, Math.min(50, parsed));
};

const parseFilter = (value: string | null): DocumentListFilter => {
  if (value === "owned" || value === "shared" || value === "my_shared") {
    return value;
  }
  return "owned";
};

export async function GET(request: Request) {
  try {
    const { data: session } = await auth.getSession();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const url = new URL(request.url);
    const pageSize = parseLimit(url.searchParams.get("limit"));
    const filter = parseFilter(url.searchParams.get("filter"));
    const query = url.searchParams.get("q");
    const results = await listOwnedDocuments({
      userId,
      page: 1,
      pageSize,
      filter,
      query,
    });

    return NextResponse.json({
      items: results.items.map((item) => ({
        docId: item.docId,
        title: item.title,
        accessType: item.accessType,
      })),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch documents.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

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
