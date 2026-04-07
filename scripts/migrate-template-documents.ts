import path from "node:path";

import { config as loadEnv } from "dotenv";
import postgres from "postgres";

loadEnv({
  path: path.resolve(process.cwd(), ".env.local"),
  override: false,
  quiet: true,
});

const sanitizeDatabaseUrl = (connectionString: string): string => {
  try {
    const parsed = new URL(connectionString);
    if (parsed.searchParams.get("sslrootcert")?.trim().toLowerCase() === "system") {
      parsed.searchParams.delete("sslrootcert");
    }
    parsed.searchParams.delete("sslmode");
    return parsed.toString();
  } catch {
    return connectionString;
  }
};

const sourceDatabaseUrl = process.env.SOURCE_DATABASE_URL?.trim();
if (!sourceDatabaseUrl) {
  throw new Error(
    "Missing required config: SOURCE_DATABASE_URL. Set it to your old Neon database URL.",
  );
}

const targetDatabaseUrl =
  process.env.TARGET_DATABASE_URL?.trim() ?? process.env.DATABASE_URL?.trim();
if (!targetDatabaseUrl) {
  throw new Error(
    "Missing required config: TARGET_DATABASE_URL or DATABASE_URL.",
  );
}

const sharedbCollection = process.env.SHAREDB_COLLECTION?.trim() || "spreadsheets";

const source = postgres(sanitizeDatabaseUrl(sourceDatabaseUrl), {
  prepare: false,
  ssl: "require",
});

const target = postgres(sanitizeDatabaseUrl(targetDatabaseUrl), {
  prepare: false,
  ssl: "require",
});

type TemplateScope = "none" | "personal" | "organization" | "global";
type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

const toTemplateScope = (
  templateScope: unknown,
  isTemplate: unknown,
): TemplateScope => {
  if (typeof templateScope === "string") {
    const normalized = templateScope.trim().toLowerCase();
    if (normalized === "global") return "global";
    if (normalized === "organization") return "organization";
    if (normalized === "personal") return "personal";
    if (normalized === "none") return "none";
  }
  return isTemplate === true ? "global" : "none";
};

const asStringOrNull = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const asBoolean = (value: unknown, fallback = false): boolean =>
  typeof value === "boolean" ? value : fallback;

const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
};

const asDateString = (value: unknown): string => {
  if (typeof value === "string" || value instanceof Date) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return new Date().toISOString();
};

const normalizeJsonValue = (value: unknown): JsonValue => {
  if (value === undefined || value === null) {
    return null;
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      const looksJson =
        (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
        (trimmed.startsWith("[") && trimmed.endsWith("]"));
      if (looksJson) {
        try {
          return normalizeJsonValue(JSON.parse(trimmed));
        } catch {
          return value;
        }
      }
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeJsonValue(item));
  }

  if (typeof value === "object") {
    const input = value as Record<string, unknown>;
    const normalized: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(input)) {
      normalized[key] = normalizeJsonValue(item);
    }
    return normalized;
  }

  return null;
};

