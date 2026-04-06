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
  is_public?: boolean | null;
  permission?: string | null;
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
  is_template: boolean;
  access_type: "owned" | "shared";
  is_favorite: boolean;
};

type SourceDocumentForDuplicateRow = {
  doc_id: string;
  source_title: string | null;
};

type DocumentTemplateMetadataRow = {
  doc_id: string;
  title: string;
  template_title: string | null;
  template_tagline: string | null;
  is_template: boolean | null;
  template_category: string | null;
  template_description_markdown: string | null;
  template_tags: string[] | null;
  template_preview_image_url: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type TemplateCatalogRow = {
  doc_id: string;
  title: string | null;
  template_title: string | null;
  template_tagline: string | null;
  template_category: string | null;
  template_description_markdown: string | null;
  template_tags: string[] | null;
  template_preview_image_url: string | null;
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
  isPublic: boolean;
  permission: DocumentSharePermission;
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

export type DocumentTemplateMetadataRecord = {
  docId: string;
  title: string;
  templateTitle: string;
  tagline: string;
  isTemplate: boolean;
  category: string;
  descriptionMarkdown: string;
  tags: string[];
  previewImageUrl: string;
  createdAt: string;
  updatedAt: string;
};

export type TemplateCatalogItem = {
  docId: string;
  title: string;
  templateTitle: string;
  tagline: string;
  category: string;
  descriptionMarkdown: string;
  tags: string[];
  previewImageUrl: string;
  updatedAt: string;
};

export type UpdateDocumentTemplateInput = {
  docId: string;
  isTemplate: boolean;
  templateTitle?: string | null;
  tagline?: string | null;
  category?: string | null;
  descriptionMarkdown?: string | null;
  tags?: string[];
  previewImageUrl?: string | null;
};

export type EnsureDocumentOwnershipResult = {
  ownership: DocumentOwnerRecord;
  isOwner: boolean;
};

export type EnsureDocumentAccessResult = EnsureDocumentOwnershipResult & {
  canAccess: boolean;
  accessSource: "owner" | "share" | "template" | "none";
  permission: DocumentSharePermission;
};

export type DocumentSharePermission = "view" | "edit";

export type OwnedDocumentRecord = {
  docId: string;
  title: string;
  createdAt: string;
  lastModifiedAt: string;
  isShared: boolean;
  isTemplate: boolean;
  accessType: "owned" | "shared";
  isFavorite: boolean;
};

export type ListOwnedDocumentsResult = {
  items: OwnedDocumentRecord[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  filter: DocumentListFilter;
};

export type DocumentListFilter = "owned" | "shared" | "my_shared" | "templates";

export type DuplicateDocumentResult = {
  docId: string;
  title: string;
  snapshotCopied: boolean;
};

const mapRow = (row: DocumentOwnerRow): DocumentOwnerRecord => ({
  docId: row.doc_id,
  userId: row.user_id,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});

const mapShareLinkRow = (
  row: DocumentShareLinkRow,
): DocumentShareLinkRecord => ({
  docId: row.doc_id,
  shareToken: row.share_token,
  isActive: row.is_active,
  isPublic: normalizePublicAccess(row.is_public),
  permission: normalizeSharePermission(row.permission),
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

const normalizeSharePermission = (
  permission?: string | null,
): DocumentSharePermission => (permission === "edit" ? "edit" : "view");

const normalizePublicAccess = (isPublic?: boolean | null): boolean =>
  isPublic === true;

const SHAREDB_COLLECTION =
  process.env.SHAREDB_COLLECTION?.trim() || "spreadsheets";

const DEFAULT_TITLE_PREFIX = "Document";
const MAX_TITLE_LENGTH = 160;
const DUPLICATE_TITLE_SUFFIX = " (Copy)";
const MAX_TEMPLATE_TITLE_LENGTH = 160;
const MAX_TEMPLATE_TAGLINE_LENGTH = 220;
const MAX_TEMPLATE_CATEGORY_LENGTH = 80;
const MAX_TEMPLATE_DESCRIPTION_LENGTH = 20_000;
const MAX_TEMPLATE_TAG_LENGTH = 40;
const MAX_TEMPLATE_TAG_COUNT = 20;
const MAX_TEMPLATE_PREVIEW_URL_LENGTH = 2048;
const UNCATEGORIZED_TEMPLATE_LABEL = "Uncategorized";

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

const buildDuplicateDocumentTitle = (
  sourceDocId: string,
  sourceTitle: string | null,
): string => {
  const normalizedSourceTitle = sourceTitle?.trim().replace(/\s+/g, " ");
  const fallbackTitle = getDefaultDocumentTitle(sourceDocId);
  const baseTitle = normalizedSourceTitle || fallbackTitle;
  const maxBaseLength = Math.max(
    1,
    MAX_TITLE_LENGTH - DUPLICATE_TITLE_SUFFIX.length,
  );
  const truncatedBaseTitle = baseTitle.slice(0, maxBaseLength).trimEnd();
  return `${truncatedBaseTitle || fallbackTitle.slice(0, maxBaseLength)}${DUPLICATE_TITLE_SUFFIX}`;
};

const normalizeTemplateCategory = (value?: string | null): string | null => {
  const normalized = value?.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, MAX_TEMPLATE_CATEGORY_LENGTH);
};

const normalizeTemplateTitle = (value?: string | null): string | null => {
  const normalized = value?.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, MAX_TEMPLATE_TITLE_LENGTH);
};

const normalizeTemplateTagline = (value?: string | null): string | null => {
  const normalized = value?.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, MAX_TEMPLATE_TAGLINE_LENGTH);
};

const normalizeTemplateDescriptionMarkdown = (
  value?: string | null,
): string | null => {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, MAX_TEMPLATE_DESCRIPTION_LENGTH);
};

const normalizeTemplatePreviewImageUrl = (value?: string | null): string | null => {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, MAX_TEMPLATE_PREVIEW_URL_LENGTH);
};

