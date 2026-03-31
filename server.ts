import http, { type IncomingMessage } from "http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { config as loadEnv } from "dotenv";
import ShareDB from "sharedb";
import { WebSocketServer, WebSocket } from "ws";
import { createClient } from "redis";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const WebSocketJSONStream = require("websocket-json-stream") as new (
  ws: WebSocket,
) => unknown;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const createShareDBRedisPubSub = require("sharedb-redis-pubsub") as (options: {
  client: ReturnType<typeof createClient>;
  prefix?: string;
}) => unknown;
import { getFlags, isTrackingEnabledForSource } from "./lib/feature-flags";
import { ensureDocumentAccess } from "./lib/documents/repository";
import { verifyMcpShareDbAccessToken } from "./lib/sharedb/mcp-token";
import { verifyShareDbWsAccessToken } from "./lib/sharedb/ws-token";
import { resolveAuditHistoryAccess } from "./lib/operation-history/access";
import { generateInverseRawOp } from "./lib/operation-history/inverse-op";
import { createOperationHistory } from "./lib/operation-history/repository";
import type { OperationAttribution } from "./lib/operation-history/types";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const createShareDBPostgres = require("sharedb-postgres") as (
  options?: Record<string, unknown>,
) => unknown;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ShareDBError = require("sharedb/lib/error") as {
  new (code: string, message?: string): Error & { code: string };
};

loadEnv({
  path: path.resolve(process.cwd(), ".env.local"),
  override: false,
  quiet: true,
});
const shareDbDatabaseUrl =
  process.env.SHAREDB_DATABASE_URL || process.env.DATABASE_URL;

if (!shareDbDatabaseUrl) {
  throw new Error(
    "Missing SHAREDB_DATABASE_URL/DATABASE_URL for ShareDB server.",
  );
}
const SHAREDB_DATABASE_URL: string = shareDbDatabaseUrl;

const SHAREDB_REQUIRE_SSL = process.env.SHAREDB_REQUIRE_SSL !== "false";
const parsePositiveInt = (value: string | undefined, fallback: number) => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
const parseNonNegativeInt = (value: string | undefined, fallback: number) => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};
const parseBoolean = (value: string | undefined, fallback: boolean) => {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true") return true;
  if (normalized === "0" || normalized === "false") return false;
  return fallback;
};
const parseBoundedInt = (
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
) => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min || parsed > max) return fallback;
  return parsed;
};
const SHAREDB_PG_MAX_POOL_SIZE = parsePositiveInt(
  process.env.SHAREDB_PG_MAX_POOL_SIZE,
  10,
);
const SHAREDB_PG_CONNECTION_TIMEOUT_MS = parsePositiveInt(
  process.env.SHAREDB_PG_CONNECTION_TIMEOUT_MS,
  10000,
);
const SHAREDB_PG_IDLE_TIMEOUT_MS = parseNonNegativeInt(
  process.env.SHAREDB_PG_IDLE_TIMEOUT_MS,
  30000,
);
const SHAREDB_PG_MAX_LIFETIME_SECONDS = parseNonNegativeInt(
  process.env.SHAREDB_PG_MAX_LIFETIME_SECONDS,
  0,
);
const SHAREDB_PG_KEEP_ALIVE = parseBoolean(
  process.env.SHAREDB_PG_KEEP_ALIVE,
  true,
);
const SHAREDB_PG_KEEP_ALIVE_INITIAL_DELAY_MS = parseNonNegativeInt(
  process.env.SHAREDB_PG_KEEP_ALIVE_INITIAL_DELAY_MS,
  0,
);
const PORT = parseInt(
  process.env.PORT || process.env.SHAREDB_PORT || "8080",
  10,
);
const HOST = process.env.HOST || "0.0.0.0";
const SHAREDB_COLLECTION =
  process.env.SHAREDB_COLLECTION?.trim() || "spreadsheets";
const SHAREDB_AUTH_DEBUG = process.env.SHAREDB_AUTH_DEBUG === "true";
const SHAREDB_REDIS_URL = process.env.SHAREDB_REDIS_URL?.trim() || null;
const SHAREDB_REDIS_PREFIX =
  process.env.SHAREDB_REDIS_PREFIX?.trim() || "rnc:sharedb";
