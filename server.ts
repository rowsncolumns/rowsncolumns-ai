import http, { type IncomingMessage } from "http";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import ShareDB from "sharedb";
import { WebSocketServer, WebSocket } from "ws";
import { getFlags, isTrackingEnabledForSource } from "./lib/feature-flags";
import { resolveAuditHistoryAccess } from "./lib/operation-history/access";
import { generateInverseRawOp } from "./lib/operation-history/inverse-op";
import { createOperationHistory } from "./lib/operation-history/repository";
import type { OperationAttribution } from "./lib/operation-history/types";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const createShareDBPostgres = require("sharedb-postgres") as (
  options?: Record<string, unknown>,
) => unknown;

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
const AUTH_BASE_URL =
  process.env.NEON_AUTH_BASE_URL?.trim().replace(/\/+$/, "") ?? null;
const AUTH_IDENTITY_CACHE_TTL_MS = 5 * 60_000;
const AUDIT_ACCESS_CACHE_TTL_MS = 5 * 60_000;
const SESSION_COOKIE_NAMES = [
  "__Secure-neon-auth.session_token",
  "neon-auth.session_token",
  "session_token",
] as const;

type AuthIdentity = {
  userId: string;
  email: string | null;
  name: string | null;
};

type SessionIntrospectionResult = {
  user?: {
    id?: string;
    email?: string | null;
    name?: string | null;
  } | null;
} | null;

type JwtPayloadLike = {
  sub?: unknown;
  email?: unknown;
  name?: unknown;
  [key: string]: unknown;
};

type AgentAuditState = {
  identity: AuthIdentity | null;
  allowed: boolean;
  isAdmin: boolean;
  plan: "free" | "pro" | "max" | null;
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
  } | null;
  extra?: {
    source?: unknown;
  };
};

const authIdentityCache = new Map<
  string,
  { identity: AuthIdentity | null; expiresAt: number }
>();
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

const parseCookies = (
  cookieHeader: string | undefined,
): Map<string, string> => {
  const cookies = new Map<string, string>();
  if (!cookieHeader) {
    return cookies;
  }

  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValueParts] = part.split("=");
    const name = rawName?.trim();
    if (!name) {
      continue;
    }
    const rawValue = rawValueParts.join("=").trim();
    try {
      cookies.set(name, decodeURIComponent(rawValue));
    } catch {
      cookies.set(name, rawValue);
    }
  }

  return cookies;
};

const getBearerToken = (
  authorizationHeader: string | undefined,
): string | null => {
  if (!authorizationHeader) {
    return null;
  }
  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return null;
  }
  return getStringValue(match[1]) ?? null;
};

const getSessionTokenFromRequest = (req?: IncomingMessage): string | null => {
  if (!req) {
    return null;
  }

  const authorization = Array.isArray(req.headers.authorization)
    ? req.headers.authorization[0]
    : req.headers.authorization;
  const bearerToken = getBearerToken(authorization);
  if (bearerToken) {
    return bearerToken;
  }

  const cookieHeader = Array.isArray(req.headers.cookie)
    ? req.headers.cookie.join("; ")
    : req.headers.cookie;
  const cookies = parseCookies(cookieHeader);

  for (const cookieName of SESSION_COOKIE_NAMES) {
    const token = getStringValue(cookies.get(cookieName));
    if (token) {
      return token;
    }
  }

  return null;
};

const isLikelyJwt = (token: string): boolean => {
  const parts = token.split(".");
  return parts.length === 3 && parts.every((part) => part.length > 0);
};

const extractIdentityFromJwtPayload = (
  payload: JwtPayloadLike | null,
): AuthIdentity | null => {
  if (!payload) {
    return null;
  }

  const userId =
    getStringValue(payload.sub) ??
    getStringValue(payload.userId) ??
    getStringValue(payload.user_id) ??
    getStringValue(payload.id);
  if (!userId) {
    return null;
  }

  return {
    userId,
    email:
      getStringValue(payload.email) ??
      getStringValue(payload.user_email) ??
      null,
    name:
      getStringValue(payload.name) ??
      getStringValue(payload.user_name) ??
      getStringValue(payload.preferred_username) ??
      null,
  };
};

const verifyTokenViaVerifyJwtEndpoint = async (
  token: string,
): Promise<AuthIdentity | null> => {
  if (!AUTH_BASE_URL) {
    return null;
  }

  try {
    const response = await fetch(`${AUTH_BASE_URL}/verify-jwt`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(2500),
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json().catch(() => null)) as {
      payload?: JwtPayloadLike | null;
      data?: {
        payload?: JwtPayloadLike | null;
      } | null;
    } | null;

    return extractIdentityFromJwtPayload(
      payload?.payload ?? payload?.data?.payload ?? null,
    );
  } catch {
    return null;
  }
};