const normalizeTemplateTags = (values: string[]): string[] => {
  const dedupe = new Set<string>();
  const normalized: string[] = [];

  for (const value of values) {
    const next = value.trim().replace(/\s+/g, " ").slice(0, MAX_TEMPLATE_TAG_LENGTH);
    if (!next) {
      continue;
    }
    const dedupeKey = next.toLowerCase();
    if (dedupe.has(dedupeKey)) {
      continue;
    }
    dedupe.add(dedupeKey);
    normalized.push(next);
    if (normalized.length >= MAX_TEMPLATE_TAG_COUNT) {
      break;
    }
  }

  return normalized;
};

const normalizeTemplateCategoryForDisplay = (value?: string | null): string =>
  normalizeTemplateCategory(value) ?? UNCATEGORIZED_TEMPLATE_LABEL;

const toStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
};

const mapDocumentTemplateRow = (
  row: DocumentTemplateMetadataRow,
): DocumentTemplateMetadataRecord => {
  const fallbackTitle = row.title?.trim() || getDefaultDocumentTitle(row.doc_id);
  const resolvedTemplateTitle = normalizeTemplateTitle(row.template_title) ?? fallbackTitle;

  return {
    docId: row.doc_id,
    title: resolvedTemplateTitle,
    templateTitle: resolvedTemplateTitle,
    tagline: normalizeTemplateTagline(row.template_tagline) ?? "",
    isTemplate: row.is_template === true,
    category: normalizeTemplateCategory(row.template_category) ?? "",
    descriptionMarkdown: row.template_description_markdown?.trim() || "",
    tags: normalizeTemplateTags(toStringArray(row.template_tags)),
    previewImageUrl: row.template_preview_image_url?.trim() || "",
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
};

const mapTemplateCatalogRow = (row: TemplateCatalogRow): TemplateCatalogItem => {
  const fallbackTitle = row.title?.trim() ?? getDefaultDocumentTitle(row.doc_id);
  const resolvedTemplateTitle = normalizeTemplateTitle(row.template_title) ?? fallbackTitle;

  return {
    docId: row.doc_id,
    title: fallbackTitle,
    templateTitle: resolvedTemplateTitle,
    tagline: normalizeTemplateTagline(row.template_tagline) ?? "",
    category: normalizeTemplateCategoryForDisplay(row.template_category),
    descriptionMarkdown: row.template_description_markdown?.trim() || "",
    tags: normalizeTemplateTags(toStringArray(row.template_tags)),
    previewImageUrl: row.template_preview_image_url?.trim() || "",
    updatedAt: toIsoTimestamp(row.updated_at),
  };
};

const isMissingRelationError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code?: unknown }).code === "42P01";