const AUDIT_ACCESS_CACHE_TTL_MS = 5 * 60_000;
const DOC_ACCESS_CACHE_TTL_MS = parsePositiveInt(
  process.env.SHAREDB_DOC_ACCESS_CACHE_TTL_MS,
  45_000,
);
const POSTGRES_JSONB_MAX_BYTES = 268_435_455; // PostgreSQL hard limit for a single jsonb value
const DEFAULT_SHAREDB_DOC_MAX_BYTES = 300 * 1024 * 1024; // requested default
const SHAREDB_DOC_MAX_BYTES_REQUESTED = parseNonNegativeInt(
  process.env.SHAREDB_DOC_MAX_BYTES,
  DEFAULT_SHAREDB_DOC_MAX_BYTES,
);
const SHAREDB_DOC_JSONB_SAFETY_MARGIN_BYTES = parseNonNegativeInt(
  process.env.SHAREDB_DOC_JSONB_SAFETY_MARGIN_BYTES,
  8 * 1024 * 1024,
);
const SHAREDB_DOC_MAX_BYTES_CAP = Math.max(
  1,
  POSTGRES_JSONB_MAX_BYTES - SHAREDB_DOC_JSONB_SAFETY_MARGIN_BYTES,
);
const SHAREDB_DOC_MAX_BYTES = Math.min(
  SHAREDB_DOC_MAX_BYTES_REQUESTED,
  SHAREDB_DOC_MAX_BYTES_CAP,
);
const SHAREDB_OP_MAX_BYTES_REQUESTED = parseNonNegativeInt(
  process.env.SHAREDB_OP_MAX_BYTES,
  SHAREDB_DOC_MAX_BYTES_CAP,
);
const SHAREDB_OP_MAX_BYTES = Math.min(
  SHAREDB_OP_MAX_BYTES_REQUESTED,
  SHAREDB_DOC_MAX_BYTES_CAP,
);
const SHAREDB_WS_MAX_PAYLOAD_OVERHEAD_BYTES = parseNonNegativeInt(
  process.env.SHAREDB_WS_MAX_PAYLOAD_OVERHEAD_BYTES,
  1 * 1024 * 1024,
);
const SHAREDB_WS_MAX_PAYLOAD_CAP_BYTES =
  SHAREDB_DOC_MAX_BYTES + SHAREDB_WS_MAX_PAYLOAD_OVERHEAD_BYTES;
const SHAREDB_WS_MAX_PAYLOAD_REQUESTED_BYTES = parseNonNegativeInt(
  process.env.SHAREDB_WS_MAX_PAYLOAD_BYTES,
  SHAREDB_WS_MAX_PAYLOAD_CAP_BYTES,
);
const SHAREDB_WS_MAX_PAYLOAD_BYTES = Math.min(
  SHAREDB_WS_MAX_PAYLOAD_REQUESTED_BYTES,
  SHAREDB_WS_MAX_PAYLOAD_CAP_BYTES,
);
const SHAREDB_WS_COMPRESSION_ENABLED = parseBoolean(
  process.env.SHAREDB_WS_COMPRESSION_ENABLED,
  true,
);
const SHAREDB_WS_COMPRESSION_THRESHOLD_BYTES = parseNonNegativeInt(
  process.env.SHAREDB_WS_COMPRESSION_THRESHOLD_BYTES,
  1024,
);
const SHAREDB_WS_COMPRESSION_CONCURRENCY_LIMIT = parsePositiveInt(
  process.env.SHAREDB_WS_COMPRESSION_CONCURRENCY_LIMIT,
  10,
);
const SHAREDB_WS_COMPRESSION_LEVEL = parseBoundedInt(
  process.env.SHAREDB_WS_COMPRESSION_LEVEL,
  3,
  0,
  9,
);
const SHAREDB_WS_COMPRESSION_NO_CONTEXT_TAKEOVER = parseBoolean(
  process.env.SHAREDB_WS_COMPRESSION_NO_CONTEXT_TAKEOVER,
  true,
);

type AuthIdentity = {
  userId: string;
  email: string | null;
  name: string | null;
};

type AuthFailureReason =
  | "no_ws_token"
  | "no_cookie"
  | "invalid_token"
  | "invalid_ws_token"
  | "invalid_mcp_token"
  | "timeout"
  | "endpoint_failure";

type IdentityResolutionResult = {
  identity: AuthIdentity | null;
  failureReason: AuthFailureReason | null;
  statusCode?: number;
};

type AgentAuditState = {
  identity: AuthIdentity | null;
  allowed: boolean;
  isAdmin: boolean;
  plan: "free" | "pro" | "max" | null;
};

type AgentAuthState = {
  identity: AuthIdentity | null;
  wsAccess: {
    docId: string;
    permission: DocumentPermission;
  } | null;
  mcpAccess: {
    docId: string;
    permission: DocumentPermission;
  } | null;
  failureReason: AuthFailureReason | null;
  statusCode?: number;
  resolvedAt: number;
};

type DocumentPermission = "view" | "edit";

type AgentDocAccessCacheEntry = {
  canAccess: boolean;
  permission: DocumentPermission;
  expiresAt: number;
};

type ShareDBAuditSource = {
  source?: unknown;
  sourceType?: unknown;
  actorType?: unknown;
  actorId?: unknown;
  userId?: unknown;
  userName?: unknown;
  userEmail?: unknown;
  sessionId?: unknown;
  threadId?: unknown;
  runId?: unknown;
  toolName?: unknown;
  toolCallId?: unknown;
  channel?: unknown;
  origin?: unknown;
};

type ConnectContextLike = {
  agent?: {
    custom?: Record<string, unknown>;
  };
  req?: IncomingMessage;
};

type SubmitContextLike = {
  agent?: {
    custom?: Record<string, unknown>;
  };
  req?: IncomingMessage;
  collection: string;
  id: string;
  op?: {
    v?: unknown;
    src?: unknown;
    seq?: unknown;
    op?: unknown;
  };
  snapshot?: {
    v?: unknown;
    data?: unknown;
  } | null;
  extra?: {
    source?: unknown;
  };
};

