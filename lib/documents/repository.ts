import { db } from "@/lib/db/postgres";

type DocumentOwnerRow = {
  doc_id: string;
  user_id: string;
  created_at: Date | string;
  updated_at: Date | string;
};

export type DocumentOwnerRecord = {
  docId: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
};

export type EnsureDocumentOwnershipResult = {
  ownership: DocumentOwnerRecord;
  isOwner: boolean;
};

const mapRow = (row: DocumentOwnerRow): DocumentOwnerRecord => ({
  docId: row.doc_id,
  userId: row.user_id,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});

export async function ensureDocumentOwnership({
  docId,
  userId,
}: {
  docId: string;
  userId: string;
}): Promise<EnsureDocumentOwnershipResult> {
  await db`
    INSERT INTO document_owners (doc_id, user_id)
    VALUES (${docId}, ${userId})
    ON CONFLICT (doc_id) DO NOTHING
  `;

  const rows = await db<DocumentOwnerRow[]>`
    SELECT
      doc_id,
      user_id,
      created_at,
      updated_at
    FROM document_owners
    WHERE doc_id = ${docId}
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) {
    throw new Error("Failed to load document ownership.");
  }

  return {
    ownership: mapRow(row),
    isOwner: row.user_id === userId,
  };
}

export async function listOwnedDocumentIds(userId: string): Promise<string[]> {
  const rows = await db<{ doc_id: string }[]>`
    SELECT doc_id
    FROM document_owners
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
  `;

  return rows.map((row) => row.doc_id);
}