const isMissingColumnError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code?: unknown }).code === "42703";

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
    INSERT INTO public.document_owners (doc_id, user_id)
    VALUES (${docId}, ${userId})
    ON CONFLICT (doc_id) DO NOTHING
  `;

  const rows = await db<DocumentOwnerRow[]>`
    SELECT
      doc_id,
      user_id,
      created_at,
      updated_at
    FROM public.document_owners
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
    FROM public.document_owners
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
  `;

  return rows.map((row) => row.doc_id);
}

export async function documentExists(docId: string): Promise<boolean> {
  const rows = await db<{ doc_id: string }[]>`
    SELECT doc_id
    FROM public.document_owners
    WHERE doc_id = ${docId}
    LIMIT 1
  `;

  return rows.length > 0;
}

export async function isDocumentOwner({
  docId,
  userId,
}: {
  docId: string;
  userId: string;
}): Promise<boolean> {
  const rows = await db<{ doc_id: string }[]>`
    SELECT doc_id
    FROM public.document_owners
    WHERE doc_id = ${docId}
      AND user_id = ${userId}
    LIMIT 1
  `;

  return rows.length > 0;
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
  const title =
    row.metadata_title?.trim() || getDefaultDocumentTitle(row.doc_id);

  return {
    docId: row.doc_id,
    title,
    createdAt,
    lastModifiedAt,
    isShared: row.is_shared,
    isTemplate: row.is_template === true,
    accessType: row.access_type,
    isFavorite: row.is_favorite,
  };
};

const normalizeListFilter = (
  filter: DocumentListFilter | string | undefined,
): DocumentListFilter => {
  if (
    filter === "owned" ||
    filter === "shared" ||
    filter === "my_shared" ||
    filter === "templates"
  ) {
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
        COALESCE(metadata.is_template, FALSE) AS is_template,
        (favorites.doc_id IS NOT NULL) AS is_favorite,
        (
          SELECT MAX(candidate_ts)
          FROM (
            VALUES
              (
                CASE
                  WHEN public.snapshots.metadata ? 'mtime'
                    AND jsonb_typeof(public.snapshots.metadata->'mtime') = 'number'
                  THEN to_timestamp((public.snapshots.metadata->>'mtime')::double precision / 1000.0)
                  ELSE NULL
                END
              ),
              (metadata.updated_at::timestamptz),
              (owners.updated_at::timestamptz),
              (owners.created_at::timestamptz)
          ) AS ts(candidate_ts)
        ) AS last_modified_at,
        'owned'::text AS access_type
      FROM public.document_owners AS owners
      LEFT JOIN public.document_metadata AS metadata
        ON metadata.doc_id = owners.doc_id
      LEFT JOIN public.document_share_links AS shares
        ON shares.doc_id = owners.doc_id
        AND shares.is_active = TRUE
      LEFT JOIN public.document_favorites AS favorites
        ON favorites.doc_id = owners.doc_id
        AND favorites.user_id = ${userId}
      LEFT JOIN public.snapshots
        ON public.snapshots.collection = ${SHAREDB_COLLECTION}
        AND public.snapshots.doc_id = owners.doc_id
      WHERE owners.user_id = ${userId}

      UNION ALL

      SELECT
        grants.doc_id,
        owners.created_at AS ownership_created_at,
        metadata.title AS metadata_title,
        TRUE AS is_shared,
        COALESCE(metadata.is_template, FALSE) AS is_template,
        (favorites.doc_id IS NOT NULL) AS is_favorite,
        (
          SELECT MAX(candidate_ts)
          FROM (
            VALUES
              (
                CASE
                  WHEN public.snapshots.metadata ? 'mtime'
                    AND jsonb_typeof(public.snapshots.metadata->'mtime') = 'number'
                  THEN to_timestamp((public.snapshots.metadata->>'mtime')::double precision / 1000.0)
                  ELSE NULL
                END
              ),
              (metadata.updated_at::timestamptz),
              (owners.updated_at::timestamptz),
              (owners.created_at::timestamptz)
          ) AS ts(candidate_ts)
        ) AS last_modified_at,
        'shared'::text AS access_type
      FROM public.document_access_grants AS grants
      INNER JOIN public.document_owners AS owners
        ON owners.doc_id = grants.doc_id
      LEFT JOIN public.document_metadata AS metadata
        ON metadata.doc_id = grants.doc_id
      LEFT JOIN public.document_favorites AS favorites
        ON favorites.doc_id = grants.doc_id
        AND favorites.user_id = ${userId}
      LEFT JOIN public.snapshots
        ON public.snapshots.collection = ${SHAREDB_COLLECTION}
        AND public.snapshots.doc_id = grants.doc_id
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
      OR (
        ${normalizedFilter} = 'templates'
        AND is_template = TRUE
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
        COALESCE(metadata.is_template, FALSE) AS is_template,
        (favorites.doc_id IS NOT NULL) AS is_favorite,
        (
          SELECT MAX(candidate_ts)
          FROM (
            VALUES
              (
                CASE
                  WHEN public.snapshots.metadata ? 'mtime'
                    AND jsonb_typeof(public.snapshots.metadata->'mtime') = 'number'
                  THEN to_timestamp((public.snapshots.metadata->>'mtime')::double precision / 1000.0)
                  ELSE NULL
                END
              ),
              (metadata.updated_at::timestamptz),
              (owners.updated_at::timestamptz),
              (owners.created_at::timestamptz)
          ) AS ts(candidate_ts)
        ) AS last_modified_at,
        'owned'::text AS access_type
      FROM public.document_owners AS owners
      LEFT JOIN public.document_metadata AS metadata
        ON metadata.doc_id = owners.doc_id
      LEFT JOIN public.document_share_links AS shares
        ON shares.doc_id = owners.doc_id
        AND shares.is_active = TRUE
      LEFT JOIN public.document_favorites AS favorites
        ON favorites.doc_id = owners.doc_id
        AND favorites.user_id = ${userId}
      LEFT JOIN public.snapshots
        ON public.snapshots.collection = ${SHAREDB_COLLECTION}
        AND public.snapshots.doc_id = owners.doc_id
      WHERE owners.user_id = ${userId}

      UNION ALL

      SELECT
        grants.doc_id,
        owners.created_at AS ownership_created_at,
        metadata.title AS metadata_title,
        TRUE AS is_shared,
        COALESCE(metadata.is_template, FALSE) AS is_template,
        (favorites.doc_id IS NOT NULL) AS is_favorite,
        (
          SELECT MAX(candidate_ts)
          FROM (
            VALUES
              (
                CASE
                  WHEN public.snapshots.metadata ? 'mtime'
                    AND jsonb_typeof(public.snapshots.metadata->'mtime') = 'number'
                  THEN to_timestamp((public.snapshots.metadata->>'mtime')::double precision / 1000.0)
                  ELSE NULL
                END
              ),
              (metadata.updated_at::timestamptz),
              (owners.updated_at::timestamptz),
              (owners.created_at::timestamptz)
          ) AS ts(candidate_ts)
        ) AS last_modified_at,
        'shared'::text AS access_type
      FROM public.document_access_grants AS grants
      INNER JOIN public.document_owners AS owners
        ON owners.doc_id = grants.doc_id
      LEFT JOIN public.document_metadata AS metadata
        ON metadata.doc_id = grants.doc_id
      LEFT JOIN public.document_favorites AS favorites
        ON favorites.doc_id = grants.doc_id
        AND favorites.user_id = ${userId}
      LEFT JOIN public.snapshots
        ON public.snapshots.collection = ${SHAREDB_COLLECTION}
        AND public.snapshots.doc_id = grants.doc_id
      WHERE grants.user_id = ${userId}
        AND owners.user_id <> ${userId}
    )
    SELECT
      doc_id,
      ownership_created_at,
      metadata_title,
      last_modified_at,
      is_shared,
      is_template,
      access_type,
      is_favorite
    FROM owned_documents
    WHERE (
      (${normalizedFilter} = 'owned' AND access_type = 'owned')
      OR (${normalizedFilter} = 'shared' AND access_type = 'shared')
      OR (
        ${normalizedFilter} = 'my_shared'
        AND access_type = 'owned'
        AND is_shared = TRUE
      )
      OR (
        ${normalizedFilter} = 'templates'
        AND is_template = TRUE
      )
    )
      AND (
        ${titleSearchPattern}::text IS NULL
        OR COALESCE(NULLIF(BTRIM(metadata_title), ''), 'Document ' || LEFT(doc_id, 8)) ILIKE ${titleSearchPattern}::text
      )
    ORDER BY is_favorite DESC, last_modified_at DESC, ownership_created_at DESC
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

export async function setDocumentFavorite({
  docId,
  userId,
  favorite,
}: {
  docId: string;
  userId: string;
  favorite: boolean;
}): Promise<boolean> {
  const accessibleRows = await db<{ doc_id: string }[]>`
    WITH accessible_documents AS (
      SELECT owners.doc_id
      FROM public.document_owners AS owners
      WHERE owners.doc_id = ${docId}
        AND owners.user_id = ${userId}
      UNION
      SELECT grants.doc_id
      FROM public.document_access_grants AS grants
      WHERE grants.doc_id = ${docId}
        AND grants.user_id = ${userId}
    )
    SELECT doc_id
    FROM accessible_documents
    LIMIT 1
  `;

  if (accessibleRows.length === 0) {
    return false;
  }

  try {
    if (favorite) {
      await db`
        INSERT INTO public.document_favorites (doc_id, user_id)
        VALUES (${docId}, ${userId})
        ON CONFLICT (doc_id, user_id) DO UPDATE
          SET updated_at = NOW()
      `;
    } else {
      await db`
        DELETE FROM public.document_favorites
        WHERE doc_id = ${docId}
          AND user_id = ${userId}
      `;
    }
  } catch (error) {
    if (isMissingRelationError(error)) {
      throw new Error(
        "Document favorites storage is not initialized. Run the document favorites migration.",
      );
    }
    throw error;
  }

  return true;
}

export async function ensureDocumentMetadata({
  docId,
}: {
  docId: string;
}): Promise<DocumentMetadataRecord> {
  const defaultTitle = getDefaultDocumentTitle(docId);

  try {
    await db`
      INSERT INTO public.document_metadata (doc_id, title)
      VALUES (${docId}, ${defaultTitle})
      ON CONFLICT (doc_id) DO NOTHING
    `;

    const rows = await db<DocumentMetadataRow[]>`
      SELECT
        doc_id,
        title,
        created_at,
        updated_at
      FROM public.document_metadata
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
      INSERT INTO public.document_metadata (doc_id, title)
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