type ReadSnapshotLike = {
  id?: unknown;
};

type ReadSnapshotsContextLike = {
  agent?: {
    custom?: Record<string, unknown>;
  };
  req?: IncomingMessage;
  collection: string;
  snapshots: ReadSnapshotLike[];
  rejectSnapshotRead?: (snapshot: ReadSnapshotLike, error: Error) => void;
};

type QueryContextLike = {
  agent?: {
    custom?: Record<string, unknown>;
  };
  req?: IncomingMessage;
  collection?: string;
  index?: string;
  query?: unknown;
};

const auditAccessCache = new Map<
  string,
  { access: Omit<AgentAuditState, "identity">; expiresAt: number }
>();

const redactDatabaseUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    if (parsed.username) parsed.username = "***";
    if (parsed.password) parsed.password = "***";
    return parsed.toString();
  } catch {
    return value;
  }
};

const getStringValue = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const getMcpTokenFromRequest = (req?: IncomingMessage): string | null => {
  if (!req?.url) {
    return null;
  }
  try {
    const parsed = new URL(req.url, "http://localhost");
    return getStringValue(parsed.searchParams.get("mcpToken"));
  } catch {
    return null;
  }
};

const getWsTokenFromRequest = (req?: IncomingMessage): string | null => {
  if (!req?.url) {
    return null;
  }
  try {
    const parsed = new URL(req.url, "http://localhost");
    return getStringValue(parsed.searchParams.get("wsToken"));
  } catch {
    return null;
  }
};

const logAuth = (
  level: "debug" | "warn" | "error",
  message: string,
  payload?: Record<string, unknown>,
) => {
  if (level === "debug" && !SHAREDB_AUTH_DEBUG) {
    return;
  }
  const logger =
    level === "warn"
      ? console.warn
      : level === "error"
        ? console.error
        : console.log;
  logger("[sharedb-auth]", message, payload ?? {});
};

const resolveAuditAccessCached = async (
  identity: AuthIdentity,
): Promise<Omit<AgentAuditState, "identity">> => {
  const cacheKey = `${identity.userId}:${identity.email ?? ""}`;
  const cached = auditAccessCache.get(cacheKey);
  if (cached && cached.expiresAt >= Date.now()) {
    return cached.access;
  }

  const access = await resolveAuditHistoryAccess({
    userId: identity.userId,
    email: identity.email,
  });
  const normalized = {
    allowed: access.allowed,
    isAdmin: access.isAdmin,
    plan: access.plan,
  };

  auditAccessCache.set(cacheKey, {
    access: normalized,
    expiresAt: Date.now() + AUDIT_ACCESS_CACHE_TTL_MS,
  });

  return normalized;
};

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
};

const toString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const getAuditSourceType = (source: unknown): string | null => {
  if (typeof source === "string") {
    return source.trim().toLowerCase();
  }
  if (!source || typeof source !== "object") {
    return null;
  }
  const metadata = source as ShareDBAuditSource;
  const candidate = toString(metadata.sourceType) ?? toString(metadata.source);
  return candidate ? candidate.toLowerCase() : null;
};

const isUserSource = (source: unknown): boolean => {
  const normalized = getAuditSourceType(source);
  if (!normalized) {
    return true;
  }
  return normalized === "user";
};

const toSourceMetadata = (source: unknown): ShareDBAuditSource | null => {
  if (!source || typeof source !== "object") {
    return null;
  }
  return source as ShareDBAuditSource;
};

const getOrCreateAgentCustom = (
  context:
    | ConnectContextLike
    | SubmitContextLike
    | ReadSnapshotsContextLike
    | QueryContextLike,
): Record<string, unknown> => {
  if (!context.agent) {
    return {};
  }
  if (!context.agent.custom) {
    context.agent.custom = Object.create(null) as Record<string, unknown>;
  }
  return context.agent.custom;
};

const createUnauthorizedError = (message: string): Error => {
  return new ShareDBError("ERR_UNAUTHORIZED", message);
};

const createForbiddenError = (message: string): Error => {
  return new ShareDBError("ERR_FORBIDDEN", message);
};

const createDocumentSizeLimitError = (message: string): Error => {
  return new ShareDBError("ERR_DOC_TOO_LARGE", message);
};

const createOperationSizeLimitError = (message: string): Error => {
  return new ShareDBError("ERR_OP_TOO_LARGE", message);
};

const computeDocumentSizeBytes = (snapshotData: unknown): number | null => {
  try {
    return Buffer.byteLength(JSON.stringify(snapshotData ?? null), "utf8");
  } catch {
    return null;
  }
};

