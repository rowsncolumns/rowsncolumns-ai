import { db } from "@/lib/db/postgres";

type DocumentOwnerRow = {
  doc_id: string;
  user_id: string;
  created_at: Date | string;
  updated_at: Date | string;
};

type DocumentShareLinkRow = {
  doc_id: string;
  share_token: string;
  is_active: boolean;
  created_by_user_id: string;
  created_at: Date | string;
  updated_at: Date | string;
};

export type DocumentOwnerRecord = {
  docId: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
};

export type DocumentShareLinkRecord = {
  docId: string;
  shareToken: string;
  isActive: boolean;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
};

export type EnsureDocumentOwnershipResult = {
  ownership: DocumentOwnerRecord;
  isOwner: boolean;
};

export type EnsureDocumentAccessResult = EnsureDocumentOwnershipResult & {
  canAccess: boolean;
  accessSource: "owner" | "share" | "none";
};

const mapRow = (row: DocumentOwnerRow): DocumentOwnerRecord => ({
  docId: row.doc_id,
  userId: row.user_id,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});

const mapShareLinkRow = (row: DocumentShareLinkRow): DocumentShareLinkRecord => ({
  docId: row.doc_id,
  shareToken: row.share_token,
  isActive: row.is_active,
  createdByUserId: row.created_by_user_id,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});

const normalizeShareToken = (shareToken?: string | null) => {
  const normalized = shareToken?.trim();
  return normalized ? normalized : null;
};

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

export async function ensureDocumentAccess({
  docId,
  userId,
  shareToken,
}: {
  docId: string;
  userId: string;
  shareToken?: string | null;
}): Promise<EnsureDocumentAccessResult> {
  const ownershipResult = await ensureDocumentOwnership({ docId, userId });
  if (ownershipResult.isOwner) {
    return {
      ...ownershipResult,
      canAccess: true,
      accessSource: "owner",
    };
  }

  const normalizedToken = normalizeShareToken(shareToken);
  if (!normalizedToken) {
    return {
      ...ownershipResult,
      canAccess: false,
      accessSource: "none",
    };
  }

  const sharedRows = await db<{ doc_id: string }[]>`
    SELECT doc_id
    FROM document_share_links
    WHERE doc_id = ${docId}
      AND is_active = TRUE
      AND share_token = ${normalizedToken}
    LIMIT 1
  `;

  const hasShareAccess = sharedRows.length > 0;

  return {
    ...ownershipResult,
    canAccess: hasShareAccess,
    accessSource: hasShareAccess ? "share" : "none",
  };
}

export async function getOrCreateDocumentShareLink({
  docId,
  userId,
}: {
  docId: string;
  userId: string;
}): Promise<DocumentShareLinkRecord | null> {
  const ownershipResult = await ensureDocumentOwnership({ docId, userId });
  if (!ownershipResult.isOwner) {
    return null;
  }

  const existingRows = await db<DocumentShareLinkRow[]>`
    SELECT
      doc_id,
      share_token,
      is_active,
      created_by_user_id,
      created_at,
      updated_at
    FROM document_share_links
    WHERE doc_id = ${docId}
      AND is_active = TRUE
    LIMIT 1
  `;

  const existingRow = existingRows[0];
  if (existingRow) {
    return mapShareLinkRow(existingRow);
  }

  const nextShareToken = crypto.randomUUID();
  const upsertedRows = await db<DocumentShareLinkRow[]>`
    INSERT INTO document_share_links (
      doc_id,
      share_token,
      is_active,
      created_by_user_id
    )
    VALUES (
      ${docId},
      ${nextShareToken},
      TRUE,
      ${userId}
    )
    ON CONFLICT (doc_id) DO UPDATE
      SET
        share_token = EXCLUDED.share_token,
        is_active = TRUE,
        created_by_user_id = EXCLUDED.created_by_user_id,
        updated_at = NOW()
    RETURNING
      doc_id,
      share_token,
      is_active,
      created_by_user_id,
      created_at,
      updated_at
  `;

  const row = upsertedRows[0];
  if (!row) {
    throw new Error("Failed to create a document share link.");
  }

  return mapShareLinkRow(row);
}
