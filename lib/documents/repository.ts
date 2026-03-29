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

type DocumentMetadataRow = {
  doc_id: string;
  title: string;
  created_at: Date | string;
  updated_at: Date | string;
};

type OwnedDocumentRow = {
  doc_id: string;
  ownership_created_at: Date | string;
  metadata_title: string | null;
  last_modified_at: Date | string;
  is_shared: boolean;
  access_type: "owned" | "shared";
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

export type DocumentMetadataRecord = {
  docId: string;
  title: string;
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

export type OwnedDocumentRecord = {
  docId: string;
  title: string;
  createdAt: string;
  lastModifiedAt: string;
  isShared: boolean;
  accessType: "owned" | "shared";
};

export type ListOwnedDocumentsResult = {
  items: OwnedDocumentRecord[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  filter: DocumentListFilter;
};

export type DocumentListFilter = "owned" | "shared" | "my_shared";

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

const mapMetadataRow = (row: DocumentMetadataRow): DocumentMetadataRecord => ({
  docId: row.doc_id,
  title: row.title,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});

const normalizeShareToken = (shareToken?: string | null) => {
  const normalized = shareToken?.trim();
  return normalized ? normalized : null;
};

const SHAREDB_COLLECTION =
  process.env.SHAREDB_COLLECTION?.trim() || "spreadsheets";

const DEFAULT_TITLE_PREFIX = "Document";
const MAX_TITLE_LENGTH = 160;

export const getDefaultDocumentTitle = (docId: string): string => {
  const shortId = docId.slice(0, 8);
  return `${DEFAULT_TITLE_PREFIX} ${shortId}`;
};

const normalizeDocumentTitle = (docId: string, title: string): string => {
  const normalized = title.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return getDefaultDocumentTitle(docId);
  }
  return normalized.slice(0, MAX_TITLE_LENGTH);
};

const isMissingRelationError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code?: unknown }).code === "42P01";

