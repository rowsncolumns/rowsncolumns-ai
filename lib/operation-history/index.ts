/**
 * ShareDB Operation History Module
 *
 * Provides attribution, versioning, and undo capabilities for ShareDB operations.
 *
 * Usage:
 * ```typescript
 * import {
 *   trackedSubmitOp,
 *   createAgentAttribution,
 *   undoLatestOperation,
 *   listActivities,
 * } from "@/lib/operation-history";
 *
 * // Track an operation
 * const result = await trackedSubmitOp(doc, ops, createAgentAttribution({
 *   actorId: "asst_123",
 *   toolName: "spreadsheet_changeBatch",
 *   toolCallId: "call_456",
 * }));
 *
 * // Undo the latest operation
 * const undoResult = await undoLatestOperation(doc);
 *
 * // List activity history
 * const activities = await listActivities(docId, 20);
 * ```
 */

// Types
export type {
  ActivityCursor,
  ActivityItem,
  ActivityType,
  ChangeKind,
  ContentSelector,
  CreateOperationHistoryInput,
  CustomAttribution,
  ListActivitiesFilters,
  ListActivitiesResult,
  OperationAttribution,
  OperationHistoryRecord,
  OperationKind,
  OperationMetadata,
  OperationPayload,
  OperationSource,
  PayloadStorage,
} from "./types";

// Repository functions
export {
  countActivities,
  createOperationHistory,
  deleteOperationHistoryForDocument,
  getLatestPendingOperation,
  getOperationHistoryById,
  listActivities,
  markOperationReverted,
} from "./repository";

// Tracked submit wrapper
export {
  BACKEND_ATTRIBUTION,
  createAgentAttribution,
  createUserAttribution,
  trackedSubmitOp,
  type TrackedSubmitOptions,
  type TrackedSubmitResult,
} from "./tracked-submit";

// Undo service
export {
  canUndoOperation,
  previewUndo,
  undoLatestOperation,
  undoOperationById,
  undoOperations,
  type UndoResult,
} from "./undo-service";
