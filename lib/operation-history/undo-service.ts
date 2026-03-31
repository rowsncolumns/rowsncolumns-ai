/**
 * Undo Service for ShareDB Operations
 *
 * Provides undo/rollback capabilities for tracked operations.
 */

import type ShareDBClient from "sharedb/lib/client";
import {
  collectArrayOps,
  collectMapOps,
  collectSheetDataOps,
  type ShareDBOp,
} from "@rowsncolumns/sharedb/helpers";
import type { applyPatchesToShareDBDoc } from "@rowsncolumns/sharedb/helpers";
import {
  createOperationHistory,
  getLatestPendingOperation,
  getOperationHistoryById,
  markOperationReverted,
} from "./repository";
import { generateInverseRawOp } from "./inverse-op";
import type {
  OperationAttribution,
  OperationHistoryRecord,
  OperationPayload,
} from "./types";

type SpreadsheetPatchTuples = Parameters<typeof applyPatchesToShareDBDoc>[1];

function collectOpsFromPatchTuples(
  doc: ShareDBClient.Doc,
  patches: SpreadsheetPatchTuples,
  source: "agent" | "user" | "backend",
): ShareDBOp[] {
  const allOps: ShareDBOp[] = [];
  const recalcUserId = source ?? "agent";
  const recalcCellPatches: Array<{
    op: string;
    path: (string | number)[];
    value: unknown;
  }> = [];
  let recalcCellsLength = Array.isArray(doc.data?.recalcCells)
    ? doc.data.recalcCells.length
    : 0;

  const getSheetData = () => doc.data?.sheetData;

  for (const [patch, tupleType = "redo"] of patches) {
    const type = tupleType ?? "redo";
    const patchKey = type === "redo" ? "patches" : "inversePatches";

    if (patch.sheetData) {
      const ops = collectSheetDataOps(doc, patch.sheetData[patchKey], getSheetData);
      allOps.push(...ops);
    }
    if (patch.sheets) {
      allOps.push(...collectArrayOps(doc, "sheets", patch.sheets[patchKey]));
    }
    if (patch.tables) {
      allOps.push(...collectArrayOps(doc, "tables", patch.tables[patchKey]));
    }
    if (patch.embeds) {
      allOps.push(...collectArrayOps(doc, "embeds", patch.embeds[patchKey]));
    }
    if (patch.charts) {
      allOps.push(...collectArrayOps(doc, "charts", patch.charts[patchKey]));
    }
    if (patch.conditionalFormats) {
      allOps.push(
        ...collectArrayOps(doc, "conditionalFormats", patch.conditionalFormats[patchKey]),
      );
    }
    if (patch.dataValidations) {
      allOps.push(
        ...collectArrayOps(doc, "dataValidations", patch.dataValidations[patchKey]),
      );
    }
    if (patch.namedRanges) {
      allOps.push(...collectArrayOps(doc, "namedRanges", patch.namedRanges[patchKey]));
    }
    if (patch.sharedStrings) {
      allOps.push(...collectMapOps(doc, "sharedStrings", patch.sharedStrings[patchKey]));
    }
    if (patch.protectedRanges) {
      allOps.push(
        ...collectArrayOps(doc, "protectedRanges", patch.protectedRanges[patchKey]),
      );
    }
    if (patch.cellXfs) {
      allOps.push(...collectMapOps(doc, "cellXfs", patch.cellXfs[patchKey]));
    }

    if (patch.pivotTables) {
      if (!doc.data?.pivotTables) {
        allOps.push({ p: ["pivotTables"], oi: [] });
      }
      allOps.push(...collectArrayOps(doc, "pivotTables", patch.pivotTables[patchKey]));
    }
    if (patch.slicers) {
      if (!doc.data?.slicers) {
        allOps.push({ p: ["slicers"], oi: [] });
      }
      allOps.push(...collectArrayOps(doc, "slicers", patch.slicers[patchKey]));
    }
    if (patch.citations) {
      if (!doc.data?.citations) {
        allOps.push({ p: ["citations"], oi: [] });
      }
      allOps.push(...collectArrayOps(doc, "citations", patch.citations[patchKey]));
    }

    if (patch.recalcCells?.[type]) {
      recalcCellPatches.push({
        op: "add",
        path: [recalcCellsLength],
        value: {
          userId: recalcUserId,
          patches: Array.from(patch.recalcCells[type]).map((value: [unknown, unknown]) => [
            value[0],
            value[1],
            source ?? "agent",
          ]),
        },
      });
      recalcCellsLength += 1;
    }
  }

  if (recalcCellPatches.length > 0) {
    if (!Array.isArray(doc.data?.recalcCells)) {
      allOps.push({ p: ["recalcCells"], oi: [] });
    }
    allOps.push(
      ...collectArrayOps(
        doc,
        "recalcCells",
        recalcCellPatches as unknown as import("immer").Patch[],
      ),
    );
  }

  return allOps;
}