const createFallbackMetadata = (
  docId: string,
  title = getDefaultDocumentTitle(docId),
): DocumentMetadataRecord => {
  const now = new Date().toISOString();
  return {
    docId,
    title,
    createdAt: now,
    updatedAt: now,
  };
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

const normalizePaginationValue = (
  value: number,
  { min, max }: { min: number; max: number },
) => {
  if (!Number.isFinite(value)) {
    return min;
  }

  const floored = Math.floor(value);
  if (floored < min) {
    return min;
  }
  if (floored > max) {
    return max;
  }
  return floored;
};

const toIsoTimestamp = (value: Date | string) => new Date(value).toISOString();

const mapOwnedDocumentRow = (row: OwnedDocumentRow): OwnedDocumentRecord => {
  const createdAt = toIsoTimestamp(row.ownership_created_at);
  const lastModifiedAt = toIsoTimestamp(row.last_modified_at);
  const title = row.metadata_title?.trim() || getDefaultDocumentTitle(row.doc_id);

  return {
    docId: row.doc_id,
    title,
    createdAt,
    lastModifiedAt,
    isShared: row.is_shared,
    accessType: row.access_type,
  };
};

const normalizeListFilter = (
  filter: DocumentListFilter | string | undefined,
): DocumentListFilter => {
  if (filter === "owned" || filter === "shared" || filter === "my_shared") {
    return filter;
  }
  return "owned";
};

export async function listOwnedDocuments({
  userId,
  page = 1,
  pageSize = 20,
  filter = "owned",
  query,
}: {
  userId: string;
  page?: number;
  pageSize?: number;
  filter?: DocumentListFilter;
  query?: string | null;
}): Promise<ListOwnedDocumentsResult> {
  const safePageSize = normalizePaginationValue(pageSize, { min: 1, max: 100 });
  const safePage = normalizePaginationValue(page, { min: 1, max: 100000 });
  const normalizedFilter = normalizeListFilter(filter);
  const normalizedQuery = query?.trim().replace(/\s+/g, " ") || null;
  const titleSearchPattern = normalizedQuery ? `%${normalizedQuery}%` : null;

  const totalRows = await db<{ count: string }[]>`
    WITH user_documents AS (
      SELECT
        owners.doc_id,
        owners.created_at AS ownership_created_at,
        metadata.title AS metadata_title,
        COALESCE(shares.is_active, FALSE) AS is_shared,
        (
          SELECT MAX(candidate_ts)
          FROM (
            VALUES
              (
                CASE
                  WHEN snapshots.metadata ? 'mtime'
                    AND jsonb_typeof(snapshots.metadata->'mtime') = 'number'
                  THEN to_timestamp((snapshots.metadata->>'mtime')::double precision / 1000.0)
                  ELSE NULL
                END
              ),
              (metadata.updated_at::timestamptz),
              (owners.updated_at::timestamptz),
              (owners.created_at::timestamptz)
          ) AS ts(candidate_ts)
        ) AS last_modified_at,
        'owned'::text AS access_type
      FROM document_owners AS owners
      LEFT JOIN document_metadata AS metadata
        ON metadata.doc_id = owners.doc_id
      LEFT JOIN document_share_links AS shares
        ON shares.doc_id = owners.doc_id
        AND shares.is_active = TRUE
      LEFT JOIN snapshots
        ON snapshots.collection = ${SHAREDB_COLLECTION}
        AND snapshots.doc_id = owners.doc_id
      WHERE owners.user_id = ${userId}

      UNION ALL

      SELECT
        grants.doc_id,
        owners.created_at AS ownership_created_at,
        metadata.title AS metadata_title,
        TRUE AS is_shared,
        (
          SELECT MAX(candidate_ts)
          FROM (
            VALUES
              (
                CASE
                  WHEN snapshots.metadata ? 'mtime'
                    AND jsonb_typeof(snapshots.metadata->'mtime') = 'number'
                  THEN to_timestamp((snapshots.metadata->>'mtime')::double precision / 1000.0)
                  ELSE NULL
                END
              ),
              (metadata.updated_at::timestamptz),
              (owners.updated_at::timestamptz),
              (owners.created_at::timestamptz)
          ) AS ts(candidate_ts)
        ) AS last_modified_at,
        'shared'::text AS access_type
      FROM document_access_grants AS grants
      INNER JOIN document_owners AS owners
        ON owners.doc_id = grants.doc_id
      LEFT JOIN document_metadata AS metadata
        ON metadata.doc_id = grants.doc_id
      LEFT JOIN snapshots
        ON snapshots.collection = ${SHAREDB_COLLECTION}
        AND snapshots.doc_id = grants.doc_id
      WHERE grants.user_id = ${userId}
        AND owners.user_id <> ${userId}
    )
    SELECT COUNT(*)::text AS count
    FROM user_documents
    WHERE (
      (${normalizedFilter} = 'owned' AND access_type = 'owned')
      OR (${normalizedFilter} = 'shared' AND access_type = 'shared')
      OR (
        ${normalizedFilter} = 'my_shared'
        AND access_type = 'owned'
        AND is_shared = TRUE
      )
    )
      AND (
        ${titleSearchPattern}::text IS NULL
        OR COALESCE(NULLIF(BTRIM(metadata_title), ''), 'Document ' || LEFT(doc_id, 8)) ILIKE ${titleSearchPattern}::text
      )
  `;
  const totalCount = Number.parseInt(totalRows[0]?.count ?? "0", 10) || 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / safePageSize));
  const effectivePage = Math.min(safePage, totalPages);
  const effectiveOffset = (effectivePage - 1) * safePageSize;

  const rows = await db<OwnedDocumentRow[]>`
    WITH owned_documents AS (
      SELECT
        owners.doc_id,
        owners.created_at AS ownership_created_at,
        metadata.title AS metadata_title,
        COALESCE(shares.is_active, FALSE) AS is_shared,
        (
          SELECT MAX(candidate_ts)
          FROM (
            VALUES
              (
                CASE
                  WHEN snapshots.metadata ? 'mtime'
                    AND jsonb_typeof(snapshots.metadata->'mtime') = 'number'
                  THEN to_timestamp((snapshots.metadata->>'mtime')::double precision / 1000.0)
                  ELSE NULL
                END
              ),
              (metadata.updated_at::timestamptz),
              (owners.updated_at::timestamptz),
              (owners.created_at::timestamptz)
          ) AS ts(candidate_ts)
        ) AS last_modified_at,
        'owned'::text AS access_type
      FROM document_owners AS owners
      LEFT JOIN document_metadata AS metadata
        ON metadata.doc_id = owners.doc_id
      LEFT JOIN document_share_links AS shares
        ON shares.doc_id = owners.doc_id
        AND shares.is_active = TRUE
      LEFT JOIN snapshots
        ON snapshots.collection = ${SHAREDB_COLLECTION}
        AND snapshots.doc_id = owners.doc_id
      WHERE owners.user_id = ${userId}

      UNION ALL

      SELECT
        grants.doc_id,
        owners.created_at AS ownership_created_at,
        metadata.title AS metadata_title,
        TRUE AS is_shared,
        (
          SELECT MAX(candidate_ts)
          FROM (
            VALUES
              (
                CASE
                  WHEN snapshots.metadata ? 'mtime'
                    AND jsonb_typeof(snapshots.metadata->'mtime') = 'number'
                  THEN to_timestamp((snapshots.metadata->>'mtime')::double precision / 1000.0)
                  ELSE NULL
                END
              ),
              (metadata.updated_at::timestamptz),
              (owners.updated_at::timestamptz),
              (owners.created_at::timestamptz)
          ) AS ts(candidate_ts)
        ) AS last_modified_at,
        'shared'::text AS access_type
      FROM document_access_grants AS grants
      INNER JOIN document_owners AS owners
        ON owners.doc_id = grants.doc_id
      LEFT JOIN document_metadata AS metadata
        ON metadata.doc_id = grants.doc_id
      LEFT JOIN snapshots
        ON snapshots.collection = ${SHAREDB_COLLECTION}
        AND snapshots.doc_id = grants.doc_id
      WHERE grants.user_id = ${userId}
        AND owners.user_id <> ${userId}
    )
    SELECT
      doc_id,
      ownership_created_at,
      metadata_title,
      last_modified_at,
      is_shared,
      access_type
    FROM owned_documents
    WHERE (
      (${normalizedFilter} = 'owned' AND access_type = 'owned')
      OR (${normalizedFilter} = 'shared' AND access_type = 'shared')
      OR (
        ${normalizedFilter} = 'my_shared'
        AND access_type = 'owned'
        AND is_shared = TRUE
      )
    )
      AND (
        ${titleSearchPattern}::text IS NULL
        OR COALESCE(NULLIF(BTRIM(metadata_title), ''), 'Document ' || LEFT(doc_id, 8)) ILIKE ${titleSearchPattern}::text
      )
    ORDER BY last_modified_at DESC, ownership_created_at DESC
    LIMIT ${safePageSize}
    OFFSET ${effectiveOffset}
  `;

  return {
    items: rows.map(mapOwnedDocumentRow),
    totalCount,
    page: effectivePage,
    pageSize: safePageSize,
    totalPages,
    filter: normalizedFilter,
  };
}

