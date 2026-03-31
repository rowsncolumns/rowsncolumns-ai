/**
 * Types for ShareDB Operation History and Attribution
 */

export type OperationSource = "agent" | "user" | "backend";
export type ActivityType = "write" | "rollback" | "restore";
export type OperationKind = "patch_tuples" | "raw_op";
export type ChangeKind = "insert" | "update" | "delete" | "format" | "structure";
export type PayloadStorage = "inline" | "s3";

export interface ActivityDiffSheetImpact {
  sheetId: string;
  cellCount: number;
  a1Range: string;
  sampleCells: string[];
}

export interface ActivityDiffSummary {
  totalOps: number;
  changedCellCount: number;
  sheets: ActivityDiffSheetImpact[];
  structuralChanges: string[];
}

/**
 * Attribution context for tracking who/what performed an operation.
 */
export interface OperationAttribution {
  source: OperationSource;
  actorType: string; // e.g., "assistant", "user", "system", "job"
  actorId: string; // e.g., "asst_abc123", "user_xyz", "job_cleanup"

  // Optional extended context
  threadId?: string;
  userId?: string; // The user who triggered the agent (if source=agent)
  runId?: string;
  toolName?: string;
  toolCallId?: string;
  sessionId?: string;
}

/**
 * Operation payload containing forward and inverse operations.
 */
export interface OperationPayload {
  // The forward operation that was applied
  forward: {
    kind: OperationKind;
    data: unknown; // patch tuples or raw json0 op
  };

  // The inverse operation for undo
  inverse: {
    kind: OperationKind;
    data: unknown;
  };
}

/**
 * Extended metadata stored as JSONB.
 */
export interface OperationMetadata {
  threadId?: string;
  userId?: string;
  runId?: string;
  toolName?: string;
  toolCallId?: string;
  sessionId?: string;
  [key: string]: unknown; // Allow additional metadata
}

/**
 * Custom attribution key-value pair.
 */
export interface CustomAttribution {
  k: string;
  v: string;
}

/**
 * Content selector for fine-grained attribution.
 */
export interface ContentSelector {
  sheetId?: string;
  selector: string; // e.g., "sheet:1!A1:C4", "properties.title"
  changeKind: ChangeKind;
}

/**
 * Input for creating a new operation history record.
 */
export interface CreateOperationHistoryInput {
  collection: string;
  docId: string;

  // Attribution
  attribution: OperationAttribution;

  // Activity type
  activityType?: ActivityType;

  // Version tracking
  sharedbVersionFrom: number;
  sharedbVersionTo: number;

  // Operation data
  operationPayload: OperationPayload;

  // Optional: for rollback/restore operations
  targetOperationIds?: string[];

  // Optional: custom attributions
  customAttributions?: CustomAttribution[];

  // Optional: content selectors for fine-grained tracking
  contentSelectors?: ContentSelector[];

  // Optional: extra metadata fields for audit/compliance
  metadata?: OperationMetadata;
}

/**
 * Database row for agent_operation_history.
 */
export interface OperationHistoryRow {
  id: string;
  collection: string;
  doc_id: string;
  source: OperationSource;
  actor_type: string;
  actor_id: string;
  activity_type: ActivityType;
  sharedb_version_from: number;
  sharedb_version_to: number;
  operation_kind: OperationKind;
  operation_payload: OperationPayload | string;
  metadata: OperationMetadata | string;
  target_operation_ids: string[];
  created_at: Date | string;
  reverted_at: Date | string | null;
  reverted_by_operation_id: string | null;
  revert_sharedb_version_from: number | null;
  revert_sharedb_version_to: number | null;
  payload_storage: PayloadStorage;
  payload_s3_key: string | null;
  payload_bytes: number | null;
}

/**
 * Application-level operation history record.
 */
export interface OperationHistoryRecord {
  id: string;
  collection: string;
  docId: string;
  source: OperationSource;
  actorType: string;
  actorId: string;
  activityType: ActivityType;
  sharedbVersionFrom: number;
  sharedbVersionTo: number;
  operationKind: OperationKind;
  operationPayload: OperationPayload;
  metadata: OperationMetadata;
  targetOperationIds: string[];
  createdAt: string;
  revertedAt: string | null;
  revertedByOperationId: string | null;
  revertSharedbVersionFrom: number | null;
  revertSharedbVersionTo: number | null;
  payloadStorage: PayloadStorage;
}

/**
 * Activity item for API responses (lightweight version).
 */
export interface ActivityItem {
  id: string;
  docId: string;
  source: OperationSource;
  actorType: string;
  actorId: string;
  activityType: ActivityType;
  sharedbVersionFrom: number;
  sharedbVersionTo: number;
  metadata: OperationMetadata;
  createdAt: string;
  revertedAt: string | null;
  isRevertable: boolean;
  diffSummary: ActivityDiffSummary | null;
}

/**
 * Pagination cursor for activity listing.
 */
export interface ActivityCursor {
  createdAt: string;
  id: string;
}

/**
 * Filters for listing activities.
 */
export interface ListActivitiesFilters {
  from?: string; // ISO timestamp
  to?: string; // ISO timestamp
  by?: string; // actor_id filter
  activityTypes?: ActivityType[];
  sources?: OperationSource[];
}

/**
 * Result of listing activities.
 */
export interface ListActivitiesResult {
  items: ActivityItem[];
  nextCursor: string | null;
}