/**
 * Result of an undo operation.
 */
export interface UndoResult {
  success: boolean;
  operationId?: string;
  rollbackOperationId?: string;
  error?: string;
  versionFrom?: number;
  versionTo?: number;
}

export interface UndoAuditContext {
  confirmedByUser: boolean;
  reason?: string;
  confirmationMethod?: string;
  performedBy?: string;
}

/**
 * Undo the latest pending operation for a document.
 */
export async function undoLatestOperation(
  doc: ShareDBClient.Doc,
  attribution?: Partial<OperationAttribution>,
  auditContext?: UndoAuditContext,
): Promise<UndoResult> {
  const operation = await getLatestPendingOperation(doc.id);

  if (!operation) {
    return {
      success: false,
      error: "No pending operations to undo",
    };
  }

  return undoOperationById(doc, operation.id, attribution, auditContext);
}

/**
 * Undo a specific operation by ID.
 */
export async function undoOperationById(
  doc: ShareDBClient.Doc,
  operationId: string,
  attribution?: Partial<OperationAttribution>,
  auditContext?: UndoAuditContext,
): Promise<UndoResult> {
  // Fetch the operation
  const operation = await getOperationHistoryById(operationId);

  if (!operation) {
    return {
      success: false,
      operationId,
      error: "Operation not found",
    };
  }

  // Validate document
  if (operation.docId !== doc.id) {
    return {
      success: false,
      operationId,
      error: "Operation belongs to a different document",
    };
  }

  // Check if already reverted
  if (operation.revertedAt) {
    return {
      success: false,
      operationId,
      error: "Operation already reverted",
    };
  }

  const inversePayload = operation.operationPayload?.inverse?.data;
  let inverseOp: Array<Record<string, unknown>> | null = null;
  let forwardReapplyOp: Array<Record<string, unknown>> | null = null;

  if (operation.operationKind === "raw_op") {
    if (Array.isArray(inversePayload)) {
      inverseOp = inversePayload as Array<Record<string, unknown>>;
      if (Array.isArray(operation.operationPayload.forward?.data)) {
        forwardReapplyOp = operation.operationPayload.forward
          .data as Array<Record<string, unknown>>;
      }
    }
  } else if (operation.operationKind === "patch_tuples") {
    if (Array.isArray(inversePayload)) {
      const converted = collectOpsFromPatchTuples(
        doc,
        inversePayload as SpreadsheetPatchTuples,
        operation.source,
      );
      if (converted.length > 0) {
        inverseOp = converted as Array<Record<string, unknown>>;
      }
    }
  }

  if (!inverseOp || !Array.isArray(inverseOp) || inverseOp.length === 0) {
    // Provide more detail for debugging
    const hasPayload = !!operation.operationPayload;
    const hasInverse = !!operation.operationPayload?.inverse;
    const hasData = !!operation.operationPayload?.inverse?.data;
    const dataType = operation.operationPayload?.inverse?.data
      ? typeof operation.operationPayload.inverse.data
      : "undefined";
    console.error(
      `[undo] Cannot undo operation ${operationId}: kind=${operation.operationKind}, hasPayload=${hasPayload}, hasInverse=${hasInverse}, hasData=${hasData}, dataType=${dataType}`,
    );

    return {
      success: false,
      operationId,
      error: `Cannot generate inverse operation - operation is not invertible (kind: ${operation.operationKind})`,
    };
  }

  const versionFrom = doc.version ?? 0;

  // Apply inverse operation
  try {
    await new Promise<void>((resolve, reject) => {
      doc.submitOp(inverseOp, {}, (err?: unknown) => {
        if (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        } else {
          resolve();
        }
      });
    });
  } catch (error) {
    return {
      success: false,
      operationId,
      error: `Failed to apply inverse operation: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const versionTo = doc.version ?? 0;

  if (!forwardReapplyOp && operation.operationKind === "patch_tuples") {
    const forwardPayload = operation.operationPayload?.forward?.data;
    if (Array.isArray(forwardPayload)) {
      const convertedForward = collectOpsFromPatchTuples(
        doc,
        forwardPayload as SpreadsheetPatchTuples,
        operation.source,
      );
      if (convertedForward.length > 0) {
        forwardReapplyOp = convertedForward as Array<Record<string, unknown>>;
      }
    }
  }

  if (!forwardReapplyOp || forwardReapplyOp.length === 0) {
    forwardReapplyOp = generateInverseRawOp(inverseOp) ?? [];
  }

  // Create rollback operation history (rollback is an activity itself)
  const rollbackAttribution: OperationAttribution = {
    source: attribution?.source ?? "backend",
    actorType: attribution?.actorType ?? "system",
    actorId: attribution?.actorId ?? "undo-service",
    threadId: attribution?.threadId,
    userId: attribution?.userId,
    runId: attribution?.runId,
    toolName: attribution?.toolName,
    toolCallId: attribution?.toolCallId,
    sessionId: attribution?.sessionId,
  };

  // Persist rollback payload as raw json0 ops so legacy patch_tuples rows remain
  // rollbackable in future operations.
  const rollbackPayload: OperationPayload = {
    forward: {
      kind: "raw_op",
      data: inverseOp,
    },
    inverse: {
      kind: "raw_op",
      data: forwardReapplyOp,
    },
  };

  const rollbackRecord = await createOperationHistory({
    collection: operation.collection,
    docId: operation.docId,
    attribution: rollbackAttribution,
    activityType: "rollback",
    sharedbVersionFrom: versionFrom,
    sharedbVersionTo: versionTo,
    operationPayload: rollbackPayload,
    targetOperationIds: [operationId],
    metadata: {
      rollbackMode: "manual",
      confirmedByUser: auditContext?.confirmedByUser ?? false,
      confirmationMethod:
        auditContext?.confirmationMethod ?? "explicit_ui_confirmation",
      ...(auditContext?.performedBy
        ? { performedBy: auditContext.performedBy }
        : {}),
      ...(auditContext?.reason ? { rollbackReason: auditContext.reason } : {}),
    },
  });

  // Mark original operation as reverted
  await markOperationReverted(
    operationId,
    rollbackRecord.id,
    versionFrom,
    versionTo,
  );

  return {
    success: true,
    operationId,
    rollbackOperationId: rollbackRecord.id,
    versionFrom,
    versionTo,
  };
}

/**
 * Undo multiple operations (in reverse chronological order).
 */
export async function undoOperations(
  doc: ShareDBClient.Doc,
  operationIds: string[],
  attribution?: Partial<OperationAttribution>,
  auditContext?: UndoAuditContext,
): Promise<UndoResult[]> {
  const results: UndoResult[] = [];

  // Process in order (caller should provide in reverse chronological order)
  for (const operationId of operationIds) {
    const result = await undoOperationById(
      doc,
      operationId,
      attribution,
      auditContext,
    );
    results.push(result);

    // Stop on first failure
    if (!result.success) {
      break;
    }
  }

  return results;
}

/**
 * Check if an operation can be undone.
 */
export async function canUndoOperation(operationId: string): Promise<{
  canUndo: boolean;
  reason?: string;
}> {
  const operation = await getOperationHistoryById(operationId);

  if (!operation) {
    return { canUndo: false, reason: "Operation not found" };
  }

  if (operation.revertedAt) {
    return { canUndo: false, reason: "Operation already reverted" };
  }

  if (
    !Array.isArray(operation.operationPayload.inverse?.data) ||
    operation.operationPayload.inverse.data.length === 0
  ) {
    return { canUndo: false, reason: "Operation is not invertible" };
  }

  return { canUndo: true };
}

/**
 * Preview what undoing an operation would do (without actually applying it).
 */
export async function previewUndo(operationId: string): Promise<{
  operation: OperationHistoryRecord | null;
  inverseOp: unknown;
  canUndo: boolean;
  reason?: string;
}> {
  const operation = await getOperationHistoryById(operationId);

  if (!operation) {
    return {
      operation: null,
      inverseOp: null,
      canUndo: false,
      reason: "Operation not found",
    };
  }

  const { canUndo, reason } = await canUndoOperation(operationId);

  return {
    operation,
    inverseOp: operation.operationPayload.inverse?.data ?? null,
    canUndo,
    reason,
  };
}