export async function ensureDocumentMetadata({
  docId,
}: {
  docId: string;
}): Promise<DocumentMetadataRecord> {
  const defaultTitle = getDefaultDocumentTitle(docId);

  try {
    await db`
      INSERT INTO document_metadata (doc_id, title)
      VALUES (${docId}, ${defaultTitle})
      ON CONFLICT (doc_id) DO NOTHING
    `;

    const rows = await db<DocumentMetadataRow[]>`
      SELECT
        doc_id,
        title,
        created_at,
        updated_at
      FROM document_metadata
      WHERE doc_id = ${docId}
      LIMIT 1
    `;

    const row = rows[0];
    if (!row) {
      return createFallbackMetadata(docId, defaultTitle);
    }

    return mapMetadataRow(row);
  } catch (error) {
    if (isMissingRelationError(error)) {
      return createFallbackMetadata(docId, defaultTitle);
    }
    throw error;
  }
}

export async function updateDocumentTitle({
  docId,
  userId,
  title,
}: {
  docId: string;
  userId: string;
  title: string;
}): Promise<DocumentMetadataRecord | null> {
  const ownershipResult = await ensureDocumentOwnership({ docId, userId });
  if (!ownershipResult.isOwner) {
    return null;
  }

  const normalizedTitle = normalizeDocumentTitle(docId, title);

  try {
    const rows = await db<DocumentMetadataRow[]>`
      INSERT INTO document_metadata (doc_id, title)
      VALUES (${docId}, ${normalizedTitle})
      ON CONFLICT (doc_id) DO UPDATE
        SET
          title = EXCLUDED.title,
          updated_at = NOW()
      RETURNING
        doc_id,
        title,
        created_at,
        updated_at
    `;

    const row = rows[0];
    if (!row) {
      throw new Error("Failed to update document title.");
    }

    return mapMetadataRow(row);
  } catch (error) {
    if (isMissingRelationError(error)) {
      throw new Error(
        "Document title storage is not initialized. Run the document metadata migration.",
      );
    }
    throw error;
  }
}