const hasColumn = async (
  sql: ReturnType<typeof postgres>,
  tableName: string,
  columnName: string,
) => {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ${tableName}
        AND column_name = ${columnName}
    ) AS exists
  `;
  return rows[0]?.exists === true;
};

const resolveTargetOwnerUserId = async (): Promise<string> => {
  const explicit = process.env.TARGET_TEMPLATE_OWNER_USER_ID?.trim();
  if (explicit) {
    return explicit;
  }

  const users = await target<{ id: string }[]>`
    SELECT id
    FROM public."user"
    ORDER BY "createdAt" ASC
  `;

  if (users.length === 1) {
    return users[0].id;
  }

  if (users.length === 0) {
    throw new Error(
      "No users found in target DB. Create a user first or set TARGET_TEMPLATE_OWNER_USER_ID.",
    );
  }

  throw new Error(
    `Found ${users.length} users in target DB. Set TARGET_TEMPLATE_OWNER_USER_ID explicitly.`,
  );
};

async function listTemplateDocIds(): Promise<string[]> {
  const hasTemplateScope = await hasColumn(
    source,
    "document_metadata",
    "template_scope",
  );
  if (hasTemplateScope) {
    const rows = await source<{ doc_id: string }[]>`
      SELECT doc_id
      FROM public.document_metadata
      WHERE COALESCE(NULLIF(BTRIM(template_scope), ''), 'none') <> 'none'
      ORDER BY updated_at DESC
    `;
    return rows.map((row) => row.doc_id);
  }

  const hasIsTemplate = await hasColumn(source, "document_metadata", "is_template");
  if (hasIsTemplate) {
    const rows = await source<{ doc_id: string }[]>`
      SELECT doc_id
      FROM public.document_metadata
      WHERE is_template = TRUE
      ORDER BY updated_at DESC
    `;
    return rows.map((row) => row.doc_id);
  }

  throw new Error(
    "Source DB is missing both document_metadata.template_scope and document_metadata.is_template.",
  );
}

async function main() {
  const ownerUserId = await resolveTargetOwnerUserId();
  const targetHasUserRenameColumn = await hasColumn(
    target,
    "document_metadata",
    "is_user_renamed",
  );
  const docIds = await listTemplateDocIds();

  if (docIds.length === 0) {
    console.log("No template documents found in source DB.");
    return;
  }

  let copied = 0;
  for (const docId of docIds) {
    const metadataRows = await source<{ row: Record<string, unknown> }[]>`
      SELECT to_jsonb(m) AS row
      FROM public.document_metadata AS m
      WHERE m.doc_id = ${docId}
      LIMIT 1
    `;

    const metadataJson = metadataRows[0]?.row;
    if (!metadataJson) {
      continue;
    }

    const templateScope = toTemplateScope(
      metadataJson.template_scope,
      metadataJson.is_template,
    );
    if (templateScope === "none") {
      continue;
    }

    const title =
      asStringOrNull(metadataJson.title) ?? `Document ${docId.slice(0, 8)}`;
    const templateTitle = asStringOrNull(metadataJson.template_title);
    const templateTagline = asStringOrNull(metadataJson.template_tagline);
    const templateCategory = asStringOrNull(metadataJson.template_category);
    const templateDescription = asStringOrNull(
      metadataJson.template_description_markdown,
    );
    const templatePreviewImageUrl = asStringOrNull(
      metadataJson.template_preview_image_url,
    );
    const templateTags = asStringArray(metadataJson.template_tags);
    const isUserRenamed = asBoolean(metadataJson.is_user_renamed, false);
    const createdAt = asDateString(metadataJson.created_at);
    const updatedAt = asDateString(metadataJson.updated_at);
    const isTemplate = true;

    const sourceOwnerRows = await source<{
      created_at: Date | string;
      updated_at: Date | string;
    }[]>`
      SELECT created_at, updated_at
      FROM public.document_owners
      WHERE doc_id = ${docId}
      LIMIT 1
    `;

    const ownerCreatedAt = sourceOwnerRows[0]?.created_at
      ? asDateString(sourceOwnerRows[0].created_at)
      : createdAt;
    const ownerUpdatedAt = sourceOwnerRows[0]?.updated_at
      ? asDateString(sourceOwnerRows[0].updated_at)
      : updatedAt;

    const snapshotRows = await source<{
      doc_type: string | null;
      version: number;
      data: unknown;
      metadata: unknown;
    }[]>`
      SELECT doc_type, version, data, metadata
      FROM public.snapshots
      WHERE collection = ${sharedbCollection}
        AND doc_id = ${docId}
      LIMIT 1
    `;

    const opsRows = await source<{
      version: number;
      operation: unknown;
    }[]>`
      SELECT version, operation
      FROM public.ops
      WHERE collection = ${sharedbCollection}
        AND doc_id = ${docId}
      ORDER BY version ASC
    `;

    await target`
      INSERT INTO public.document_owners (doc_id, user_id, created_at, updated_at)
      VALUES (${docId}, ${ownerUserId}, ${ownerCreatedAt}, ${ownerUpdatedAt})
      ON CONFLICT (doc_id) DO UPDATE
        SET
          user_id = EXCLUDED.user_id,
          updated_at = EXCLUDED.updated_at
    `;

    if (targetHasUserRenameColumn) {
      await target`
        INSERT INTO public.document_metadata (
          doc_id,
          title,
          is_user_renamed,
          is_template,
          template_title,
          template_tagline,
          template_scope,
          template_category,
          template_description_markdown,
          template_tags,
          template_preview_image_url,
          created_at,
          updated_at
        )
        VALUES (
          ${docId},
          ${title},
          ${isUserRenamed},
          ${isTemplate},
          ${templateTitle},
          ${templateTagline},
          ${templateScope},
          ${templateCategory},
          ${templateDescription},
          ${templateTags},
          ${templatePreviewImageUrl},
          ${createdAt},
          ${updatedAt}
        )
        ON CONFLICT (doc_id) DO UPDATE
          SET
            title = EXCLUDED.title,
            is_user_renamed = EXCLUDED.is_user_renamed,
            is_template = EXCLUDED.is_template,
            template_title = EXCLUDED.template_title,
            template_tagline = EXCLUDED.template_tagline,
            template_scope = EXCLUDED.template_scope,
            template_category = EXCLUDED.template_category,
            template_description_markdown = EXCLUDED.template_description_markdown,
            template_tags = EXCLUDED.template_tags,
            template_preview_image_url = EXCLUDED.template_preview_image_url,
            updated_at = EXCLUDED.updated_at
      `;
    } else {
      await target`
        INSERT INTO public.document_metadata (
          doc_id,
          title,
          is_template,
          template_title,
          template_tagline,
          template_scope,
          template_category,
          template_description_markdown,
          template_tags,
          template_preview_image_url,
          created_at,
          updated_at
        )
        VALUES (
          ${docId},
          ${title},
          ${isTemplate},
          ${templateTitle},
          ${templateTagline},
          ${templateScope},
          ${templateCategory},
          ${templateDescription},
          ${templateTags},
          ${templatePreviewImageUrl},
          ${createdAt},
          ${updatedAt}
        )
        ON CONFLICT (doc_id) DO UPDATE
          SET
            title = EXCLUDED.title,
            is_template = EXCLUDED.is_template,
            template_title = EXCLUDED.template_title,
            template_tagline = EXCLUDED.template_tagline,
            template_scope = EXCLUDED.template_scope,
            template_category = EXCLUDED.template_category,
            template_description_markdown = EXCLUDED.template_description_markdown,
            template_tags = EXCLUDED.template_tags,
            template_preview_image_url = EXCLUDED.template_preview_image_url,
            updated_at = EXCLUDED.updated_at
      `;
    }

    const snapshot = snapshotRows[0];
    if (snapshot) {
      const snapshotDataParam = normalizeJsonValue(snapshot.data);
      const snapshotMetadataParam = normalizeJsonValue(snapshot.metadata);
      await target.unsafe(
        `
          INSERT INTO public.snapshots (
            collection,
            doc_id,
            doc_type,
            version,
            data,
            metadata
          )
          VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
          ON CONFLICT (collection, doc_id) DO UPDATE
            SET
              doc_type = EXCLUDED.doc_type,
              version = EXCLUDED.version,
              data = EXCLUDED.data,
              metadata = EXCLUDED.metadata
        `,
        [
          sharedbCollection,
          docId,
          snapshot.doc_type,
          snapshot.version,
          snapshotDataParam,
          snapshotMetadataParam,
        ],
      );
    }

    for (const op of opsRows) {
      const opJsonParam = normalizeJsonValue(op.operation);
      await target.unsafe(
        `
          INSERT INTO public.ops (collection, doc_id, version, operation)
          VALUES ($1, $2, $3, $4::jsonb)
          ON CONFLICT (collection, doc_id, version) DO UPDATE
            SET operation = EXCLUDED.operation
        `,
        [
          sharedbCollection,
          docId,
          op.version,
          opJsonParam,
        ],
      );
    }

    copied += 1;
    console.log(
      `Migrated template ${docId} (scope=${templateScope}, ops=${opsRows.length}, snapshot=${snapshotRows.length > 0 ? "yes" : "no"}).`,
    );
  }

  console.log(
    `Template migration complete. Migrated ${copied} template document(s) to user ${ownerUserId}.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.all([source.end(), target.end()]);
  });
