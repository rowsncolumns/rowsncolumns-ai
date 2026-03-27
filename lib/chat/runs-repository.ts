import { db } from "@/lib/db/postgres";
import type { ChatStreamEvent } from "@/lib/chat/protocol";

export type ChatRunStatus = "running" | "completed" | "failed";

export type ChatRunRecord = {
  runId: string;
  threadId: string;
  userId: string;
  status: ChatRunStatus;
  errorMessage?: string;
  startedAt: string;
  completedAt?: string;
};

export type ChatRunEventRecord = {
  id: number;
  runId: string;
  eventType: string;
  eventData: ChatStreamEvent;
  createdAt: string;
};

let ensureTablesPromise: Promise<void> | null = null;

const ensureTables = async () => {
  if (!ensureTablesPromise) {
    ensureTablesPromise = (async () => {
      await db`
        CREATE TABLE IF NOT EXISTS chat_runs (
          run_id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'running',
          error_message TEXT,
          started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          completed_at TIMESTAMPTZ
        )
      `;
      await db`
        CREATE INDEX IF NOT EXISTS chat_runs_thread_idx
          ON chat_runs (thread_id, started_at DESC)
      `;
      await db`
        CREATE INDEX IF NOT EXISTS chat_runs_user_idx
          ON chat_runs (user_id, started_at DESC)
      `;
      await db`
        CREATE TABLE IF NOT EXISTS chat_run_events (
          id BIGSERIAL PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES chat_runs(run_id) ON DELETE CASCADE,
          event_type TEXT NOT NULL,
          event_data JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await db`
        CREATE INDEX IF NOT EXISTS chat_run_events_run_idx
          ON chat_run_events (run_id, id ASC)
      `;
    })().catch((error) => {
      ensureTablesPromise = null;
      throw error;
    });
  }

  await ensureTablesPromise;
};

export async function createChatRun(input: {
  runId: string;
  threadId: string;
  userId: string;
}): Promise<void> {
  await ensureTables();
  await db`
    INSERT INTO chat_runs (run_id, thread_id, user_id, status)
    VALUES (${input.runId}, ${input.threadId}, ${input.userId}, 'running')
    ON CONFLICT (run_id) DO NOTHING
  `;
}

export async function completeChatRun(input: {
  runId: string;
  status: "completed" | "failed";
  errorMessage?: string;
}): Promise<void> {
  await ensureTables();
  await db`
    UPDATE chat_runs
    SET
      status = ${input.status},
      error_message = ${input.errorMessage ?? null},
      completed_at = NOW()
    WHERE run_id = ${input.runId}
  `;
}

export async function appendChatRunEvent(input: {
  runId: string;
  event: ChatStreamEvent;
}): Promise<number> {
  await ensureTables();
  const rows = await db<{ id: string }[]>`
    INSERT INTO chat_run_events (run_id, event_type, event_data)
    VALUES (${input.runId}, ${input.event.type}, ${JSON.stringify(input.event)})
    RETURNING id
  `;
  return Number(rows[0]?.id ?? 0);
}

export async function getChatRun(input: {
  runId: string;
  userId: string;
}): Promise<ChatRunRecord | null> {
  await ensureTables();
  const rows = await db<
    {
      run_id: string;
      thread_id: string;
      user_id: string;
      status: string;
      error_message: string | null;
      started_at: Date | string;
      completed_at: Date | string | null;
    }[]
  >`
    SELECT run_id, thread_id, user_id, status, error_message, started_at, completed_at
    FROM chat_runs
    WHERE run_id = ${input.runId}
      AND user_id = ${input.userId}
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) return null;

  return {
    runId: row.run_id,
    threadId: row.thread_id,
    userId: row.user_id,
    status: row.status as ChatRunStatus,
    ...(row.error_message ? { errorMessage: row.error_message } : {}),
    startedAt: new Date(row.started_at).toISOString(),
    ...(row.completed_at
      ? { completedAt: new Date(row.completed_at).toISOString() }
      : {}),
  };
}

export async function getLatestChatRunForThread(input: {
  threadId: string;
  userId: string;
}): Promise<ChatRunRecord | null> {
  await ensureTables();
  const rows = await db<
    {
      run_id: string;
      thread_id: string;
      user_id: string;
      status: string;
      error_message: string | null;
      started_at: Date | string;
      completed_at: Date | string | null;
    }[]
  >`
    SELECT run_id, thread_id, user_id, status, error_message, started_at, completed_at
    FROM chat_runs
    WHERE thread_id = ${input.threadId}
      AND user_id = ${input.userId}
    ORDER BY started_at DESC
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) return null;

  return {
    runId: row.run_id,
    threadId: row.thread_id,
    userId: row.user_id,
    status: row.status as ChatRunStatus,
    ...(row.error_message ? { errorMessage: row.error_message } : {}),
    startedAt: new Date(row.started_at).toISOString(),
    ...(row.completed_at
      ? { completedAt: new Date(row.completed_at).toISOString() }
      : {}),
  };
}

export async function getChatRunEvents(input: {
  runId: string;
  afterEventId?: number;
  limit?: number;
}): Promise<ChatRunEventRecord[]> {
  await ensureTables();
  const afterId = input.afterEventId ?? 0;
  const limit = Math.min(input.limit ?? 1000, 5000);

  const rows = await db<
    {
      id: string;
      run_id: string;
      event_type: string;
      event_data: unknown;
      created_at: Date | string;
    }[]
  >`
    SELECT id, run_id, event_type, event_data, created_at
    FROM chat_run_events
    WHERE run_id = ${input.runId}
      AND id > ${afterId}
    ORDER BY id ASC
    LIMIT ${limit}
  `;

  return rows.map((row) => ({
    id: Number(row.id),
    runId: row.run_id,
    eventType: row.event_type,
    eventData: row.event_data as ChatStreamEvent,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

export async function cleanupOldChatRuns(input: {
  olderThanHours?: number;
}): Promise<number> {
  await ensureTables();
  const hours = input.olderThanHours ?? 24;

  const rows = await db<{ run_id: string }[]>`
    DELETE FROM chat_runs
    WHERE completed_at < NOW() - INTERVAL '${hours} hours'
    RETURNING run_id
  `;

  return rows.length;
}
