import path from "node:path";

import { config as loadEnv } from "dotenv";
import postgres from "postgres";

loadEnv({
  path: path.resolve(process.cwd(), ".env.local"),
  override: false,
  quiet: true,
});

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

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
    "Missing required config: SOURCE_DATABASE_URL. Set it to your old database URL.",
  );
}

const targetDatabaseUrl =
  process.env.TARGET_DATABASE_URL?.trim() ?? process.env.DATABASE_URL?.trim();
if (!targetDatabaseUrl) {
  throw new Error(
    "Missing required config: TARGET_DATABASE_URL or DATABASE_URL.",
  );
}

const sourceOwnerUserId =
  process.env.SOURCE_OWNER_USER_ID?.trim() ?? process.argv[2]?.trim();
if (!sourceOwnerUserId) {
  throw new Error(
    "Missing SOURCE_OWNER_USER_ID. Pass it as env var or first arg.",
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
  const explicit = process.env.TARGET_OWNER_USER_ID?.trim();
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
      "No users found in target DB. Create a user first or set TARGET_OWNER_USER_ID.",
    );
  }

  throw new Error(
    `Found ${users.length} users in target DB. Set TARGET_OWNER_USER_ID explicitly.`,
  );
};

async function main() {
  const targetOwnerUserId = await resolveTargetOwnerUserId();
  const targetHasUserRenameColumn = await hasColumn(
    target,
    "document_metadata",
    "is_user_renamed",
  );

  const sourceOwnedDocs = await source<{
    doc_id: string;
    created_at: string | Date;
    updated_at: string | Date;
  }[]>`
    SELECT doc_id, created_at, updated_at
    FROM public.document_owners
    WHERE user_id = ${sourceOwnerUserId}
    ORDER BY updated_at DESC
  `;

  if (sourceOwnedDocs.length === 0) {
    console.log(
      `No documents found for source user ${sourceOwnerUserId}. Nothing to migrate.`,
    );
    return;
  }

  let migrated = 0;
  let migratedWithSnapshot = 0;
  for (const sourceDoc of sourceOwnedDocs) {
    const docId = sourceDoc.doc_id;
    const fallbackCreatedAt = asDateString(sourceDoc.created_at);
    const fallbackUpdatedAt = asDateString(sourceDoc.updated_at);

    const metadataRows = await source<{ row: Record<string, unknown> }[]>`
      SELECT to_jsonb(m) AS row
      FROM public.document_metadata AS m
      WHERE m.doc_id = ${docId}
      LIMIT 1
    `;
    const metadataJson = metadataRows[0]?.row ?? null;

    const title =
      asStringOrNull(metadataJson?.title) ?? `Document ${docId.slice(0, 8)}`;
    const isUserRenamed = asBoolean(metadataJson?.is_user_renamed, false);
    const isTemplate = asBoolean(metadataJson?.is_template, false);
    const templateTitle = asStringOrNull(metadataJson?.template_title);
    const templateTagline = asStringOrNull(metadataJson?.template_tagline);
    const templateScope = asStringOrNull(metadataJson?.template_scope);
    const templateCategory = asStringOrNull(metadataJson?.template_category);
    const templateDescription = asStringOrNull(
      metadataJson?.template_description_markdown,
    );
    const templateTags = asStringArray(metadataJson?.template_tags);
    const templatePreviewImageUrl = asStringOrNull(
      metadataJson?.template_preview_image_url,
    );
    const createdAt = asDateString(metadataJson?.created_at ?? fallbackCreatedAt);
    const updatedAt = asDateString(metadataJson?.updated_at ?? fallbackUpdatedAt);

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

    await target`
      INSERT INTO public.document_owners (doc_id, user_id, created_at, updated_at)
      VALUES (${docId}, ${targetOwnerUserId}, ${fallbackCreatedAt}, ${fallbackUpdatedAt})
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
      migratedWithSnapshot += 1;
    }

    migrated += 1;
    console.log(
      `Migrated document ${docId} (snapshot=${snapshot ? "yes" : "no"}).`,
    );
  }

  console.log(
    `Document migration complete. Migrated ${migrated} document(s) from ${sourceOwnerUserId} to ${targetOwnerUserId}. Snapshots migrated: ${migratedWithSnapshot}.`,
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