export async function deleteOwnedDocument({
  docId,
  userId,
}: {
  docId: string;
  userId: string;
}): Promise<boolean> {
  return db.begin(async (tx) => {
    const deletedOwnerRows = await tx.unsafe<{ doc_id: string }[]>(
      `
        DELETE FROM document_owners
        WHERE doc_id = $1
          AND user_id = $2
        RETURNING doc_id
      `,
      [docId, userId],
    );

    if (deletedOwnerRows.length === 0) {
      return false;
    }

    try {
      await tx.unsafe(
        `
          DELETE FROM snapshots
          WHERE collection = $1
            AND doc_id = $2
        `,
        [SHAREDB_COLLECTION, docId],
      );
    } catch (error) {
      if (!isMissingRelationError(error)) {
        throw error;
      }
    }

    try {
      await tx.unsafe(
        `
          DELETE FROM ops
          WHERE collection = $1
            AND doc_id = $2
        `,
        [SHAREDB_COLLECTION, docId],
      );
    } catch (error) {
      if (!isMissingRelationError(error)) {
        throw error;
      }
    }

    return true;
  });
}

const hasDocumentAccessGrant = async ({
  docId,
  userId,
}: {
  docId: string;
  userId: string;
}): Promise<boolean> => {
  try {
    const rows = await db<{ doc_id: string }[]>`
      SELECT doc_id
      FROM document_access_grants
      WHERE doc_id = ${docId}
        AND user_id = ${userId}
      LIMIT 1
    `;
    return rows.length > 0;
  } catch (error) {
    if (isMissingRelationError(error)) {
      return false;
    }
    throw error;
  }
};

const upsertDocumentAccessGrant = async ({
  docId,
  userId,
}: {
  docId: string;
  userId: string;
}): Promise<void> => {
  try {
    await db`
      INSERT INTO document_access_grants (doc_id, user_id, granted_via)
      VALUES (${docId}, ${userId}, 'share')
      ON CONFLICT (doc_id, user_id) DO UPDATE
        SET
          granted_via = EXCLUDED.granted_via,
          updated_at = NOW()
    `;
  } catch (error) {
    if (isMissingRelationError(error)) {
      return;
    }
    throw error;
  }
};

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

  const hasPersistedAccess = await hasDocumentAccessGrant({ docId, userId });
  if (hasPersistedAccess) {
    return {
      ...ownershipResult,
      canAccess: true,
      accessSource: "share",
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
  if (hasShareAccess) {
    await upsertDocumentAccessGrant({ docId, userId });
  }

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