const copySourceSnapshotToDocument = async ({
  tx,
  sourceDocId,
  duplicatedDocId,
}: {
  tx: {
    unsafe: typeof db.unsafe;
  };
  sourceDocId: string;
  duplicatedDocId: string;
}): Promise<boolean> => {
  try {
    const nowMs = Date.now();
    const copiedSnapshotRows = await tx.unsafe<{ doc_id: string }[]>(
      `
        WITH source_snapshot AS (
          SELECT
            doc_type,
            data,
            metadata
          FROM public.snapshots
          WHERE collection = $1
            AND doc_id = $2
          LIMIT 1
        )
        INSERT INTO public.snapshots (
          collection,
          doc_id,
          doc_type,
          version,
          data,
          metadata
        )
        SELECT
          $1,
          $3,
          source_snapshot.doc_type,
          1,
          source_snapshot.data,
          CASE
            WHEN source_snapshot.metadata IS NULL
              OR jsonb_typeof(source_snapshot.metadata) <> 'object'
            THEN jsonb_build_object('mtime', $4::bigint)
            ELSE jsonb_set(
              source_snapshot.metadata,
              '{mtime}',
              to_jsonb($4::bigint),
              true
            )
          END
        FROM source_snapshot
        RETURNING doc_id
      `,
      [SHAREDB_COLLECTION, sourceDocId, duplicatedDocId, nowMs],
    );

    return copiedSnapshotRows.length > 0;
  } catch (error) {
    if (!isMissingRelationError(error)) {
      throw error;
    }
    return false;
  }
};

export async function getDocumentTemplateMetadata({
  docId,
}: {
  docId: string;
}): Promise<DocumentTemplateMetadataRecord | null> {
  try {
    const rows = await db<DocumentTemplateMetadataRow[]>`
      SELECT
        doc_id,
        title,
        template_title,
        template_tagline,
        is_template,
        template_category,
        template_description_markdown,
        template_tags,
        template_preview_image_url,
        created_at,
        updated_at
      FROM public.document_metadata
      WHERE doc_id = ${docId}
      LIMIT 1
    `;

    const row = rows[0];
    if (!row) {
      return null;
    }

    return mapDocumentTemplateRow(row);
  } catch (error) {
    if (isMissingColumnError(error) || isMissingRelationError(error)) {
      throw new Error(
        "Template metadata storage is not initialized. Run the document templates migration.",
      );
    }
    throw error;
  }
}

export async function upsertDocumentTemplateMetadata(
  input: UpdateDocumentTemplateInput,
): Promise<DocumentTemplateMetadataRecord | null> {
  const metadata = await ensureDocumentMetadata({ docId: input.docId });
  if (!metadata) {
    return null;
  }

  const normalizedCategory = normalizeTemplateCategory(input.category);
  const normalizedTemplateTitle = normalizeTemplateTitle(input.templateTitle);
  const normalizedTagline = normalizeTemplateTagline(input.tagline);
  const normalizedDescription = normalizeTemplateDescriptionMarkdown(
    input.descriptionMarkdown,
  );
  const normalizedPreviewImageUrl = normalizeTemplatePreviewImageUrl(
    input.previewImageUrl,
  );
  const normalizedTags = normalizeTemplateTags(input.tags ?? []);

  try {
    const rows = await db<DocumentTemplateMetadataRow[]>`
      INSERT INTO public.document_metadata (
        doc_id,
        title,
        template_title,
        template_tagline,
        is_template,
        template_category,
        template_description_markdown,
        template_tags,
        template_preview_image_url
      )
      VALUES (
        ${input.docId},
        ${metadata.title},
        ${normalizedTemplateTitle},
        ${normalizedTagline},
        ${input.isTemplate},
        ${normalizedCategory},
        ${normalizedDescription},
        ${normalizedTags},
        ${normalizedPreviewImageUrl}
      )
      ON CONFLICT (doc_id) DO UPDATE
        SET
          is_template = EXCLUDED.is_template,
          template_title = EXCLUDED.template_title,
          template_tagline = EXCLUDED.template_tagline,
          template_category = EXCLUDED.template_category,
          template_description_markdown = EXCLUDED.template_description_markdown,
          template_tags = EXCLUDED.template_tags,
          template_preview_image_url = EXCLUDED.template_preview_image_url,
          updated_at = NOW()
      RETURNING
        doc_id,
        title,
        template_title,
        template_tagline,
        is_template,
        template_category,
        template_description_markdown,
        template_tags,
        template_preview_image_url,
        created_at,
        updated_at
    `;

    const row = rows[0];
    if (!row) {
      throw new Error("Failed to update template metadata.");
    }

    return mapDocumentTemplateRow(row);
  } catch (error) {
    if (isMissingColumnError(error) || isMissingRelationError(error)) {
      throw new Error(
        "Template metadata storage is not initialized. Run the document templates migration.",
      );
    }
    throw error;
  }
}