const formatBytes = (value: number): string => {
  if (!Number.isFinite(value) || value < 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const precision = size >= 10 || unitIndex === 0 ? 0 : 1;
  return `${size.toFixed(precision)} ${units[unitIndex]}`;
};

const toAgentAuthState = (
  result: IdentityResolutionResult,
): AgentAuthState => ({
  identity: result.identity,
  wsAccess: null,
  mcpAccess: null,
  failureReason: result.failureReason,
  statusCode: result.statusCode,
  resolvedAt: Date.now(),
});

const ensureAgentAuthState = async (
  context:
    | ConnectContextLike
    | SubmitContextLike
    | ReadSnapshotsContextLike
    | QueryContextLike,
): Promise<AgentAuthState> => {
  const custom = getOrCreateAgentCustom(context);
  const existing = (custom.__authState ?? null) as AgentAuthState | null;
  if (existing) {
    return existing;
  }

  const inFlight = (custom.__authStatePromise ??
    null) as Promise<AgentAuthState> | null;
  if (inFlight) {
    return inFlight;
  }

  const promise = Promise.resolve()
    .then(async () => {
      const state = toAgentAuthState({
        identity: null,
        failureReason: "no_ws_token",
      });
      const wsToken = getWsTokenFromRequest(context.req);
      if (wsToken) {
        const access = await verifyShareDbWsAccessToken(wsToken);
        if (access) {
          state.identity = {
            userId: access.userId,
            email: access.email ?? null,
            name: access.name ?? null,
          };
          state.wsAccess = {
            docId: access.docId,
            permission: access.permission,
          };
          state.failureReason = null;
        } else {
          state.failureReason = "invalid_ws_token";
        }
      } else {
        const mcpToken = getMcpTokenFromRequest(context.req);
        if (mcpToken) {
          const access = await verifyMcpShareDbAccessToken(mcpToken);
          if (access) {
            state.mcpAccess = {
              docId: access.docId,
              permission: access.permission,
            };
            state.failureReason = null;
          } else {
            state.failureReason = "invalid_mcp_token";
          }
        }
      }
      custom.__authState = state;
      if (!state.identity && !state.mcpAccess) {
        logAuth("warn", "identity_unresolved", {
          reason: state.failureReason,
          statusCode: state.statusCode,
        });
      } else if (state.wsAccess && state.identity) {
        logAuth("debug", "ws_token_resolved", {
          userId: state.identity.userId,
          docId: state.wsAccess.docId,
          permission: state.wsAccess.permission,
        });
      } else if (state.mcpAccess) {
        logAuth("debug", "mcp_token_resolved", {
          docId: state.mcpAccess.docId,
          permission: state.mcpAccess.permission,
        });
      } else {
        const identity = state.identity;
        logAuth("debug", "identity_resolved", {
          userId: identity?.userId ?? "unknown",
        });
      }
      return state;
    })
    .finally(() => {
      delete custom.__authStatePromise;
    });

  custom.__authStatePromise = promise;
  return promise;
};

const getDocAccessCache = (
  custom: Record<string, unknown>,
): Record<string, AgentDocAccessCacheEntry> => {
  const existing = custom.__docAccessCache;
  if (existing && typeof existing === "object") {
    return existing as Record<string, AgentDocAccessCacheEntry>;
  }
  const created = Object.create(null) as Record<
    string,
    AgentDocAccessCacheEntry
  >;
  custom.__docAccessCache = created;
  return created;
};

const getCachedDocumentAccess = (
  custom: Record<string, unknown>,
  docId: string,
): AgentDocAccessCacheEntry | null => {
  const cache = getDocAccessCache(custom);
  const entry = cache[docId];
  if (!entry) {
    return null;
  }
  if (entry.expiresAt < Date.now()) {
    delete cache[docId];
    return null;
  }
  return entry;
};

const setCachedDocumentAccess = (
  custom: Record<string, unknown>,
  docId: string,
  entry: Omit<AgentDocAccessCacheEntry, "expiresAt">,
): AgentDocAccessCacheEntry => {
  const cache = getDocAccessCache(custom);
  const value: AgentDocAccessCacheEntry = {
    ...entry,
    expiresAt: Date.now() + DOC_ACCESS_CACHE_TTL_MS,
  };
  cache[docId] = value;
  return value;
};

const resolveDocumentAccessForAgent = async (
  context:
    | SubmitContextLike
    | ReadSnapshotsContextLike
    | QueryContextLike
    | ConnectContextLike,
  docId: string,
): Promise<{
  authState: AgentAuthState;
  access: AgentDocAccessCacheEntry | null;
}> => {
  const authState = await ensureAgentAuthState(context);
  if (!authState.identity) {
    return { authState, access: null };
  }

  const custom = getOrCreateAgentCustom(context);
  const cached = getCachedDocumentAccess(custom, docId);
  if (cached) {
    return {
      authState,
      access: cached,
    };
  }

  const accessResult = await ensureDocumentAccess({
    docId,
    userId: authState.identity.userId,
  });
  const access = setCachedDocumentAccess(custom, docId, {
    canAccess: accessResult.canAccess,
    permission: accessResult.permission as DocumentPermission,
  });
  return {
    authState,
    access,
  };
};

const rejectSnapshotReadWithError = (
  context: ReadSnapshotsContextLike,
  snapshot: ReadSnapshotLike,
  error: Error,
) => {
  if (typeof context.rejectSnapshotRead === "function") {
    context.rejectSnapshotRead(snapshot, error);
    return;
  }
  throw error;
};

export const registerAuthAccessMiddleware = (backend: ShareDB) => {
  backend.use("connect", (context: ConnectContextLike, callback) => {
    void ensureAgentAuthState(context).catch((error) => {
      logAuth("warn", "identity_resolution_failed", {
        reason: "endpoint_failure",
        error: error instanceof Error ? error.message : String(error),
      });
    });
    callback();
  });

  backend.use(
    "readSnapshots",
    (context: ReadSnapshotsContextLike, callback: (error?: Error) => void) => {
      void (async () => {
        if (context.collection !== SHAREDB_COLLECTION) {
          throw createForbiddenError("Collection access is forbidden.");
        }

        const authState = await ensureAgentAuthState(context);
        if (!authState.identity && !authState.mcpAccess) {
          const error = createUnauthorizedError(
            "Authentication required to read this document.",
          );
          const deniedDocIds = context.snapshots
            .map((snapshot) => toString(snapshot.id))
            .filter((docId): docId is string => Boolean(docId));
          for (const snapshot of context.snapshots) {
            rejectSnapshotReadWithError(context, snapshot, error);
          }
          logAuth("warn", "read_denied", {
            collection: context.collection,
            docIds: deniedDocIds,
            reason: authState.failureReason,
            statusCode: authState.statusCode,
          });
          return;
        }

        for (const snapshot of context.snapshots) {
          const docId = toString(snapshot.id);
          if (!docId) {
            rejectSnapshotReadWithError(
              context,
              snapshot,
              createForbiddenError("Invalid document id."),
            );
            continue;
          }

          if (authState.wsAccess && authState.wsAccess.docId !== docId) {
            const error = createForbiddenError(
              "WS token is not valid for this document.",
            );
            rejectSnapshotReadWithError(context, snapshot, error);
            logAuth("warn", "read_denied", {
              collection: context.collection,
              docId,
              reason: "forbidden",
            });
            continue;
          }

          if (authState.mcpAccess) {
            if (authState.mcpAccess.docId !== docId) {
              const error = createForbiddenError(
                "MCP token is not valid for this document.",
              );
              rejectSnapshotReadWithError(context, snapshot, error);
              logAuth("warn", "read_denied", {
                collection: context.collection,
                docId,
                reason: "forbidden",
              });
              continue;
            }
            logAuth("debug", "read_allowed", {
              collection: context.collection,
              docId,
              permission: authState.mcpAccess.permission,
              userId: "mcp-token",
            });
            continue;
          }

          const { access } = await resolveDocumentAccessForAgent(
            context,
            docId,
          );
          const authUserId = authState.identity?.userId ?? "unknown";
          if (!access?.canAccess) {
            const error = createForbiddenError(
              "You do not have access to this document.",
            );
            rejectSnapshotReadWithError(context, snapshot, error);
            logAuth("warn", "read_denied", {
              collection: context.collection,
              docId,
              userId: authUserId,
              reason: "forbidden",
            });
          } else {
            logAuth("debug", "read_allowed", {
              collection: context.collection,
              docId,
              permission: access.permission,
              userId: authUserId,
            });
          }
        }
      })()
        .then(() => callback())
        .catch((error) => {
          callback(
            error instanceof Error
              ? error
              : createForbiddenError("Unable to validate read access."),
          );
        });
    },
  );

  backend.use(
    "submit",
    (context: SubmitContextLike, callback: (error?: Error) => void) => {
      void (async () => {
        if (context.collection !== SHAREDB_COLLECTION) {
          throw createForbiddenError("Collection access is forbidden.");
        }

        const docId = toString(context.id);
        if (!docId) {
          throw createForbiddenError("Invalid document id.");
        }

        const { authState, access } = await resolveDocumentAccessForAgent(
          context,
          docId,
        );
        if (!authState.identity && !authState.mcpAccess) {
          throw createUnauthorizedError(
            "Authentication required to edit this document.",
          );
        }
        if (authState.wsAccess) {
          if (authState.wsAccess.docId !== docId) {
            throw createForbiddenError(
              "WS token is not valid for this document.",
            );
          }
          if (authState.wsAccess.permission !== "edit") {
            throw createForbiddenError(
              "WS token does not allow edit access.",
            );
          }
        }
        if (authState.mcpAccess) {
          if (authState.mcpAccess.docId !== docId) {
            throw createForbiddenError(
              "MCP token is not valid for this document.",
            );
          }
          if (authState.mcpAccess.permission !== "edit") {
            throw createForbiddenError("MCP token does not allow edit access.");
          }

          logAuth("debug", "submit_allowed", {
            collection: context.collection,
            docId,
            userId: "mcp-token",
            permission: authState.mcpAccess.permission,
          });
          return;
        }
        if (!access?.canAccess) {
          throw createForbiddenError(
            "You do not have access to this document.",
          );
        }
        if (access.permission !== "edit") {
          throw createForbiddenError(
            "You do not have permission to edit this document.",
          );
        }
        const authUserId = authState.identity?.userId ?? "unknown";

        logAuth("debug", "submit_allowed", {
          collection: context.collection,
          docId,
          userId: authUserId,
          permission: access.permission,
        });
      })()
        .then(() => callback())
        .catch((error) => {
          const authState = (getOrCreateAgentCustom(context).__authState ??
            null) as AgentAuthState | null;
          logAuth("warn", "submit_denied", {
            collection: context.collection,
            docId: context.id,
            reason: authState?.failureReason ?? "forbidden",
            statusCode: authState?.statusCode,
            userId: authState?.identity?.userId ?? null,
            error: error instanceof Error ? error.message : String(error),
          });
          callback(
            error instanceof Error
              ? error
              : createForbiddenError("Unable to validate submit access."),
          );
        });
    },
  );

  backend.use(
    "query",
    (context: QueryContextLike, callback: (error?: Error) => void) => {
      logAuth("warn", "query_denied", {
        collection: context.collection,
        index: context.index,
      });
      callback(
        createForbiddenError(
          "Query operations are not allowed on this endpoint.",
        ),
      );
    },
  );
};

const registerAuditMiddleware = (backend: ShareDB) => {
  backend.use("connect", (context: ConnectContextLike, callback) => {
    const flags = getFlags();
    if (!isTrackingEnabledForSource("user", flags)) {
      callback();
      return;
    }

    const custom = getOrCreateAgentCustom(context);
    const applyAuditState = (state: AgentAuditState) => {
      custom.__auditState = state;
    };

    // Do not block ShareDB socket initialization on auth/billing lookups.
    // If this async path is slow or unavailable, collaboration still works
    // and audit capture is skipped until identity/access state resolves.
    applyAuditState({
      identity: null,
      allowed: false,
      isAdmin: false,
      plan: null,
    });
    callback();

    void (async () => {
      const authState = await ensureAgentAuthState(context);
      if (!authState.identity) {
        logAuth("debug", "audit_identity_unavailable", {
          reason: authState.failureReason,
          statusCode: authState.statusCode,
        });
        return;
      }

      const access = await resolveAuditAccessCached(authState.identity);
      applyAuditState({
        identity: authState.identity,
        allowed: access.allowed,
        isAdmin: access.isAdmin,
        plan: access.plan,
      });
    })().catch((error) => {
      console.warn("[sharedb-audit] connect middleware failed:", error);
    });
  });

  backend.use("afterWrite", (context: SubmitContextLike, callback) => {
    const flags = getFlags();
    if (!isTrackingEnabledForSource("user", flags)) {
      callback();
      return;
    }

    void (async () => {
      const custom = getOrCreateAgentCustom(context);
      const auditState = (custom.__auditState ??
        null) as AgentAuditState | null;
      if (!auditState?.allowed || !auditState.identity) {
        return;
      }

      const sourceValue = context.extra?.source;
      if (!isUserSource(sourceValue)) {
        return;
      }

      const forwardOp = Array.isArray(context.op?.op)
        ? (context.op?.op as Array<Record<string, unknown>>)
        : null;
      if (!forwardOp || forwardOp.length === 0) {
        return;
      }

      const inverseOp = generateInverseRawOp(forwardOp);
      const snapshotVersion = toNumber(context.snapshot?.v);
      const opVersion = toNumber(context.op?.v);
      const versionFrom = opVersion ?? Math.max(0, (snapshotVersion ?? 1) - 1);
      const versionTo = Math.max(
        snapshotVersion ?? versionFrom + 1,
        versionFrom + 1,
      );

      const sourceMetadata = toSourceMetadata(sourceValue);
      const attribution: OperationAttribution = {
        source: "user",
        actorType: "user",
        actorId: auditState.identity.userId,
        userId: auditState.identity.userId,
        sessionId:
          toString(sourceMetadata?.sessionId) ??
          toString(context.op?.src) ??
          undefined,
        threadId: toString(sourceMetadata?.threadId) ?? undefined,
        runId: toString(sourceMetadata?.runId) ?? undefined,
        toolName: toString(sourceMetadata?.toolName) ?? undefined,
        toolCallId: toString(sourceMetadata?.toolCallId) ?? undefined,
      };

      await createOperationHistory({
        collection: context.collection,
        docId: context.id,
        attribution,
        activityType: "write",
        sharedbVersionFrom: versionFrom,
        sharedbVersionTo: versionTo,
        operationPayload: {
          forward: {
            kind: "raw_op",
            data: forwardOp,
          },
          inverse: {
            kind: "raw_op",
            data: inverseOp,
          },
        },
        metadata: {
          userName:
            toString(sourceMetadata?.userName) ??
            auditState.identity.name ??
            undefined,
          userEmail:
            toString(sourceMetadata?.userEmail) ??
            auditState.identity.email ??
            undefined,
          sourceChannel:
            toString(sourceMetadata?.channel) ?? "sharedb_realtime",
          sourceOrigin:
            toString(sourceMetadata?.origin) ?? "sharedb_server_afterwrite",
          opSrc: toString(context.op?.src) ?? undefined,
          opSeq: toNumber(context.op?.seq) ?? undefined,
          plan: auditState.plan ?? undefined,
          isAdmin: auditState.isAdmin,
        },
      });
    })()
      .catch((error) => {
        // Do not fail the committed ShareDB write when audit persistence fails.
        console.error(
          "[sharedb-audit] Failed to persist operation history:",
          error,
        );
      })
      .finally(() => {
        callback();
      });
  });
};

const registerDocumentSizeLimitMiddleware = (backend: ShareDB) => {
  if (SHAREDB_DOC_MAX_BYTES <= 0) {
    console.log("ShareDB document size limit: disabled");
    return;
  }

  console.log("ShareDB document size limit: enabled", {
    requestedMaxBytes: SHAREDB_DOC_MAX_BYTES_REQUESTED,
    effectiveMaxBytes: SHAREDB_DOC_MAX_BYTES,
    effectiveMaxSize: formatBytes(SHAREDB_DOC_MAX_BYTES),
    opMaxBytes: SHAREDB_OP_MAX_BYTES,
    jsonbHardLimitBytes: POSTGRES_JSONB_MAX_BYTES,
    jsonbSafetyMarginBytes: SHAREDB_DOC_JSONB_SAFETY_MARGIN_BYTES,
  });
  if (SHAREDB_DOC_MAX_BYTES_REQUESTED > SHAREDB_DOC_MAX_BYTES) {
    console.warn(
      "[sharedb-size] SHAREDB_DOC_MAX_BYTES capped by PostgreSQL jsonb limits",
      {
        requestedBytes: SHAREDB_DOC_MAX_BYTES_REQUESTED,
        effectiveBytes: SHAREDB_DOC_MAX_BYTES,
      },
    );
  }

  backend.use(
    "apply",
    (context: SubmitContextLike, callback: (error?: Error) => void) => {
      if (context.collection !== SHAREDB_COLLECTION) {
        callback();
        return;
      }

      const operationSizeBytes = computeDocumentSizeBytes(context.op ?? null);
      if (operationSizeBytes === null) {
        callback(
          createOperationSizeLimitError(
            "Unable to validate operation payload size before commit.",
          ),
        );
        return;
      }

      if (operationSizeBytes > SHAREDB_OP_MAX_BYTES) {
        const docId = toString(context.id) ?? "unknown";
        callback(
          createOperationSizeLimitError(
            `Operation payload exceeds the maximum allowed size (${formatBytes(
              SHAREDB_OP_MAX_BYTES,
            )} / ${SHAREDB_OP_MAX_BYTES} bytes). Current operation size: ${formatBytes(
              operationSizeBytes,
            )} / ${operationSizeBytes} bytes. docId=${docId}`,
          ),
        );
        return;
      }

      const nextSizeBytes = computeDocumentSizeBytes(context.snapshot?.data);
      if (nextSizeBytes === null) {
        callback(
          createDocumentSizeLimitError(
            "Unable to validate document size after applying operation.",
          ),
        );
        return;
      }

      if (nextSizeBytes <= SHAREDB_DOC_MAX_BYTES) {
        callback();
        return;
      }

      const docId = toString(context.id) ?? "unknown";
      callback(
        createDocumentSizeLimitError(
          `Document exceeds the maximum allowed size (${formatBytes(
            SHAREDB_DOC_MAX_BYTES,
          )} / ${SHAREDB_DOC_MAX_BYTES} bytes). Current size: ${formatBytes(
            nextSizeBytes,
          )} / ${nextSizeBytes} bytes. docId=${docId}`,
        ),
      );
    },
  );
};

async function startServer() {
  console.log(
    "Connecting ShareDB to PostgreSQL:",
    redactDatabaseUrl(SHAREDB_DATABASE_URL),
  );
  console.log("ShareDB pg pool config:", {
    max: SHAREDB_PG_MAX_POOL_SIZE,
    connectionTimeoutMillis: SHAREDB_PG_CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: SHAREDB_PG_IDLE_TIMEOUT_MS,
    maxLifetimeSeconds: SHAREDB_PG_MAX_LIFETIME_SECONDS || undefined,
    keepAlive: SHAREDB_PG_KEEP_ALIVE,
    keepAliveInitialDelayMillis: SHAREDB_PG_KEEP_ALIVE_INITIAL_DELAY_MS,
  });
  console.log("ShareDB WS compression:", {
    enabled: SHAREDB_WS_COMPRESSION_ENABLED,
    thresholdBytes: SHAREDB_WS_COMPRESSION_THRESHOLD_BYTES,
    concurrencyLimit: SHAREDB_WS_COMPRESSION_CONCURRENCY_LIMIT,
    level: SHAREDB_WS_COMPRESSION_LEVEL,
    noContextTakeover: SHAREDB_WS_COMPRESSION_NO_CONTEXT_TAKEOVER,
    maxPayloadBytes: SHAREDB_WS_MAX_PAYLOAD_BYTES,
    maxPayloadCapBytes: SHAREDB_WS_MAX_PAYLOAD_CAP_BYTES,
    docMaxBytes: SHAREDB_DOC_MAX_BYTES,
  });
  if (SHAREDB_WS_MAX_PAYLOAD_REQUESTED_BYTES > SHAREDB_WS_MAX_PAYLOAD_BYTES) {
    console.warn(
      "[sharedb-ws] SHAREDB_WS_MAX_PAYLOAD_BYTES was capped to respect SHAREDB_DOC_MAX_BYTES",
      {
        requestedBytes: SHAREDB_WS_MAX_PAYLOAD_REQUESTED_BYTES,
        cappedBytes: SHAREDB_WS_MAX_PAYLOAD_BYTES,
      },
    );
  }

  const shouldForceSsl =
    SHAREDB_REQUIRE_SSL && !/sslmode=/i.test(SHAREDB_DATABASE_URL);

  const db = createShareDBPostgres({
    connectionString: SHAREDB_DATABASE_URL,
    max: SHAREDB_PG_MAX_POOL_SIZE,
    connectionTimeoutMillis: SHAREDB_PG_CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: SHAREDB_PG_IDLE_TIMEOUT_MS,
    ...(SHAREDB_PG_MAX_LIFETIME_SECONDS > 0
      ? { maxLifetimeSeconds: SHAREDB_PG_MAX_LIFETIME_SECONDS }
      : {}),
    keepAlive: SHAREDB_PG_KEEP_ALIVE,
    keepAliveInitialDelayMillis: SHAREDB_PG_KEEP_ALIVE_INITIAL_DELAY_MS,
    ...(shouldForceSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  }) as never;

  const pubsub: ShareDB.PubSub | undefined = (() => {
    if (!SHAREDB_REDIS_URL) {
      console.log("ShareDB Redis pubsub: disabled (SHAREDB_REDIS_URL unset)");
      return undefined;
    }

    const redisClient = createClient({
      url: SHAREDB_REDIS_URL,
    });

    redisClient.on("error", (error) => {
      console.error("[sharedb-redis] client error:", error);
    });

    console.log("ShareDB Redis pubsub: enabled", {
      prefix: SHAREDB_REDIS_PREFIX,
    });

    return createShareDBRedisPubSub({
      client: redisClient,
      prefix: SHAREDB_REDIS_PREFIX,
    }) as ShareDB.PubSub;
  })();

  const backend = new ShareDB({
    db,
    ...(pubsub ? { pubsub } : {}),
    presence: true,
    doNotForwardSendPresenceErrorsToClient: true,
  });
  registerAuthAccessMiddleware(backend);
  registerDocumentSizeLimitMiddleware(backend);
  registerAuditMiddleware(backend);

  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }),
      );
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  const wss = new WebSocketServer({
    server,
    maxPayload: SHAREDB_WS_MAX_PAYLOAD_BYTES,
    perMessageDeflate: SHAREDB_WS_COMPRESSION_ENABLED
      ? {
          threshold: SHAREDB_WS_COMPRESSION_THRESHOLD_BYTES,
          concurrencyLimit: SHAREDB_WS_COMPRESSION_CONCURRENCY_LIMIT,
          zlibDeflateOptions: {
            level: SHAREDB_WS_COMPRESSION_LEVEL,
          },
          clientNoContextTakeover: SHAREDB_WS_COMPRESSION_NO_CONTEXT_TAKEOVER,
          serverNoContextTakeover: SHAREDB_WS_COMPRESSION_NO_CONTEXT_TAKEOVER,
        }
      : false,
  });

  wss.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(
        `Port ${PORT} is already in use. Stop the existing ShareDB server or set PORT/SHAREDB_PORT to a different port.`,
      );
      process.exit(1);
    }
    console.error("WebSocket server error:", error);
    process.exit(1);
  });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const stream = new WebSocketJSONStream(ws);
    backend.listen(stream as never, req);
    console.log("Client connected");

    ws.on("error", (error) => {
      const errorUnknown: unknown = error;
      const errorRecord =
        typeof errorUnknown === "object" && errorUnknown !== null
          ? (errorUnknown as Record<PropertyKey, unknown>)
          : null;
      const statusCode =
        errorRecord && Symbol.for("status-code") in errorRecord
          ? errorRecord[Symbol.for("status-code")]
          : undefined;
      console.warn("WebSocket client error:", {
        message: error instanceof Error ? error.message : String(error),
        ...(typeof statusCode === "number" ? { statusCode } : {}),
      });
    });

    ws.on("close", () => {
      console.log("Client disconnected");
    });
  });

  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(
        `Port ${PORT} is already in use. Stop the existing ShareDB server or set PORT/SHAREDB_PORT to a different port.`,
      );
      process.exit(1);
    }
    console.error("HTTP server error:", error);
    process.exit(1);
  });

  server.listen(PORT, HOST, () => {
    console.log(`ShareDB server running on ${HOST}:${PORT}`);
    console.log(`Health check: http://${HOST}:${PORT}/health`);
  });

  process.on("SIGTERM", () => {
    console.log("Shutting down...");
    server.close(() => {
      backend.close(() => {
        process.exit(0);
      });
    });
  });
}

const isMainModule = (() => {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return pathToFileURL(entry).href === import.meta.url;
})();

if (isMainModule) {
  startServer().catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
  });
}
