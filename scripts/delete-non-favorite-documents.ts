import path from "node:path";

import { config as loadEnv } from "dotenv";
import postgres from "postgres";

loadEnv({
  path: path.resolve(process.cwd(), ".env.local"),
  override: false,
  quiet: true,
});

const databaseUrl = process.env.DATABASE_URL ?? "";
const shareDbCollection = process.env.SHAREDB_COLLECTION?.trim() || "spreadsheets";

if (!databaseUrl) {
  throw new Error(
    "Missing required config: DATABASE_URL. Set it in .env.local.",
  );
}

type ScriptArgs = {
  userId: string;
  execute: boolean;
  limit?: number;
};

type CandidateDocument = {
  doc_id: string;
  title: string | null;
};

type DeletionStats = {
  docId: string;
  deletedOwner: boolean;
  deletedSnapshots: number | null;
  deletedOps: number | null;
  deletedOperationHistory: number | null;
  deletedImportJobs: number | null;
  deletedChatRuns: number | null;
  deletedCheckpointWrites: number | null;
  deletedCheckpointBlobs: number | null;
  deletedCheckpoints: number | null;
  deletedAssistantSessions: number | null;
};

const isMissingRelationError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code?: unknown }).code === "42P01";

const parseArgs = (argv: string[]): ScriptArgs => {
  let userId = "";
  let execute = false;
  let limit: number | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--execute") {
      execute = true;
      continue;
    }

    if (token === "--dry-run") {
      execute = false;
      continue;
    }

    if (token === "--userId" || token === "--user-id") {
      const value = argv[index + 1]?.trim();
      if (value) {
        userId = value;
        index += 1;
        continue;
      }
      throw new Error(`Missing value for ${token}`);
    }

    if (token === "--limit") {
      const raw = argv[index + 1]?.trim();
      if (!raw) {
        throw new Error("Missing value for --limit");
      }
      const parsed = Number.parseInt(raw, 10);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`Invalid --limit value: ${raw}`);
      }
      limit = parsed;
      index += 1;
      continue;
    }

    if (token === "--help" || token === "-h") {
      console.log(`Usage:
  tsx scripts/delete-non-favorite-documents.ts --userId <user-id> [--limit N] [--execute]

Behavior:
  - Default mode is dry-run (no deletions).
  - --execute performs permanent deletion.
  - Deletes owned documents for the user where the same user has NOT favorited them.
  - For each deleted document, also cleans related snapshots/ops/operation history/chat/checkpoints/sessions/import-jobs.
`);
      process.exit(0);
    }

    if (!token.startsWith("--") && !userId) {
      userId = token.trim();
    }
  }

  if (!userId) {
    throw new Error("Missing required user id. Pass --userId <id> or positional <id>.");
  }

  return { userId, execute, ...(limit ? { limit } : {}) };
};

const listCandidateDocuments = async (
  sql: postgres.Sql,
  input: { userId: string; limit?: number },
): Promise<CandidateDocument[]> => {
  if (typeof input.limit === "number") {
    return sql<CandidateDocument[]>`
      SELECT
        owners.doc_id,
        metadata.title
      FROM public.document_owners AS owners
      LEFT JOIN public.document_favorites AS favorites
        ON favorites.doc_id = owners.doc_id
        AND favorites.user_id = ${input.userId}
      LEFT JOIN public.document_metadata AS metadata
        ON metadata.doc_id = owners.doc_id
      WHERE owners.user_id = ${input.userId}
        AND favorites.doc_id IS NULL
      ORDER BY owners.updated_at DESC
      LIMIT ${input.limit}
    `;
  }

  return sql<CandidateDocument[]>`
    SELECT
      owners.doc_id,
      metadata.title
    FROM public.document_owners AS owners
    LEFT JOIN public.document_favorites AS favorites
      ON favorites.doc_id = owners.doc_id
      AND favorites.user_id = ${input.userId}
    LEFT JOIN public.document_metadata AS metadata
      ON metadata.doc_id = owners.doc_id
    WHERE owners.user_id = ${input.userId}
      AND favorites.doc_id IS NULL
    ORDER BY owners.updated_at DESC
  `;
};

const deleteReturningCount = async (
  tx: postgres.TransactionSql,
  query: string,
  params: postgres.ParameterOrJSON<never>[],
): Promise<number> => {
  const rows = await tx.unsafe<{ n: number }[]>(query, params);
  return rows.length;
};

const deleteIfTableExists = async (
  tx: postgres.TransactionSql,
  query: string,
  params: postgres.ParameterOrJSON<never>[],
): Promise<number | null> => {
  try {
    return await deleteReturningCount(tx, query, params);
  } catch (error) {
    if (isMissingRelationError(error)) {
      return null;
    }
    throw error;
  }
};