export async function listTemplateDocuments({
  query,
  category,
  limit = 200,
}: {
  query?: string | null;
  category?: string | null;
  limit?: number;
} = {}): Promise<TemplateCatalogItem[]> {
  const normalizedQuery = query?.trim().replace(/\s+/g, " ") || null;
  const queryPattern = normalizedQuery ? `%${normalizedQuery}%` : null;
  const normalizedCategory = normalizeTemplateCategory(category);
  const safeLimit = Number.isFinite(limit)
    ? Math.max(1, Math.min(500, Math.floor(limit)))
    : 200;

  try {
    const rows = await db<TemplateCatalogRow[]>`
      SELECT
        metadata.doc_id,
        metadata.title,
        metadata.template_title,
        metadata.template_tagline,
        metadata.template_category,
        metadata.template_description_markdown,
        metadata.template_tags,
        metadata.template_preview_image_url,
        metadata.updated_at
      FROM public.document_metadata AS metadata
      INNER JOIN public.document_owners AS owners
        ON owners.doc_id = metadata.doc_id
      WHERE metadata.is_template = TRUE
        AND (
          ${normalizedCategory}::text IS NULL
          OR LOWER(COALESCE(NULLIF(BTRIM(metadata.template_category), ''), ${UNCATEGORIZED_TEMPLATE_LABEL})) = LOWER(${normalizedCategory ?? null}::text)
        )
        AND (
          ${queryPattern}::text IS NULL
          OR COALESCE(NULLIF(BTRIM(metadata.title), ''), 'Document ' || LEFT(metadata.doc_id, 8)) ILIKE ${queryPattern}::text
          OR COALESCE(NULLIF(BTRIM(metadata.template_title), ''), '') ILIKE ${queryPattern}::text
          OR COALESCE(NULLIF(BTRIM(metadata.template_tagline), ''), '') ILIKE ${queryPattern}::text
          OR COALESCE(NULLIF(BTRIM(metadata.template_category), ''), ${UNCATEGORIZED_TEMPLATE_LABEL}) ILIKE ${queryPattern}::text
          OR COALESCE(metadata.template_description_markdown, '') ILIKE ${queryPattern}::text
          OR COALESCE(array_to_string(metadata.template_tags, ' '), '') ILIKE ${queryPattern}::text
        )
      ORDER BY
        LOWER(COALESCE(NULLIF(BTRIM(metadata.template_category), ''), ${UNCATEGORIZED_TEMPLATE_LABEL})) ASC,
        metadata.updated_at DESC
      LIMIT ${safeLimit}
    `;

    return rows.map(mapTemplateCatalogRow);
  } catch (error) {
    if (isMissingColumnError(error) || isMissingRelationError(error)) {
      return [];
    }
    throw error;
  }
}

export async function getTemplateDocumentById({
  docId,
}: {
  docId: string;
}): Promise<TemplateCatalogItem | null> {
  try {
    const rows = await db<TemplateCatalogRow[]>`
      SELECT
        metadata.doc_id,
        metadata.title,
        metadata.template_title,
        metadata.template_tagline,
        metadata.template_category,
        metadata.template_description_markdown,
        metadata.template_tags,
        metadata.template_preview_image_url,
        metadata.updated_at
      FROM public.document_metadata AS metadata
      WHERE metadata.doc_id = ${docId}
        AND metadata.is_template = TRUE
      LIMIT 1
    `;

    const row = rows[0];
    if (!row) {
      return null;
    }

    return mapTemplateCatalogRow(row);
  } catch (error) {
    if (isMissingColumnError(error) || isMissingRelationError(error)) {
      return null;
    }
    throw error;
  }
}

export async function duplicateDocument({
  sourceDocId,
  duplicatedDocId,
  userId,
}: {
  sourceDocId: string;
  duplicatedDocId: string;
  userId: string;
}): Promise<DuplicateDocumentResult | null> {
  return db.begin(async (tx) => {
    const sourceRows = await tx.unsafe<SourceDocumentForDuplicateRow[]>(
      `
        WITH accessible_documents AS (
          SELECT owners.doc_id
          FROM public.document_owners AS owners
          WHERE owners.doc_id = $1
            AND owners.user_id = $2
          UNION
          SELECT grants.doc_id
          FROM public.document_access_grants AS grants
          WHERE grants.doc_id = $1
            AND grants.user_id = $2
        )
        SELECT
          accessible_documents.doc_id,
          metadata.title AS source_title
        FROM accessible_documents
        LEFT JOIN public.document_metadata AS metadata
          ON metadata.doc_id = accessible_documents.doc_id
        LIMIT 1
      `,
      [sourceDocId, userId],
    );

    const sourceRow = sourceRows[0];
    if (!sourceRow) {
      return null;
    }

    const duplicatedTitle = buildDuplicateDocumentTitle(
      sourceDocId,
      sourceRow.source_title,
    );

    await tx.unsafe(
      `
        INSERT INTO public.document_owners (doc_id, user_id)
        VALUES ($1, $2)
      `,
      [duplicatedDocId, userId],
    );

    await tx.unsafe(
      `
        INSERT INTO public.document_metadata (doc_id, title)
        VALUES ($1, $2)
      `,
      [duplicatedDocId, duplicatedTitle],
    );

    const snapshotCopied = await copySourceSnapshotToDocument({
      tx,
      sourceDocId,
      duplicatedDocId,
    });

    return {
      docId: duplicatedDocId,
      title: duplicatedTitle,
      snapshotCopied,
    };
  });
}

export async function duplicateTemplateDocument({
  sourceDocId,
  duplicatedDocId,
  userId,
}: {
  sourceDocId: string;
  duplicatedDocId: string;
  userId: string;
}): Promise<DuplicateDocumentResult | null> {
  return db.begin(async (tx) => {
    const sourceRows = await tx.unsafe<SourceDocumentForDuplicateRow[]>(
      `
        SELECT
          metadata.doc_id,
          COALESCE(NULLIF(BTRIM(metadata.template_title), ''), metadata.title) AS source_title
        FROM public.document_metadata AS metadata
        WHERE metadata.doc_id = $1
          AND metadata.is_template = TRUE
        LIMIT 1
      `,
      [sourceDocId],
    );

    const sourceRow = sourceRows[0];
    if (!sourceRow) {
      return null;
    }

    const duplicatedTitle = buildDuplicateDocumentTitle(
      sourceDocId,
      sourceRow.source_title,
    );

    await tx.unsafe(
      `
        INSERT INTO public.document_owners (doc_id, user_id)
        VALUES ($1, $2)
      `,
      [duplicatedDocId, userId],
    );

    await tx.unsafe(
      `
        INSERT INTO public.document_metadata (doc_id, title)
        VALUES ($1, $2)
      `,
      [duplicatedDocId, duplicatedTitle],
    );

    const snapshotCopied = await copySourceSnapshotToDocument({
      tx,
      sourceDocId,
      duplicatedDocId,
    });

    return {
      docId: duplicatedDocId,
      title: duplicatedTitle,
      snapshotCopied,
    };
  });
}

