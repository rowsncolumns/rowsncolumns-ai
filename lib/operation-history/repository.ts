/**
 * Repository for ShareDB Operation History
 *
 * Handles persistence of operation history, content indexes, and custom attributions.
 */

import { db } from "@/lib/db/postgres";
import { buildDiffSummary, isOperationInvertible } from "./diff-summary";
import type {
  ActivityItem,
  ActivityCursor,
  CreateOperationHistoryInput,
  ListActivitiesFilters,
  ListActivitiesResult,
  OperationMetadata,
  OperationPayload,
  OperationHistoryRecord,
  OperationHistoryRow,
} from "./types";

function parseJsonbValue<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) {
    return fallback;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }

  if (typeof value === "object") {
    return value as T;
  }

  return fallback;
}


/**
 * Map database row to application record.
 */
function mapRowToRecord(row: OperationHistoryRow): OperationHistoryRecord {
  const operationPayload = parseJsonbValue<OperationPayload>(
    row.operation_payload,
    {
      forward: {
        kind: row.operation_kind,
        data: null,
      },
      inverse: {
        kind: row.operation_kind,
        data: null,
      },
    }
  );

  const metadata = parseJsonbValue<OperationMetadata>(row.metadata, {});

  return {
    id: row.id,
    collection: row.collection,
    docId: row.doc_id,
    source: row.source,
    actorType: row.actor_type,
    actorId: row.actor_id,
    activityType: row.activity_type,
    sharedbVersionFrom: row.sharedb_version_from,
    sharedbVersionTo: row.sharedb_version_to,
    operationKind: row.operation_kind,
    operationPayload,
    metadata,
    targetOperationIds: row.target_operation_ids ?? [],
    createdAt: new Date(row.created_at).toISOString(),
    revertedAt: row.reverted_at ? new Date(row.reverted_at).toISOString() : null,
    revertedByOperationId: row.reverted_by_operation_id,
    revertSharedbVersionFrom: row.revert_sharedb_version_from,
    revertSharedbVersionTo: row.revert_sharedb_version_to,
    payloadStorage: row.payload_storage,
  };
}

/**
 * Map database row to lightweight activity item.
 */
function mapRowToActivityItem(row: OperationHistoryRow): ActivityItem {
  const operationPayload = parseJsonbValue<OperationPayload>(
    row.operation_payload,
    {
      forward: {
        kind: row.operation_kind,
        data: null,
      },
      inverse: {
        kind: row.operation_kind,
        data: null,
      },
    }
  );
  const metadata = parseJsonbValue<OperationMetadata>(row.metadata, {});
  const isRevertable =
    row.reverted_at === null && isOperationInvertible(operationPayload);
  const diffSummary = buildDiffSummary(row.operation_kind, operationPayload);

  return {
    id: row.id,
    docId: row.doc_id,
    source: row.source,
    actorType: row.actor_type,
    actorId: row.actor_id,
    activityType: row.activity_type,
    sharedbVersionFrom: row.sharedb_version_from,
    sharedbVersionTo: row.sharedb_version_to,
    metadata,
    createdAt: new Date(row.created_at).toISOString(),
    revertedAt: row.reverted_at ? new Date(row.reverted_at).toISOString() : null,
    isRevertable,
    diffSummary,
  };
}

/**
 * Create a new operation history record.
 */
export async function createOperationHistory(
  input: CreateOperationHistoryInput
): Promise<OperationHistoryRecord> {
  const {
    collection,
    docId,
    attribution,
    activityType = "write",
    sharedbVersionFrom,
    sharedbVersionTo,
    operationPayload,
    targetOperationIds,
    customAttributions,
    contentSelectors,
    metadata: inputMetadata,
  } = input;

  // Build metadata from attribution
  const metadata = {
    threadId: attribution.threadId,
    userId: attribution.userId,
    runId: attribution.runId,
    toolName: attribution.toolName,
    toolCallId: attribution.toolCallId,
    sessionId: attribution.sessionId,
    ...(inputMetadata ?? {}),
  };

  // Calculate payload size for potential S3 offloading (future)
  const payloadJson = JSON.stringify(operationPayload);
  const payloadBytes = Buffer.byteLength(payloadJson, "utf8");
  const metadataJson = JSON.stringify(metadata);

  // For now, always store inline (S3 offloading is Phase 2)
  const payloadStorage = "inline" as const;

  const rows = await db<OperationHistoryRow[]>`
    INSERT INTO agent_operation_history (
      collection,
      doc_id,
      source,
      actor_type,
      actor_id,
      activity_type,
      sharedb_version_from,
      sharedb_version_to,
      operation_kind,
      operation_payload,
      metadata,
      target_operation_ids,
      payload_storage,
      payload_bytes
    ) VALUES (
      ${collection},
      ${docId},
      ${attribution.source},
      ${attribution.actorType},
      ${attribution.actorId},
      ${activityType},
      ${sharedbVersionFrom},
      ${sharedbVersionTo},
      ${operationPayload.forward.kind},
      ${db.json(JSON.parse(payloadJson))},
      ${db.json(JSON.parse(metadataJson))},
      ${targetOperationIds ?? []},
      ${payloadStorage},
      ${payloadBytes}
    )
    RETURNING *
  `;

  const row = rows[0];
  if (!row) {
    throw new Error("Failed to create operation history record");
  }

  // Persist custom attributions if provided
  if (customAttributions && customAttributions.length > 0) {
    await persistCustomAttributions(row.id, customAttributions);
  }

  // Persist content selectors if provided
  if (contentSelectors && contentSelectors.length > 0) {
    await persistContentSelectors(row.id, docId, contentSelectors);
  }

  return mapRowToRecord(row);
}

