/**
 * Tracked ShareDB Submit Operation
 *
 * Wraps doc.submitOp to capture version info and persist operation history.
 * This is the centralized write path for all ShareDB mutations.
 */

import type ShareDBClient from "sharedb/lib/client";
import { getFlags, isTrackingEnabledForSource } from "@/lib/feature-flags";
import { resolveAuditHistoryAccess } from "./access";
import { generateInverseRawOp } from "./inverse-op";
import { createOperationHistory } from "./repository";
import { getOperationHistoryRuntimeContext } from "./runtime-context";
import type {
  ContentSelector,
  CustomAttribution,
  OperationAttribution,
  OperationPayload,
} from "./types";

// Re-export for convenience
export type { OperationAttribution, CustomAttribution, ContentSelector };

/**
 * Logger interface for tracking errors/warnings.
 */
interface Logger {
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
  info: (message: string, ...args: unknown[]) => void;
}

const defaultLogger: Logger = {
  warn: console.warn,
  error: console.error,
  info: console.info,
};

/**
 * Options for tracked submit operation.
 */
export interface TrackedSubmitOptions {
  /** ShareDB source for OT (passed to submitOp) */
  source?: unknown;

  /** Custom attributions (k/v pairs) */
  customAttributions?: CustomAttribution[];

  /** Content selectors for fine-grained tracking */
  contentSelectors?: ContentSelector[];

  /** Logger for tracking errors */
  logger?: Logger;

  /** Override operation kind (auto-detected if not provided) */
  operationKind?: "patch_tuples" | "raw_op";
}

/**
 * Result of a tracked submit operation.
 */
export interface TrackedSubmitResult {
  /** Whether the submit succeeded */
  success: boolean;

  /** Version before the operation */
  versionFrom: number;

  /** Version after the operation */
  versionTo: number;

  /** Operation history ID (if tracking was enabled and succeeded) */
  operationHistoryId?: string;

  /** Error if submit failed */
  error?: Error;
}

/**
 * Submit an operation to ShareDB with tracking.
 *
 * This is the main entry point for all tracked writes.
 * It ensures operations are attributed and can be undone.
 */
export async function trackedSubmitOp(
  doc: ShareDBClient.Doc,
  op: Array<Record<string, unknown>>,
  attribution: OperationAttribution,
  options: TrackedSubmitOptions = {}
): Promise<TrackedSubmitResult> {
  const {
    source,
    customAttributions,
    contentSelectors,
    logger = defaultLogger,
    operationKind = "raw_op",
  } = options;

  const flags = getFlags();
  const collection = doc.collection;
  const docId = doc.id;
  const versionFrom = doc.version ?? 0;

  // Always submit the operation first (non-blocking tracking)
  try {
    await new Promise<void>((resolve, reject) => {
      doc.submitOp(op, source ? { source } : {}, (err?: unknown) => {
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
      versionFrom,
      versionTo: versionFrom,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }

  const versionTo = doc.version ?? 0;

  // Check if tracking is enabled for this source
  const trackingEnabledForSource = isTrackingEnabledForSource(
    attribution.source,
    flags,
  );

  if (!trackingEnabledForSource) {
    return {
      success: true,
      versionFrom,
      versionTo,
    };
  }

  // Enforce entitlement gating (Max/Admin only) to avoid history DB growth
  // from free/pro traffic. Runtime context is established per chat run.
  const runtimeContext = getOperationHistoryRuntimeContext();
  let trackingAllowed = runtimeContext?.trackingAllowed;

  if (trackingAllowed === undefined) {
    const resolvedUserId = attribution.userId ?? runtimeContext?.userId;
    if (!resolvedUserId) {
      trackingAllowed = false;
    } else {
      const access = await resolveAuditHistoryAccess({ userId: resolvedUserId });
      trackingAllowed = access.allowed;
    }
  }

  if (!trackingAllowed) {
    return {
      success: true,
      versionFrom,
      versionTo,
    };
  }

  // Generate inverse operation for undo capability
  const inverseOp = generateInverseRawOp(op);

  const operationPayload: OperationPayload = {
    forward: {
      kind: operationKind,
      data: op,
    },
    inverse: {
      kind: operationKind,
      data: inverseOp,
    },
  };

  // Persist operation history based on tracking mode
  const trackingPromise = createOperationHistory({
    collection,
    docId,
    attribution,
    activityType: "write",
    sharedbVersionFrom: versionFrom,
    sharedbVersionTo: versionTo,
    operationPayload,
    customAttributions,
    contentSelectors,
  });

  let operationHistoryId: string | undefined;

  if (flags.trackingMode === "shadow") {
    // Shadow mode: log failures but don't surface them
    trackingPromise
      .then((record) => {
        logger.info(`[shadow] Operation tracked: ${record.id}`);
        operationHistoryId = record.id;
      })
      .catch((err) => {
        logger.warn("[shadow] Tracking failed (non-blocking)", err);
      });
  } else if (flags.trackingMode === "async") {
    // Async mode: log errors but don't block
    trackingPromise
      .then((record) => {
        operationHistoryId = record.id;
      })
      .catch((err) => {
        logger.error("[async] Tracking failed", err);
      });
  } else if (flags.trackingMode === "blocking") {
    // Blocking mode: tracking must succeed (use with caution)
    try {
      const record = await trackingPromise;
      operationHistoryId = record.id;
    } catch (err) {
      logger.error("[blocking] Tracking failed", err);
      // Note: The write already succeeded, we just couldn't track it
      // In a stricter implementation, you might want to compensate here
    }
  }

  return {
    success: true,
    versionFrom,
    versionTo,
    operationHistoryId,
  };
}

/**
 * Default attribution for backend/system operations.
 */
export const BACKEND_ATTRIBUTION: OperationAttribution = {
  source: "backend",
  actorType: "system",
  actorId: "sharedb-system",
};

/**
 * Create agent attribution from context.
 */
export function createAgentAttribution(context: {
  actorId?: string;
  threadId?: string;
  userId?: string;
  runId?: string;
  toolName?: string;
  toolCallId?: string;
}): OperationAttribution {
  return {
    source: "agent",
    actorType: "assistant",
    actorId: context.actorId ?? "unknown-assistant",
    threadId: context.threadId,
    userId: context.userId,
    runId: context.runId,
    toolName: context.toolName,
    toolCallId: context.toolCallId,
  };
}

/**
 * Create user attribution from context.
 */
export function createUserAttribution(context: {
  userId: string;
  sessionId?: string;
}): OperationAttribution {
  return {
    source: "user",
    actorType: "user",
    actorId: context.userId,
    sessionId: context.sessionId,
  };
}
