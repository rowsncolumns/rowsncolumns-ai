import { db } from "@/lib/db/postgres";

type AssistantSessionRow = {
  thread_id: string;
  user_id: string;
  doc_id: string | null;
  title: string | null;
  model: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export type AssistantSessionRecord = {
  threadId: string;
  userId: string;
  docId?: string;
  title?: string;
  model?: string;
  createdAt: string;
  updatedAt: string;
};

let ensureAssistantSessionsTablePromise: Promise<void> | null = null;

const ensureAssistantSessionsTable = async () => {
  if (!ensureAssistantSessionsTablePromise) {
    ensureAssistantSessionsTablePromise = (async () => {
      await db`
        CREATE TABLE IF NOT EXISTS assistant_sessions (
          thread_id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          doc_id TEXT,
          title TEXT,
          model TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await db`
        CREATE INDEX IF NOT EXISTS assistant_sessions_user_updated_idx
          ON assistant_sessions (user_id, updated_at DESC)
      `;
      await db`
        CREATE INDEX IF NOT EXISTS assistant_sessions_user_doc_updated_idx
          ON assistant_sessions (user_id, doc_id, updated_at DESC)
      `;
      // Add model column if it doesn't exist (migration for existing tables)
      await db`
        ALTER TABLE assistant_sessions
        ADD COLUMN IF NOT EXISTS model TEXT
      `;
    })().catch((error) => {
      ensureAssistantSessionsTablePromise = null;
      throw error;
    });
  }

  await ensureAssistantSessionsTablePromise;
};

const mapRowToRecord = (row: AssistantSessionRow): AssistantSessionRecord => ({
  threadId: row.thread_id,
  userId: row.user_id,
  ...(row.doc_id ? { docId: row.doc_id } : {}),
  ...(row.title ? { title: row.title } : {}),
  ...(row.model ? { model: row.model } : {}),
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});

const normalizeOptional = (value?: string) => {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
};

export async function upsertAssistantSession(input: {
  threadId: string;
  userId: string;
  docId?: string;
  title?: string;
  model?: string;
}) {
  const threadId = input.threadId.trim();
  const userId = input.userId.trim();
  if (!threadId || !userId) {
    return;
  }

  const docId = normalizeOptional(input.docId);
  const title = normalizeOptional(input.title);
  const model = normalizeOptional(input.model);

  await ensureAssistantSessionsTable();
  await db`
    INSERT INTO assistant_sessions (
      thread_id,
      user_id,
      doc_id,
      title,
      model
    )
    VALUES (
      ${threadId},
      ${userId},
      ${docId},
      ${title},
      ${model}
    )
    ON CONFLICT (thread_id) DO UPDATE
      SET
        user_id = EXCLUDED.user_id,
        doc_id = COALESCE(EXCLUDED.doc_id, assistant_sessions.doc_id),
        title = COALESCE(EXCLUDED.title, assistant_sessions.title),
        model = COALESCE(EXCLUDED.model, assistant_sessions.model),
        updated_at = NOW()
  `;
}

export async function listAssistantSessions(input: {
  userId: string;
  limit?: number;
  docId?: string;
}): Promise<AssistantSessionRecord[]> {
  const userId = input.userId.trim();
  if (!userId) {
    return [];
  }

  const limit = Math.max(
    1,
    Math.min(
      typeof input.limit === "number" && Number.isFinite(input.limit)
        ? Math.floor(input.limit)
        : 10,
      50,
    ),
  );
  const docId = normalizeOptional(input.docId);

  await ensureAssistantSessionsTable();

  const rows = docId
    ? await db<AssistantSessionRow[]>`
        SELECT
          thread_id,
          user_id,
          doc_id,
          title,
          model,
          created_at,
          updated_at
        FROM assistant_sessions
        WHERE user_id = ${userId}
          AND doc_id = ${docId}
        ORDER BY updated_at DESC
        LIMIT ${limit}
      `
    : await db<AssistantSessionRow[]>`
        SELECT
          thread_id,
          user_id,
          doc_id,
          title,
          model,
          created_at,
          updated_at
        FROM assistant_sessions
        WHERE user_id = ${userId}
        ORDER BY updated_at DESC
        LIMIT ${limit}
      `;

  return rows.map(mapRowToRecord);
}

export async function getAssistantSessionByThreadId(input: {
  threadId: string;
  userId: string;
}): Promise<AssistantSessionRecord | null> {
  const threadId = input.threadId.trim();
  const userId = input.userId.trim();
  if (!threadId || !userId) {
    return null;
  }

  await ensureAssistantSessionsTable();
  const rows = await db<AssistantSessionRow[]>`
    SELECT
      thread_id,
      user_id,
      doc_id,
      title,
      model,
      created_at,
      updated_at
    FROM assistant_sessions
    WHERE thread_id = ${threadId}
      AND user_id = ${userId}
    LIMIT 1
  `;

  const row = rows[0];
  return row ? mapRowToRecord(row) : null;
}

export async function deleteAssistantSession(input: {
  threadId: string;
  userId: string;
}): Promise<boolean> {
  const threadId = input.threadId.trim();
  const userId = input.userId.trim();
  if (!threadId || !userId) {
    return false;
  }

  await ensureAssistantSessionsTable();
  const rows = await db<{ thread_id: string }[]>`
    DELETE FROM assistant_sessions
    WHERE thread_id = ${threadId}
      AND user_id = ${userId}
    RETURNING thread_id
  `;

  return rows.length > 0;
}