/**
 * Persist custom attribution key-value pairs.
 */
async function persistCustomAttributions(
  operationId: string,
  attributions: Array<{ k: string; v: string }>
): Promise<void> {
  if (attributions.length === 0) return;

  const values = attributions.map((a) => ({
    operation_id: operationId,
    k: a.k,
    v: a.v,
  }));

  await db`
    INSERT INTO agent_operation_attributions ${db(values)}
  `;
}

/**
 * Persist content selectors for fine-grained attribution.
 */
async function persistContentSelectors(
  operationId: string,
  docId: string,
  selectors: Array<{ sheetId?: string; selector: string; changeKind: string }>
): Promise<void> {
  if (selectors.length === 0) return;

  const values = selectors.map((s) => ({
    operation_id: operationId,
    doc_id: docId,
    sheet_id: s.sheetId ?? null,
    content_selector: s.selector,
    change_kind: s.changeKind,
  }));

  await db`
    INSERT INTO agent_operation_content_index ${db(values)}
  `;
}

/**
 * Get an operation history record by ID.
 */
export async function getOperationHistoryById(
  operationId: string
): Promise<OperationHistoryRecord | null> {
  const rows = await db<OperationHistoryRow[]>`
    SELECT * FROM agent_operation_history
    WHERE id = ${operationId}
  `;

  const row = rows[0];
  return row ? mapRowToRecord(row) : null;
}

/**
 * Get the latest pending (unreversed) operation for a document.
 */
export async function getLatestPendingOperation(
  docId: string
): Promise<OperationHistoryRecord | null> {
  const rows = await db<OperationHistoryRow[]>`
    SELECT * FROM agent_operation_history
    WHERE doc_id = ${docId}
      AND reverted_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1
  `;

  const row = rows[0];
  return row ? mapRowToRecord(row) : null;
}

/**
 * Mark an operation as reverted.
 */
export async function markOperationReverted(
  operationId: string,
  revertedByOperationId: string,
  revertSharedbVersionFrom: number,
  revertSharedbVersionTo: number
): Promise<void> {
  await db`
    UPDATE agent_operation_history
    SET
      reverted_at = NOW(),
      reverted_by_operation_id = ${revertedByOperationId},
      revert_sharedb_version_from = ${revertSharedbVersionFrom},
      revert_sharedb_version_to = ${revertSharedbVersionTo}
    WHERE id = ${operationId}
  `;
}

/**
 * List activities for a document with pagination and filters.
 */
export async function listActivities(
  docId: string,
  limit: number = 20,
  cursor?: string,
  filters?: ListActivitiesFilters
): Promise<ListActivitiesResult> {
  // Parse cursor if provided
  let cursorData: ActivityCursor | null = null;
  if (cursor) {
    try {
      cursorData = JSON.parse(Buffer.from(cursor, "base64").toString("utf8"));
    } catch {
      // Invalid cursor, ignore
    }
  }

  // Fetch one extra to determine if there are more results
  const fetchLimit = limit + 1;

  const rows = await db<OperationHistoryRow[]>`
    SELECT * FROM agent_operation_history
    WHERE doc_id = ${docId}
      ${cursorData ? db`AND (created_at, id) < (${cursorData.createdAt}, ${cursorData.id})` : db``}
      ${filters?.from ? db`AND created_at >= ${filters.from}` : db``}
      ${filters?.to ? db`AND created_at <= ${filters.to}` : db``}
      ${filters?.by ? db`AND actor_id = ${filters.by}` : db``}
      ${filters?.activityTypes?.length ? db`AND activity_type = ANY(${filters.activityTypes})` : db``}
      ${filters?.sources?.length ? db`AND source = ANY(${filters.sources})` : db``}
    ORDER BY created_at DESC, id DESC
    LIMIT ${fetchLimit}
  `;

  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map(mapRowToActivityItem);

  let nextCursor: string | null = null;
  if (hasMore && items.length > 0) {
    const lastItem = items[items.length - 1];
    const cursorObj: ActivityCursor = {
      createdAt: lastItem.createdAt,
      id: lastItem.id,
    };
    nextCursor = Buffer.from(JSON.stringify(cursorObj)).toString("base64");
  }

  return { items, nextCursor };
}

/**
 * Count total activities for a document.
 */
export async function countActivities(
  docId: string,
  filters?: ListActivitiesFilters
): Promise<number> {
  const results = await db<Array<{ count: string }>>`
    SELECT COUNT(*) as count FROM agent_operation_history
    WHERE doc_id = ${docId}
      ${filters?.from ? db`AND created_at >= ${filters.from}` : db``}
      ${filters?.to ? db`AND created_at <= ${filters.to}` : db``}
      ${filters?.by ? db`AND actor_id = ${filters.by}` : db``}
      ${filters?.activityTypes?.length ? db`AND activity_type = ANY(${filters.activityTypes})` : db``}
      ${filters?.sources?.length ? db`AND source = ANY(${filters.sources})` : db``}
  `;

  const result = results[0];
  return result ? parseInt(result.count, 10) : 0;
}

/**
 * Delete all operation history for a document (for testing/cleanup).
 */
export async function deleteOperationHistoryForDocument(
  docId: string
): Promise<void> {
  await db`
    DELETE FROM agent_operation_history
    WHERE doc_id = ${docId}
  `;
}