const verifyTokenViaSessionIntrospection = async (
  token: string,
): Promise<AuthIdentity | null> => {
  if (!AUTH_BASE_URL) {
    return null;
  }

  for (const cookieName of SESSION_COOKIE_NAMES) {
    try {
      const response = await fetch(`${AUTH_BASE_URL}/get-session`, {
        method: "GET",
        headers: {
          Cookie: `${cookieName}=${encodeURIComponent(token)}`,
        },
        signal: AbortSignal.timeout(2500),
      });

      if (!response.ok) {
        continue;
      }

      const payload = (await response
        .json()
        .catch(() => null)) as SessionIntrospectionResult;
      const userId = getStringValue(payload?.user?.id);
      if (!userId) {
        continue;
      }

      return {
        userId,
        email: getStringValue(payload?.user?.email) ?? null,
        name: getStringValue(payload?.user?.name) ?? null,
      };
    } catch {
      continue;
    }
  }

  return null;
};

const verifyAuthToken = async (token: string): Promise<AuthIdentity | null> => {
  if (isLikelyJwt(token)) {
    const jwtIdentity = await verifyTokenViaVerifyJwtEndpoint(token);
    if (jwtIdentity) {
      return jwtIdentity;
    }
  }

  const sessionIdentity = await verifyTokenViaSessionIntrospection(token);
  if (sessionIdentity) {
    return sessionIdentity;
  }

  if (!isLikelyJwt(token)) {
    return verifyTokenViaVerifyJwtEndpoint(token);
  }

  return null;
};

const getCachedIdentity = (token: string): AuthIdentity | null | undefined => {
  const cached = authIdentityCache.get(token);
  if (!cached) {
    return undefined;
  }
  if (cached.expiresAt < Date.now()) {
    authIdentityCache.delete(token);
    return undefined;
  }
  return cached.identity;
};

const cacheIdentity = (token: string, identity: AuthIdentity | null): void => {
  authIdentityCache.set(token, {
    identity,
    expiresAt: Date.now() + AUTH_IDENTITY_CACHE_TTL_MS,
  });
};

const resolveIdentityFromRequest = async (
  req?: IncomingMessage,
): Promise<AuthIdentity | null> => {
  if (!AUTH_BASE_URL) {
    return null;
  }

  const token = getSessionTokenFromRequest(req);
  if (!token) {
    return null;
  }

  const cached = getCachedIdentity(token);
  if (cached !== undefined) {
    return cached;
  }

  const identity = await verifyAuthToken(token);
  cacheIdentity(token, identity);
  return identity;
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
  context: ConnectContextLike | SubmitContextLike,
): Record<string, unknown> => {
  if (!context.agent) {
    return {};
  }
  if (!context.agent.custom) {
    context.agent.custom = Object.create(null) as Record<string, unknown>;
  }
  return context.agent.custom;
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

    void (async () => {
      const identity = await resolveIdentityFromRequest(context.req);
      if (!identity) {
        applyAuditState({
          identity: null,
          allowed: false,
          isAdmin: false,
          plan: null,
        });
        return;
      }

      const access = await resolveAuditAccessCached(identity);
      applyAuditState({
        identity,
        allowed: access.allowed,
        isAdmin: access.isAdmin,
        plan: access.plan,
      });
    })()
      .catch((error) => {
        console.warn("[sharedb-audit] connect middleware failed:", error);
      })
      .finally(() => {
        callback();
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

  const backend = new ShareDB({
    db,
    presence: true,
    doNotForwardSendPresenceErrorsToClient: true,
  });
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

  const wss = new WebSocketServer({ server });

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

/**
 * WebSocket JSON stream adapter for ShareDB
 */
class WebSocketJSONStream {
  private ws: WebSocket;

  constructor(ws: WebSocket) {
    this.ws = ws;
  }

  // ShareDB stream interface
  on(event: string, callback: (...args: unknown[]) => void) {
    if (event === "data") {
      this.ws.on("message", (data: Buffer | string) => {
        try {
          const message = JSON.parse(data.toString());
          callback(message);
        } catch (error) {
          console.error("Failed to parse message:", error);
        }
      });
    } else if (event === "close" || event === "end") {
      this.ws.on("close", callback);
    } else if (event === "error") {
      this.ws.on("error", callback);
    }
  }

  write(data: unknown) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  end() {
    this.ws.close();
  }

  // Duplex stream compatibility
  pipe() {
    return this;
  }

  removeListener() {
    return this;
  }
}

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