const deleteDocumentAndRelatedData = async (
  tx: postgres.TransactionSql,
  input: {
    userId: string;
    docId: string;
  },
): Promise<DeletionStats> => {
  const docId = input.docId;
  const deletedOwnerRows = await tx.unsafe<{ doc_id: string }[]>(
    `
      DELETE FROM public.document_owners
      WHERE doc_id = $1
        AND user_id = $2
      RETURNING doc_id
    `,
    [docId, input.userId],
  );

  if (deletedOwnerRows.length === 0) {
    return {
      docId,
      deletedOwner: false,
      deletedSnapshots: 0,
      deletedOps: 0,
      deletedOperationHistory: 0,
      deletedImportJobs: 0,
      deletedChatRuns: 0,
      deletedCheckpointWrites: 0,
      deletedCheckpointBlobs: 0,
      deletedCheckpoints: 0,
      deletedAssistantSessions: 0,
    };
  }

  const deletedSnapshots = await deleteIfTableExists(
    tx,
    `
      DELETE FROM public.snapshots
      WHERE collection = $1
        AND doc_id = $2
      RETURNING 1 AS n
    `,
    [shareDbCollection, docId],
  );

  const deletedOps = await deleteIfTableExists(
    tx,
    `
      DELETE FROM public.ops
      WHERE collection = $1
        AND doc_id = $2
      RETURNING 1 AS n
    `,
    [shareDbCollection, docId],
  );

  const deletedOperationHistory = await deleteIfTableExists(
    tx,
    `
      DELETE FROM public.agent_operation_history
      WHERE collection = $1
        AND doc_id = $2
      RETURNING 1 AS n
    `,
    [shareDbCollection, docId],
  );

  const deletedImportJobs = await deleteIfTableExists(
    tx,
    `
      DELETE FROM public.document_import_jobs
      WHERE doc_id = $1
      RETURNING 1 AS n
    `,
    [docId],
  );

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

  let deletedChatRuns: number | null = 0;
  let deletedCheckpointWrites: number | null = 0;
  let deletedCheckpointBlobs: number | null = 0;
  let deletedCheckpoints: number | null = 0;

  if (threadIdsForDocument.length > 0) {
    deletedChatRuns = await deleteIfTableExists(
      tx,
      `
        DELETE FROM public.chat_runs
        WHERE thread_id = ANY($1::text[])
        RETURNING 1 AS n
      `,
      [threadIdsForDocument],
    );

    deletedCheckpointWrites = await deleteIfTableExists(
      tx,
      `
        DELETE FROM public.checkpoint_writes
        WHERE thread_id = ANY($1::text[])
        RETURNING 1 AS n
      `,
      [threadIdsForDocument],
    );

    deletedCheckpointBlobs = await deleteIfTableExists(
      tx,
      `
        DELETE FROM public.checkpoint_blobs
        WHERE thread_id = ANY($1::text[])
        RETURNING 1 AS n
      `,
      [threadIdsForDocument],
    );

    deletedCheckpoints = await deleteIfTableExists(
      tx,
      `
        DELETE FROM public.checkpoints
        WHERE thread_id = ANY($1::text[])
        RETURNING 1 AS n
      `,
      [threadIdsForDocument],
    );
  }

  const deletedAssistantSessions = await deleteIfTableExists(
    tx,
    `
      DELETE FROM public.assistant_sessions
      WHERE doc_id = $1
      RETURNING 1 AS n
    `,
    [docId],
  );

  return {
    docId,
    deletedOwner: true,
    deletedSnapshots,
    deletedOps,
    deletedOperationHistory,
    deletedImportJobs,
    deletedChatRuns,
    deletedCheckpointWrites,
    deletedCheckpointBlobs,
    deletedCheckpoints,
    deletedAssistantSessions,
  };
};

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const sql = postgres(databaseUrl, {
    prepare: false,
    ssl: "require",
  });

  try {
    const candidates = await listCandidateDocuments(sql, {
      userId: args.userId,
      ...(typeof args.limit === "number" ? { limit: args.limit } : {}),
    });

    if (candidates.length === 0) {
      console.log(`No non-favorite owned documents found for user ${args.userId}.`);
      return;
    }

    console.log(
      `Found ${candidates.length} non-favorite owned document(s) for user ${args.userId}.`,
    );

    for (const candidate of candidates) {
      const title =
        candidate.title?.trim() || `Document ${candidate.doc_id.slice(0, 8)}`;
      console.log(`- ${candidate.doc_id} | ${title}`);
    }

    if (!args.execute) {
      console.log(
        "\nDry-run only. Re-run with --execute to delete these documents and related records.",
      );
      return;
    }

    const deletionResults: DeletionStats[] = [];
    for (const candidate of candidates) {
      const result = await sql.begin((tx) =>
        deleteDocumentAndRelatedData(tx, {
          userId: args.userId,
          docId: candidate.doc_id,
        }),
      );
      deletionResults.push(result);
      console.log(`Deleted ${candidate.doc_id}`);
    }

    const sum = (
      selector: (item: DeletionStats) => number | null,
    ): number | null => {
      const values = deletionResults
        .map(selector)
        .filter((value): value is number => typeof value === "number");
      if (values.length === 0) return null;
      return values.reduce((total, value) => total + value, 0);
    };

    console.log("\nDeletion summary:");
    console.log(`- Documents deleted: ${deletionResults.filter((r) => r.deletedOwner).length}`);
    console.log(`- snapshots: ${sum((r) => r.deletedSnapshots) ?? "n/a"}`);
    console.log(`- ops: ${sum((r) => r.deletedOps) ?? "n/a"}`);
    console.log(
      `- agent_operation_history: ${sum((r) => r.deletedOperationHistory) ?? "n/a"}`,
    );
    console.log(`- document_import_jobs: ${sum((r) => r.deletedImportJobs) ?? "n/a"}`);
    console.log(`- chat_runs: ${sum((r) => r.deletedChatRuns) ?? "n/a"}`);
    console.log(
      `- checkpoint_writes: ${sum((r) => r.deletedCheckpointWrites) ?? "n/a"}`,
    );
    console.log(
      `- checkpoint_blobs: ${sum((r) => r.deletedCheckpointBlobs) ?? "n/a"}`,
    );
    console.log(`- checkpoints: ${sum((r) => r.deletedCheckpoints) ?? "n/a"}`);
    console.log(
      `- assistant_sessions: ${sum((r) => r.deletedAssistantSessions) ?? "n/a"}`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