export async function isOwnedTemplateDocument({
  docId,
  userId,
}: {
  docId: string;
  userId: string;
}): Promise<boolean> {
  try {
    const rows = await db<{ is_template: boolean }[]>`
      SELECT COALESCE(metadata.is_template, FALSE) AS is_template
      FROM public.document_owners AS owners
      LEFT JOIN public.document_metadata AS metadata
        ON metadata.doc_id = owners.doc_id
      WHERE owners.doc_id = ${docId}
        AND owners.user_id = ${userId}
      LIMIT 1
    `;

    return rows[0]?.is_template === true;
  } catch (error) {
    if (isMissingColumnError(error) || isMissingRelationError(error)) {
      return false;
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
        DELETE FROM public.document_owners
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
          DELETE FROM public.snapshots
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
          DELETE FROM public.ops
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
          DELETE FROM public.agent_operation_history
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

    let threadIdsForDocument: string[] = [];
    try {
      const threadRows = await tx.unsafe<{ thread_id: string }[]>(
        `
          SELECT thread_id
          FROM public.assistant_sessions
          WHERE doc_id = $1
        `,
        [docId],
      );
      threadIdsForDocument = threadRows
        .map((row) => row.thread_id)
        .filter((threadId) => typeof threadId === "string" && threadId.length > 0);
    } catch (error) {
      if (!isMissingRelationError(error)) {
        throw error;
      }
    }

    if (threadIdsForDocument.length > 0) {
      try {
        await tx.unsafe(
          `
            DELETE FROM public.chat_runs
            WHERE thread_id = ANY($1::text[])
          `,
          [threadIdsForDocument],
        );
      } catch (error) {
        if (!isMissingRelationError(error)) {
          throw error;
        }
      }

      try {
        await tx.unsafe(
          `
            DELETE FROM public.checkpoint_writes
            WHERE thread_id = ANY($1::text[])
          `,
          [threadIdsForDocument],
        );
      } catch (error) {
        if (!isMissingRelationError(error)) {
          throw error;
        }
      }

      try {
        await tx.unsafe(
          `
            DELETE FROM public.checkpoint_blobs
            WHERE thread_id = ANY($1::text[])
          `,
          [threadIdsForDocument],
        );
      } catch (error) {
        if (!isMissingRelationError(error)) {
          throw error;
        }
      }

      try {
        await tx.unsafe(
          `
            DELETE FROM public.checkpoints
            WHERE thread_id = ANY($1::text[])
          `,
          [threadIdsForDocument],
        );
      } catch (error) {
        if (!isMissingRelationError(error)) {
          throw error;
        }
      }
    }

    try {
      await tx.unsafe(
        `
          DELETE FROM public.assistant_sessions
          WHERE doc_id = $1
        `,
        [docId],
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
      FROM public.document_access_grants
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
      INSERT INTO public.document_access_grants (doc_id, user_id, granted_via)
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

const getActiveSharePermissionByDocumentId = async (
  docId: string,
): Promise<DocumentSharePermission | null> => {
  try {
    const rows = await db<{ permission: string | null }[]>`
      SELECT permission
      FROM public.document_share_links
      WHERE doc_id = ${docId}
        AND is_active = TRUE
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) {
      return null;
    }
    return normalizeSharePermission(row.permission);
  } catch (error) {
    if (isMissingColumnError(error)) {
      const rows = await db<{ doc_id: string }[]>`
        SELECT doc_id
        FROM public.document_share_links
        WHERE doc_id = ${docId}
          AND is_active = TRUE
        LIMIT 1
      `;
      return rows.length > 0 ? "view" : null;
    }
    throw error;
  }
};

const getActiveShareLinkByToken = async ({
  docId,
  shareToken,
}: {
  docId: string;
  shareToken: string;
}): Promise<
  { docId: string; permission: DocumentSharePermission; isPublic: boolean } | null
> => {
  try {
    const rows = await db<{
      doc_id: string;
      permission: string | null;
      is_public: boolean | null;
    }[]>`
      SELECT
        doc_id,
        permission,
        is_public
      FROM public.document_share_links
      WHERE doc_id = ${docId}
        AND is_active = TRUE
        AND share_token = ${shareToken}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;
    return {
      docId: row.doc_id,
      permission: normalizeSharePermission(row.permission),
      isPublic: normalizePublicAccess(row.is_public),
    };
  } catch (error) {
    if (isMissingColumnError(error)) {
      try {
        const rows = await db<{ doc_id: string; permission: string | null }[]>`
          SELECT
            doc_id,
            permission
          FROM public.document_share_links
          WHERE doc_id = ${docId}
            AND is_active = TRUE
            AND share_token = ${shareToken}
          LIMIT 1
        `;
        const row = rows[0];
        if (!row) return null;
        return {
          docId: row.doc_id,
          permission: normalizeSharePermission(row.permission),
          isPublic: false,
        };
      } catch (innerError) {
        if (!isMissingColumnError(innerError)) {
          throw innerError;
        }

        const rows = await db<{ doc_id: string }[]>`
          SELECT doc_id
          FROM public.document_share_links
          WHERE doc_id = ${docId}
            AND is_active = TRUE
            AND share_token = ${shareToken}
          LIMIT 1
        `;
        const row = rows[0];
        if (!row) return null;
        return {
          docId: row.doc_id,
          permission: "view",
          isPublic: false,
        };
      }
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
      permission: "edit",
    };
  }

  const hasPersistedAccess = await hasDocumentAccessGrant({ docId, userId });
  if (hasPersistedAccess) {
    const permission =
      (await getActiveSharePermissionByDocumentId(docId)) ?? "view";
    return {
      ...ownershipResult,
      canAccess: true,
      accessSource: "share",
      permission,
    };
  }

  const normalizedToken = normalizeShareToken(shareToken);
  const shareAccess = normalizedToken
    ? await getActiveShareLinkByToken({
        docId,
        shareToken: normalizedToken,
      })
    : null;
  const hasShareAccess = Boolean(shareAccess);
  if (hasShareAccess) {
    await upsertDocumentAccessGrant({ docId, userId });
  }

  if (hasShareAccess) {
    return {
      ...ownershipResult,
      canAccess: true,
      accessSource: "share",
      permission: shareAccess?.permission ?? "view",
    };
  }

  const isPublicTemplate = await isTemplateDocumentPubliclyViewable({ docId });
  if (isPublicTemplate) {
    return {
      ...ownershipResult,
      canAccess: true,
      accessSource: "template",
      permission: "view",
    };
  }

  return {
    ...ownershipResult,
    canAccess: false,
    accessSource: "none",
    permission: "view",
  };
}

export async function isTemplateDocumentPubliclyViewable({
  docId,
}: {
  docId: string;
}): Promise<boolean> {
  try {
    const rows = await db<{ is_template: boolean }[]>`
      SELECT COALESCE(metadata.is_template, FALSE) AS is_template
      FROM public.document_metadata AS metadata
      WHERE metadata.doc_id = ${docId}
      LIMIT 1
    `;
    return rows[0]?.is_template === true;
  } catch (error) {
    if (isMissingColumnError(error) || isMissingRelationError(error)) {
      return false;
    }
    throw error;
  }
}

export async function getPublicDocumentAccessByShareToken({
  docId,
  shareToken,
}: {
  docId: string;
  shareToken?: string | null;
}): Promise<{ canAccess: boolean; permission: DocumentSharePermission }> {
  const normalizedToken = normalizeShareToken(shareToken);
  if (!normalizedToken) {
    return {
      canAccess: false,
      permission: "view",
    };
  }

  const shareAccess = await getActiveShareLinkByToken({
    docId,
    shareToken: normalizedToken,
  });

  return {
    canAccess: Boolean(shareAccess?.isPublic),
    permission: shareAccess?.permission ?? "view",
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

  try {
    const existingRows = await db<DocumentShareLinkRow[]>`
      SELECT
        doc_id,
        share_token,
        is_active,
        is_public,
        permission,
        created_by_user_id,
        created_at,
        updated_at
      FROM public.document_share_links
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
      INSERT INTO public.document_share_links (
        doc_id,
        share_token,
        is_active,
        is_public,
        permission,
        created_by_user_id
      )
      VALUES (
        ${docId},
        ${nextShareToken},
        TRUE,
        FALSE,
        'view',
        ${userId}
      )
      ON CONFLICT (doc_id) DO UPDATE
        SET
          share_token = EXCLUDED.share_token,
          is_active = TRUE,
          is_public = COALESCE(public.document_share_links.is_public, EXCLUDED.is_public),
          permission = COALESCE(public.document_share_links.permission, EXCLUDED.permission),
          created_by_user_id = EXCLUDED.created_by_user_id,
          updated_at = NOW()
      RETURNING
        doc_id,
        share_token,
        is_active,
        is_public,
        permission,
        created_by_user_id,
        created_at,
        updated_at
    `;

    const row = upsertedRows[0];
    if (!row) {
      throw new Error("Failed to create a document share link.");
    }

    return mapShareLinkRow(row);
  } catch (error) {
    if (!isMissingColumnError(error)) {
      throw error;
    }

    try {
      const existingRows = await db<DocumentShareLinkRow[]>`
        SELECT
          doc_id,
          share_token,
          is_active,
          permission,
          created_by_user_id,
          created_at,
          updated_at
        FROM public.document_share_links
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
        INSERT INTO public.document_share_links (
          doc_id,
          share_token,
          is_active,
          permission,
          created_by_user_id
        )
        VALUES (
          ${docId},
          ${nextShareToken},
          TRUE,
          'view',
          ${userId}
        )
        ON CONFLICT (doc_id) DO UPDATE
          SET
            share_token = EXCLUDED.share_token,
            is_active = TRUE,
            permission = COALESCE(public.document_share_links.permission, EXCLUDED.permission),
            created_by_user_id = EXCLUDED.created_by_user_id,
            updated_at = NOW()
        RETURNING
          doc_id,
          share_token,
          is_active,
          permission,
          created_by_user_id,
          created_at,
          updated_at
      `;

      const row = upsertedRows[0];
      if (!row) {
        throw new Error("Failed to create a document share link.");
      }

      return mapShareLinkRow(row);
    } catch (innerError) {
      if (!isMissingColumnError(innerError)) {
        throw innerError;
      }

      const existingRows = await db<DocumentShareLinkRow[]>`
        SELECT
          doc_id,
          share_token,
          is_active,
          created_by_user_id,
          created_at,
          updated_at
        FROM public.document_share_links
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
        INSERT INTO public.document_share_links (
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
  }
}

export async function getDocumentShareLinkState({
  docId,
  userId,
}: {
  docId: string;
  userId: string;
}): Promise<{ isOwner: boolean; shareLink: DocumentShareLinkRecord | null }> {
  const ownershipResult = await ensureDocumentOwnership({ docId, userId });
  if (!ownershipResult.isOwner) {
    return { isOwner: false, shareLink: null };
  }

  try {
    const rows = await db<DocumentShareLinkRow[]>`
      SELECT
        doc_id,
        share_token,
        is_active,
        is_public,
        permission,
        created_by_user_id,
        created_at,
        updated_at
      FROM public.document_share_links
      WHERE doc_id = ${docId}
        AND is_active = TRUE
      LIMIT 1
    `;
    const row = rows[0];
    return {
      isOwner: true,
      shareLink: row ? mapShareLinkRow(row) : null,
    };
  } catch (error) {
    if (!isMissingColumnError(error)) {
      throw error;
    }

    try {
      const rows = await db<DocumentShareLinkRow[]>`
        SELECT
          doc_id,
          share_token,
          is_active,
          permission,
          created_by_user_id,
          created_at,
          updated_at
        FROM public.document_share_links
        WHERE doc_id = ${docId}
          AND is_active = TRUE
        LIMIT 1
      `;
      const row = rows[0];
      return {
        isOwner: true,
        shareLink: row ? mapShareLinkRow(row) : null,
      };
    } catch (innerError) {
      if (!isMissingColumnError(innerError)) {
        throw innerError;
      }

      const rows = await db<DocumentShareLinkRow[]>`
        SELECT
          doc_id,
          share_token,
          is_active,
          created_by_user_id,
          created_at,
          updated_at
        FROM public.document_share_links
        WHERE doc_id = ${docId}
          AND is_active = TRUE
        LIMIT 1
      `;
      const row = rows[0];
      return {
        isOwner: true,
        shareLink: row ? mapShareLinkRow(row) : null,
      };
    }
  }
}

export async function deactivateDocumentShareLink({
  docId,
  userId,
}: {
  docId: string;
  userId: string;
}): Promise<{ isOwner: boolean; wasActive: boolean }> {
  const ownershipResult = await ensureDocumentOwnership({ docId, userId });
  if (!ownershipResult.isOwner) {
    return { isOwner: false, wasActive: false };
  }

  const deactivatedRows = await db<{ doc_id: string }[]>`
    UPDATE public.document_share_links
    SET
      is_active = FALSE,
      updated_at = NOW()
    WHERE doc_id = ${docId}
      AND is_active = TRUE
    RETURNING doc_id
  `;

  // Revoke persisted share access grants so unshare is effective immediately.
  try {
    await db`
      DELETE FROM public.document_access_grants
      WHERE doc_id = ${docId}
        AND granted_via = 'share'
    `;
  } catch (error) {
    if (!isMissingRelationError(error)) {
      throw error;
    }
  }

  return {
    isOwner: true,
    wasActive: deactivatedRows.length > 0,
  };
}

export async function updateDocumentSharePermission({
  docId,
  userId,
  permission,
}: {
  docId: string;
  userId: string;
  permission: DocumentSharePermission;
}): Promise<DocumentShareLinkRecord | null> {
  const ownershipResult = await ensureDocumentOwnership({ docId, userId });
  if (!ownershipResult.isOwner) {
    return null;
  }

  const normalizedPermission = normalizeSharePermission(permission);
  const nextShareToken = crypto.randomUUID();

  try {
    const rows = await db<DocumentShareLinkRow[]>`
      INSERT INTO public.document_share_links (
        doc_id,
        share_token,
        is_active,
        is_public,
        permission,
        created_by_user_id
      )
      VALUES (
        ${docId},
        ${nextShareToken},
        TRUE,
        FALSE,
        ${normalizedPermission},
        ${userId}
      )
      ON CONFLICT (doc_id) DO UPDATE
        SET
          is_active = TRUE,
          is_public = COALESCE(public.document_share_links.is_public, EXCLUDED.is_public),
          permission = EXCLUDED.permission,
          created_by_user_id = EXCLUDED.created_by_user_id,
          updated_at = NOW()
      RETURNING
        doc_id,
        share_token,
        is_active,
        is_public,
        permission,
        created_by_user_id,
        created_at,
        updated_at
    `;

    const row = rows[0];
    if (!row) {
      throw new Error("Failed to update document share permissions.");
    }

    return mapShareLinkRow(row);
  } catch (error) {
    if (isMissingColumnError(error)) {
      try {
        const rows = await db<DocumentShareLinkRow[]>`
          INSERT INTO public.document_share_links (
            doc_id,
            share_token,
            is_active,
            permission,
            created_by_user_id
          )
          VALUES (
            ${docId},
            ${nextShareToken},
            TRUE,
            ${normalizedPermission},
            ${userId}
          )
          ON CONFLICT (doc_id) DO UPDATE
            SET
              is_active = TRUE,
              permission = EXCLUDED.permission,
              created_by_user_id = EXCLUDED.created_by_user_id,
              updated_at = NOW()
          RETURNING
            doc_id,
            share_token,
            is_active,
            permission,
            created_by_user_id,
            created_at,
            updated_at
        `;

        const row = rows[0];
        if (!row) {
          throw new Error("Failed to update document share permissions.");
        }

        return mapShareLinkRow(row);
      } catch (innerError) {
        if (isMissingColumnError(innerError)) {
          throw new Error(
            "Document share permissions are not initialized. Run the share-permissions migration.",
          );
        }
        throw innerError;
      }
    }
    throw error;
  }
}

export async function updateDocumentSharePublicAccess({
  docId,
  userId,
  isPublic,
}: {
  docId: string;
  userId: string;
  isPublic: boolean;
}): Promise<DocumentShareLinkRecord | null> {
  const ownershipResult = await ensureDocumentOwnership({ docId, userId });
  if (!ownershipResult.isOwner) {
    return null;
  }

  const nextShareToken = crypto.randomUUID();

  try {
    const rows = await db<DocumentShareLinkRow[]>`
      INSERT INTO public.document_share_links (
        doc_id,
        share_token,
        is_active,
        is_public,
        permission,
        created_by_user_id
      )
      VALUES (
        ${docId},
        ${nextShareToken},
        TRUE,
        ${isPublic},
        'view',
        ${userId}
      )
      ON CONFLICT (doc_id) DO UPDATE
        SET
          is_active = TRUE,
          is_public = EXCLUDED.is_public,
          permission = COALESCE(public.document_share_links.permission, EXCLUDED.permission),
          created_by_user_id = EXCLUDED.created_by_user_id,
          updated_at = NOW()
      RETURNING
        doc_id,
        share_token,
        is_active,
        is_public,
        permission,
        created_by_user_id,
        created_at,
        updated_at
    `;

    const row = rows[0];
    if (!row) {
      throw new Error("Failed to update public share access.");
    }

    return mapShareLinkRow(row);
  } catch (error) {
    if (isMissingColumnError(error)) {
      throw new Error(
        "Public share access is not initialized. Run the public-share migration.",
      );
    }
    throw error;
  }
}
