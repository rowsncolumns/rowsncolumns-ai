import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

import {
  type ChatAbortReason,
  type ChatProvider,
  type ChatRequestBody,
  ensureChatRunCredits,
  executeChatRunStream,
  resolveRunSystemInstructions,
  resolveChatRequest,
} from "@/lib/chat/server-core";
import { encodeChatStreamEvent } from "@/lib/chat/protocol";
import { isAdminUser } from "@/lib/auth/admin";
import { resolveUserLocation } from "@/lib/locale-preference";
import {
  abortRegisteredChatRun,
  registerChatRunAbortController,
  unregisterChatRunAbortController,
} from "@/lib/chat/run-abort-registry";
import {
  getChatRun,
  getChatRunEvents,
  getLatestChatRunForThread,
  requestChatRunCancel,
  requestThreadRunCancel,
} from "@/lib/chat/runs-repository";
import {
  forkThreadAtMessage,
  getSpreadsheetAssistantRecentSessions,
  getSpreadsheetAssistantThreadMessages,
} from "@/lib/chat/graph";
import {
  deleteAssistantSession,
  upsertAssistantSession,
} from "@/lib/chat/sessions-repository";
import { db } from "@/lib/db/postgres";

type AuthIdentity = {
  userId: string;
  email: string | null;
  activeOrganizationId?: string | null;
};

type JwtPayloadLike = {
  sub?: unknown;
  email?: unknown;
  [key: string]: unknown;
};

const CHAT_PATH = process.env.CHAT_RENDER_PATH?.trim() || "/chat";
const CHAT_RESUME_PATH = process.env.CHAT_RESUME_PATH?.trim() || "/chat/resume";
const CHAT_STOP_PATH = process.env.CHAT_STOP_PATH?.trim() || "/chat/stop";
const CHAT_HISTORY_PATH =
  process.env.CHAT_HISTORY_PATH?.trim() || "/chat/history";
const HEALTH_PATH = process.env.CHAT_RENDER_HEALTH_PATH?.trim() || "/health";
const CHAT_RUNTIME_HEADER_NAME = "X-Chat-Runtime";
const CHAT_RUNTIME_HEADER_VALUE =
  process.env.CHAT_RUNTIME_HEADER_VALUE?.trim() || "render-chat-server";
const DEFAULT_CHAT_SERVER_TIMEOUT_MS = 30 * 60_000; // 30 minutes
const MAX_CHAT_SERVER_TIMEOUT_MS = 95 * 60_000; // Keep below common 100-min gateway limits
const DEFAULT_CHAT_ALLOWED_ORIGINS = [
  "https://rowsncolumns.ai",
  "https://www.rowsncolumns.ai",
  "http://localhost:3000",
  "https://localhost:3000",
];
const CHAT_MODEL = process.env.CHAT_MODEL?.trim() || undefined;
const CHAT_PROVIDER = (() => {
  const value = process.env.CHAT_PROVIDER?.trim().toLowerCase();
  if (value === "openai" || value === "anthropic") {
    return value as ChatProvider;
  }
  return undefined;
})();
const CHAT_REASONING_ENABLED = (() => {
  const value = process.env.CHAT_REASONING_ENABLED?.trim().toLowerCase();
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return undefined;
})();
const CHAT_SYSTEM_INSTRUCTIONS =
  process.env.CHAT_SYSTEM_INSTRUCTIONS?.trim() || undefined;

const parsePositiveInt = (value: string | undefined, fallback: number) => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const resolveActiveOrganizationIdForUser = async (
  userId: string,
): Promise<string | null> => {
  const rows = await db<{ organization_id: string }[]>`
    SELECT m."organizationId" AS organization_id
    FROM public.member AS m
    WHERE m."userId" = ${userId}
    ORDER BY m."createdAt" ASC
    LIMIT 1
  `;

  return rows[0]?.organization_id ?? null;
};

const CHAT_SSE_HEARTBEAT_INTERVAL_MS = Math.max(
  0,
  parsePositiveInt(process.env.CHAT_SSE_HEARTBEAT_INTERVAL_MS, 15000),
);

const normalizeAuthBaseUrl = () => {
  const raw =
    process.env.CHAT_AUTH_BASE_URL?.trim() ??
    process.env.BETTER_AUTH_URL?.trim();
  if (!raw) {
    throw new Error(
      "Missing CHAT_AUTH_BASE_URL or BETTER_AUTH_URL for Render chat server.",
    );
  }
  return raw.replace(/\/+$/, "");
};

const AUTH_BASE_URL = normalizeAuthBaseUrl();
const AUTH_BASE_ORIGIN = new URL(AUTH_BASE_URL).origin;
const AUTH_BASE_PATH = (
  process.env.CHAT_AUTH_BASE_PATH?.trim() || "/api/auth"
).replace(/\/+$/, "");
const AUTH_API_BASE = AUTH_BASE_PATH.startsWith("/")
  ? `${AUTH_BASE_URL}${AUTH_BASE_PATH}`
  : `${AUTH_BASE_URL}/${AUTH_BASE_PATH}`;
const CHAT_AUTH_JWKS_URL = process.env.CHAT_AUTH_JWKS_URL?.trim() || undefined;
const CHAT_AUTH_EXPECTED_ISSUER =
  process.env.CHAT_AUTH_EXPECTED_ISSUER?.trim() || AUTH_BASE_ORIGIN;
const CHAT_AUTH_EXPECTED_AUDIENCE =
  process.env.CHAT_AUTH_EXPECTED_AUDIENCE?.trim() || AUTH_BASE_ORIGIN;
const CHAT_SERVER_TIMEOUT_MS = Math.min(
  parsePositiveInt(
    process.env.CHAT_SERVER_TIMEOUT_MS,
    DEFAULT_CHAT_SERVER_TIMEOUT_MS,
  ),
  MAX_CHAT_SERVER_TIMEOUT_MS,
);

const CHAT_ALLOWED_ORIGINS = new Set(
  (process.env.CHAT_ALLOWED_ORIGINS ?? DEFAULT_CHAT_ALLOWED_ORIGINS.join(","))
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

const buildCorsHeaders = (origin: string | null) => {
  const isAllowedOrigin = !!origin && CHAT_ALLOWED_ORIGINS.has(origin);
  if (!isAllowedOrigin) {
    return null;
  }

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  } as const;
};

const resolveRequestOrigin = (req: IncomingMessage): string | null => {
  const originHeader =
    typeof req.headers.origin === "string" ? req.headers.origin.trim() : "";
  if (originHeader) {
    return originHeader;
  }

  const refererHeader =
    typeof req.headers.referer === "string" ? req.headers.referer.trim() : "";
  if (!refererHeader) {
    return null;
  }

  try {
    const refererOrigin = new URL(refererHeader).origin.trim();
    return refererOrigin.length > 0 ? refererOrigin : null;
  } catch {
    return null;
  }
};

const setCorsHeaders = (res: ServerResponse, origin: string | null) => {
  const headers = buildCorsHeaders(origin);
  if (!headers) {
    return false;
  }

  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }

  return true;
};

const setRuntimeHeader = (res: ServerResponse) => {
  res.setHeader(CHAT_RUNTIME_HEADER_NAME, CHAT_RUNTIME_HEADER_VALUE);
};

const sendJson = (
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  payload: unknown,
) => {
  setRuntimeHeader(res);
  const origin = resolveRequestOrigin(req);
  const hasCors = setCorsHeaders(res, origin);
  if (origin && !hasCors) {
    res.statusCode = 403;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Origin is not allowed." }));
    return;
  }

  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
};

const getRequestUrl = (req: IncomingMessage) => {
  const host = req.headers.host ?? "localhost";
  return new URL(req.url ?? "/", `http://${host}`);
};

const parseJsonBody = async <T>(req: IncomingMessage): Promise<T> => {
  const chunks: Buffer[] = [];
  let size = 0;
  const maxBytes = 1024 * 1024; // 1MB

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) {
      throw new Error("Request body too large.");
    }
    chunks.push(buffer);
  }

  const body = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(body) as T;
};

const getHeaderValue = (
  headers: IncomingMessage["headers"],
  name: string,
): string | undefined => {
  const raw = headers[name.toLowerCase()];
  if (Array.isArray(raw)) {
    return raw[0]?.trim() || undefined;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
};

const buildShareDbWsHeaders = (
  headers: IncomingMessage["headers"],
): Record<string, string> => {
  const out: Record<string, string> = {};
  const cookie = getHeaderValue(headers, "cookie");
  if (cookie) {
    out.cookie = cookie;
  }
  const authorization = getHeaderValue(headers, "authorization");
  if (authorization) {
    out.authorization = authorization;
  }
  return out;
};

const getStringClaim = (payload: JwtPayloadLike, key: string) => {
  const value = payload[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const isLikelyJwt = (token: string) => {
  const parts = token.split(".");
  return parts.length === 3 && parts.every((part) => part.length > 0);
};

const buildJwksUrls = () => {
  const candidates = [
    CHAT_AUTH_JWKS_URL,
    `${AUTH_BASE_URL}/.well-known/jwks.json`,
    `${AUTH_BASE_ORIGIN}/.well-known/jwks.json`,
  ];

  const deduped = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate) continue;
    deduped.add(candidate.replace(/\/+$/, ""));
  }
  return [...deduped];
};

const verifyTokenViaVerifyJwtEndpoint = async (
  token: string,
): Promise<JwtPayloadLike | null> => {
  try {
    const response = await fetch(`${AUTH_API_BASE}/verify-jwt`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(4000),
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json().catch(() => null)) as {
      payload?: JwtPayloadLike | null;
      data?: { payload?: JwtPayloadLike | null };
    } | null;
    return payload?.payload ?? payload?.data?.payload ?? null;
  } catch {
    return null;
  }
};

type SessionIntrospectionResult = {
  user?: {
    id?: string;
    email?: string | null;
  } | null;
  session?: {
    token?: string;
    activeOrganizationId?: string | null;
  } | null;
} | null;

type StopChatRunRequest = {
  runId?: string;
  threadId?: string;
};

const tryGetSessionFromCookieName = async (
  cookieName: string,
  token: string,
): Promise<SessionIntrospectionResult> => {
  try {
    const response = await fetch(`${AUTH_API_BASE}/get-session`, {
      method: "GET",
      headers: {
        Cookie: `${cookieName}=${encodeURIComponent(token)}`,
      },
      signal: AbortSignal.timeout(4000),
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response
      .json()
      .catch(() => null)) as SessionIntrospectionResult;
    return payload;
  } catch {
    return null;
  }
};

const verifyTokenViaSessionIntrospection = async (
  token: string,
): Promise<AuthIdentity | null> => {
  const cookieNames = [
    "__Secure-better-auth.session_token",
    "better-auth.session_token",
    "__Secure-neon-auth.session_token",
    "neon-auth.session_token",
    "session_token",
  ] as const;

  for (const cookieName of cookieNames) {
    const sessionData = await tryGetSessionFromCookieName(cookieName, token);
    const userId = sessionData?.user?.id?.trim();
    if (!userId) {
      continue;
    }

    const emailRaw = sessionData?.user?.email;
    const email =
      typeof emailRaw === "string" && emailRaw.trim().length > 0
        ? emailRaw.trim()
        : null;
    const activeOrganizationIdRaw = sessionData?.session?.activeOrganizationId;
    const activeOrganizationId =
      typeof activeOrganizationIdRaw === "string" &&
      activeOrganizationIdRaw.trim().length > 0
        ? activeOrganizationIdRaw.trim()
        : null;

    return { userId, email, activeOrganizationId };
  }

  return null;
};

const verifyTokenViaJwks = async (
  token: string,
): Promise<JwtPayloadLike | null> => {
  const jose = await import("jose");
  const jwksUrls = buildJwksUrls();

  for (const jwksUrl of jwksUrls) {
    try {
      const jwkSet = jose.createRemoteJWKSet(new URL(jwksUrl));
      const { payload } = await jose.jwtVerify(token, jwkSet, {
        issuer: CHAT_AUTH_EXPECTED_ISSUER,
        audience: CHAT_AUTH_EXPECTED_AUDIENCE,
      });
      return payload as JwtPayloadLike;
    } catch {
      continue;
    }
  }

  return null;
};

const identityFromPayload = (payload: JwtPayloadLike): AuthIdentity | null => {
  const userId =
    getStringClaim(payload, "sub") ??
    getStringClaim(payload, "userId") ??
    getStringClaim(payload, "user_id") ??
    getStringClaim(payload, "id");
  if (!userId) return null;

  const email =
    getStringClaim(payload, "email") ??
    getStringClaim(payload, "user_email") ??
    null;

  return { userId, email };
};

const verifyAuthToken = async (token: string): Promise<AuthIdentity | null> => {
  const tokenLooksLikeJwt = isLikelyJwt(token);

  if (tokenLooksLikeJwt) {
    const payload =
      (await verifyTokenViaJwks(token)) ??
      (await verifyTokenViaVerifyJwtEndpoint(token));
    if (payload) {
      const identity = identityFromPayload(payload);
      if (identity) {
        return identity;
      }
    }
  }

  const sessionIdentity = await verifyTokenViaSessionIntrospection(token);
  if (sessionIdentity) {
    return sessionIdentity;
  }

  if (!tokenLooksLikeJwt) {
    const payload = await verifyTokenViaVerifyJwtEndpoint(token);
    if (!payload) {
      return null;
    }

    return identityFromPayload(payload);
  }

  return null;
};

const getBearerToken = (authorizationHeader: string | undefined) => {
  if (!authorizationHeader) return null;
  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1]?.trim();
  return token || null;
};

const parseCookies = (
  cookieHeader: string | undefined,
): Map<string, string> => {
  const cookies = new Map<string, string>();
  if (!cookieHeader) return cookies;

  for (const part of cookieHeader.split(";")) {
    const [name, ...valueParts] = part.split("=");
    const trimmedName = name?.trim();
    if (!trimmedName) continue;
    const value = valueParts.join("=").trim();
    // Decode the cookie value (it may be URL-encoded)
    try {
      cookies.set(trimmedName, decodeURIComponent(value));
    } catch {
      cookies.set(trimmedName, value);
    }
  }

  return cookies;
};

const getSessionTokenFromCookies = (
  cookieHeader: string | undefined,
): string | null => {
  const cookies = parseCookies(cookieHeader);

  // Try different cookie names in order of preference
  const cookieNames = [
    "__Secure-better-auth.session_token",
    "better-auth.session_token",
    "__Secure-neon-auth.session_token",
    "neon-auth.session_token",
    "session_token",
  ];

  for (const name of cookieNames) {
    const value = cookies.get(name);
    if (value && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
};

const startSse = (req: IncomingMessage, res: ServerResponse) => {
  setRuntimeHeader(res);
  const origin = resolveRequestOrigin(req);
  const hasCors = setCorsHeaders(res, origin);
  if (origin && !hasCors) {
    sendJson(req, res, 403, { error: "Origin is not allowed." });
    return false;
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Keep-Alive", "timeout=300");
  res.setHeader("Content-Encoding", "identity");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  return true;
};

const startSseHeartbeat = (res: ServerResponse) => {
  if (CHAT_SSE_HEARTBEAT_INTERVAL_MS <= 0) {
    return () => {};
  }

  const interval = setInterval(() => {
    if (res.writableEnded || res.destroyed) {
      return;
    }
    // SSE comment heartbeat to keep intermediaries from closing idle streams.
    res.write(": keepalive\n\n");
  }, CHAT_SSE_HEARTBEAT_INTERVAL_MS);
  interval.unref?.();

  return () => {
    clearInterval(interval);
  };
};

const writeSseEvent = (res: ServerResponse, event: unknown) => {
  if (res.writableEnded || res.destroyed) {
    return;
  }
  res.write(encodeChatStreamEvent(event as never));
};

const handleChatRequest = async (req: IncomingMessage, res: ServerResponse) => {
  // Try Bearer token first, then fall back to session cookie
  const bearerToken = getBearerToken(req.headers.authorization);
  const sessionToken =
    bearerToken ?? getSessionTokenFromCookies(req.headers.cookie);

  if (!sessionToken) {
    sendJson(req, res, 401, {
      error: "Unauthorized. Bearer token or session cookie is required.",
    });
    return;
  }

  const identity = await verifyAuthToken(sessionToken);
  if (!identity) {
    sendJson(req, res, 401, {
      error: "Unauthorized. Invalid or expired token.",
    });
    return;
  }

  let body: ChatRequestBody;
  try {
    body = await parseJsonBody<ChatRequestBody>(req);
  } catch (error) {
    sendJson(req, res, 400, {
      error:
        error instanceof Error ? error.message : "Invalid JSON request body.",
    });
    return;
  }

  // Mirror Vercel /api/chat behavior: enrich context with resolved user location.
  const userLocation = resolveUserLocation({
    acceptLanguage: getHeaderValue(req.headers, "accept-language"),
    countryCode:
      getHeaderValue(req.headers, "x-vercel-ip-country") ||
      getHeaderValue(req.headers, "cf-ipcountry"),
    timezone:
      getHeaderValue(req.headers, "x-vercel-ip-timezone") ||
      getHeaderValue(req.headers, "cf-timezone"),
  });

  const contextWithLocation = {
    ...(typeof body.context === "object" && body.context !== null
      ? body.context
      : {}),
    userLocation,
  };

  const resolved = resolveChatRequest(
    { ...body, context: contextWithLocation },
    {
      model: CHAT_MODEL,
      provider: CHAT_PROVIDER,
      reasoningEnabled: CHAT_REASONING_ENABLED,
    },
  );
  if (!resolved.ok) {
    sendJson(req, res, resolved.error.status, resolved.error.payload);
    return;
  }
  const chatRequest = resolved.value;

  const isAdmin = isAdminUser({ id: identity.userId, email: identity.email });
  const organizationId =
    identity.activeOrganizationId?.trim() ||
    (await resolveActiveOrganizationIdForUser(identity.userId));
  if (!organizationId) {
    sendJson(req, res, 409, {
      error: "No active organization. Create an organization first.",
      onboardingUrl: "/onboarding/organization",
    });
    return;
  }
  const creditCheck = await ensureChatRunCredits({
    isAdmin,
    userId: identity.userId,
    organizationId,
    threadId: chatRequest.threadId,
    message: chatRequest.message,
  });
  if (!creditCheck.ok) {
    sendJson(req, res, creditCheck.error.status, creditCheck.error.payload);
    return;
  }

  const systemInstructions = await resolveRunSystemInstructions({
    userId: identity.userId,
    request: chatRequest,
    defaultSystemInstructions: CHAT_SYSTEM_INSTRUCTIONS,
  });
  const runRequest = { ...chatRequest, systemInstructions };

  if (!startSse(req, res)) {
    return;
  }
  const stopHeartbeat = startSseHeartbeat(res);

  const runAbortController = new AbortController();
  let activeRunId: string | null = null;
  const timeoutHandle = setTimeout(() => {
    if (!runAbortController.signal.aborted) {
      runAbortController.abort({
        code: "SERVER_TIMEOUT",
        timeoutMs: CHAT_SERVER_TIMEOUT_MS,
        message: `Chat run exceeded server timeout (${Math.ceil(CHAT_SERVER_TIMEOUT_MS / 1000)}s).`,
      } satisfies ChatAbortReason);
    }
  }, CHAT_SERVER_TIMEOUT_MS);
  timeoutHandle.unref?.();

  // Track if client disconnected - we'll stop writing but let the run complete
  let clientDisconnected = false;
  const onClientClose = () => {
    clientDisconnected = true;
    console.log(
      "[render-chat-server] Client disconnected, run will continue in background",
    );
  };
  req.on("close", onClientClose);

  try {
    await executeChatRunStream({
      request: runRequest,
      userId: identity.userId,
      organizationId,
      isAdmin,
      shareDbWsHeaders: buildShareDbWsHeaders(req.headers),
      persistEvents: true,
      abortSignal: runAbortController.signal,
      onRunCreated: (runId) => {
        activeRunId = runId;
        registerChatRunAbortController({
          runId,
          userId: identity.userId,
          threadId: runRequest.threadId,
          controller: runAbortController,
        });
      },
      emitEvent: (event) => {
        // Only write to response if client is still connected
        if (!clientDisconnected && !res.writableEnded && !res.destroyed) {
          writeSseEvent(res, event);
        }
      },
    });
  } finally {
    stopHeartbeat();
    clearTimeout(timeoutHandle);
    if (activeRunId) {
      unregisterChatRunAbortController({ runId: activeRunId });
    }
    req.off("close", onClientClose);

    if (!res.writableEnded && !res.destroyed) {
      res.end();
    }
  }
};

const handleStopRequest = async (req: IncomingMessage, res: ServerResponse) => {
  // Try Bearer token first, then fall back to session cookie
  const bearerToken = getBearerToken(req.headers.authorization);
  const sessionToken =
    bearerToken ?? getSessionTokenFromCookies(req.headers.cookie);

  if (!sessionToken) {
    sendJson(req, res, 401, {
      error: "Unauthorized. Bearer token or session cookie is required.",
    });
    return;
  }

  const identity = await verifyAuthToken(sessionToken);
  if (!identity) {
    sendJson(req, res, 401, {
      error: "Unauthorized. Invalid or expired token.",
    });
    return;
  }

  let body: StopChatRunRequest;
  try {
    body = await parseJsonBody<StopChatRunRequest>(req);
  } catch (error) {
    sendJson(req, res, 400, {
      error:
        error instanceof Error ? error.message : "Invalid JSON request body.",
    });
    return;
  }

  const runId = typeof body.runId === "string" ? body.runId.trim() : "";
  const threadId =
    typeof body.threadId === "string" ? body.threadId.trim() : "";

  if (!runId && !threadId) {
    sendJson(req, res, 400, {
      error: "Either runId or threadId is required.",
    });
    return;
  }

  const reason = {
    code: "CLIENT_ABORT" as const,
    message: "Chat run stopped by user.",
  };

  const dbCancelResult = runId
    ? await requestChatRunCancel({
        userId: identity.userId,
        runId,
        reason: reason.message,
      })
    : await requestThreadRunCancel({
        userId: identity.userId,
        threadId: threadId!,
        reason: reason.message,
      });

  const abortRunId = dbCancelResult.runId || runId;
  const abortThreadId = dbCancelResult.threadId || threadId;
  const result = abortRunId
    ? abortRegisteredChatRun({
        userId: identity.userId,
        runId: abortRunId,
        reason,
      })
    : abortThreadId
      ? abortRegisteredChatRun({
          userId: identity.userId,
          threadId: abortThreadId,
          reason,
        })
      : { stopped: false as const };

  sendJson(req, res, 200, {
    success: true,
    stopped: dbCancelResult.cancelled || result.stopped,
    runId: dbCancelResult.runId ?? result.runId ?? null,
    pending: false,
  });
};

const handleResumeRequest = async (
  req: IncomingMessage,
  res: ServerResponse,
) => {
  // Try Bearer token first, then fall back to session cookie
  const bearerToken = getBearerToken(req.headers.authorization);
  const sessionToken =
    bearerToken ?? getSessionTokenFromCookies(req.headers.cookie);

  if (!sessionToken) {
    sendJson(req, res, 401, {
      error: "Unauthorized. Bearer token or session cookie is required.",
    });
    return;
  }

  const identity = await verifyAuthToken(sessionToken);
  if (!identity) {
    sendJson(req, res, 401, {
      error: "Unauthorized. Invalid or expired token.",
    });
    return;
  }

  const requestUrl = getRequestUrl(req);
  const runId = requestUrl.searchParams.get("runId")?.trim();
  const threadId = requestUrl.searchParams.get("threadId")?.trim();
  const stream = requestUrl.searchParams.get("stream") === "true";
  const lastEventIdParam = requestUrl.searchParams.get("lastEventId")?.trim();
  const lastEventId = lastEventIdParam
    ? Number.parseInt(lastEventIdParam, 10)
    : 0;

  if (!runId && !threadId) {
    sendJson(req, res, 400, {
      error: "Either runId or threadId is required.",
    });
    return;
  }

  // Get the run record
  let run = runId ? await getChatRun({ runId, userId: identity.userId }) : null;

  // If no runId provided, get the latest run for the thread
  if (!run && threadId) {
    run = await getLatestChatRunForThread({
      threadId,
      userId: identity.userId,
    });
  }

  if (!run) {
    sendJson(req, res, 404, {
      error: "Run not found.",
    });
    return;
  }

  // Non-streaming response (for initial check)
  if (!stream) {
    const events = await getChatRunEvents({
      runId: run.runId,
      afterEventId: lastEventId,
    });

    sendJson(req, res, 200, {
      run: {
        runId: run.runId,
        threadId: run.threadId,
        status: run.status,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        errorMessage: run.errorMessage,
      },
      events: events.map((e) => ({
        id: e.id,
        type: e.eventType,
        data: e.eventData,
      })),
      hasMore: run.status === "running",
    });
    return;
  }

  // Streaming response - replay events and continue streaming if still running
  const origin = resolveRequestOrigin(req);
  setCorsHeaders(res, origin);
  setRuntimeHeader(res);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.statusCode = 200;

  const currentRunId = run.runId;
  const userId = identity.userId;
  let currentLastEventId = lastEventId;
  const maxIterations = 300; // 5 minutes max (1 second intervals)
  let iterations = 0;
  let clientDisconnected = false;

  req.on("close", () => {
    clientDisconnected = true;
  });

  try {
    while (iterations < maxIterations && !clientDisconnected) {
      // Get new events
      const events = await getChatRunEvents({
        runId: currentRunId,
        afterEventId: currentLastEventId,
      });

      // Stream each event
      for (const event of events) {
        if (clientDisconnected || res.writableEnded || res.destroyed) {
          break;
        }
        res.write(encodeChatStreamEvent(event.eventData));
        currentLastEventId = Math.max(currentLastEventId, event.id);
      }

      // Check if run is complete
      const updatedRun = await getChatRun({ runId: currentRunId, userId });
      if (!updatedRun || updatedRun.status !== "running") {
        break;
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, 500));
      iterations++;
    }
  } catch (error) {
    console.error("[render-chat-server] Resume stream error:", error);
  }

  if (!res.writableEnded && !res.destroyed) {
    res.end();
  }
};

const handleHistoryRequest = async (
  req: IncomingMessage,
  res: ServerResponse,
) => {
  const method = (req.method ?? "GET").toUpperCase();
  const bearerToken = getBearerToken(req.headers.authorization);
  const sessionToken =
    bearerToken ?? getSessionTokenFromCookies(req.headers.cookie);

  if (!sessionToken) {
    sendJson(req, res, 401, {
      error: "Unauthorized. Bearer token or session cookie is required.",
    });
    return;
  }

  const identity = await verifyAuthToken(sessionToken);
  if (!identity) {
    sendJson(req, res, 401, {
      error: "Unauthorized. Invalid or expired token.",
    });
    return;
  }

  const requestUrl = getRequestUrl(req);

  if (method === "GET") {
    const listMode =
      requestUrl.searchParams.get("list")?.trim().toLowerCase() ?? "";

    if (listMode === "sessions") {
      const limitParam = Number.parseInt(
        requestUrl.searchParams.get("limit")?.trim() ?? "",
        10,
      );
      const limit =
        Number.isFinite(limitParam) && limitParam > 0
          ? Math.min(limitParam, 50)
          : 10;
      const docId = requestUrl.searchParams.get("docId")?.trim() || undefined;
      const currentThreadId =
        requestUrl.searchParams.get("currentThreadId")?.trim() || undefined;

      const sessions = await getSpreadsheetAssistantRecentSessions({
        userId: identity.userId,
        limit,
        ...(docId ? { docId } : {}),
      });

      if (sessions.length === 0 && currentThreadId) {
        try {
          await upsertAssistantSession({
            threadId: currentThreadId,
            userId: identity.userId,
            ...(docId ? { docId } : {}),
          });
        } catch {
          // Ignore fallback touch failures; still return a minimal session entry.
        }

        sendJson(req, res, 200, {
          sessions: [
            {
              threadId: currentThreadId,
              updatedAt: new Date().toISOString(),
            },
          ],
        });
        return;
      }

      sendJson(req, res, 200, { sessions });
      return;
    }

    const threadId = requestUrl.searchParams.get("threadId")?.trim();
    if (!threadId) {
      sendJson(req, res, 400, {
        error: "threadId is required.",
      });
      return;
    }

    const messages = await getSpreadsheetAssistantThreadMessages({
      threadId,
      userId: identity.userId,
    });

    sendJson(req, res, 200, {
      threadId,
      messages,
    });
    return;
  }

  if (method === "DELETE") {
    const listMode =
      requestUrl.searchParams.get("list")?.trim().toLowerCase() ?? "";
    if (listMode !== "sessions") {
      sendJson(req, res, 400, { error: "Unsupported delete operation." });
      return;
    }

    const threadId = requestUrl.searchParams.get("threadId")?.trim();
    if (!threadId) {
      sendJson(req, res, 400, { error: "threadId is required." });
      return;
    }

    const deleted = await deleteAssistantSession({
      threadId,
      userId: identity.userId,
    });

    sendJson(req, res, 200, { deleted, threadId });
    return;
  }

  if (method === "POST") {
    const action = requestUrl.searchParams.get("action")?.trim().toLowerCase();
    if (action !== "fork") {
      sendJson(req, res, 400, {
        error: "Unsupported action. Use action=fork.",
      });
      return;
    }

    type ForkConversationBody = {
      sourceThreadId?: unknown;
      atMessageIndex?: unknown;
      docId?: unknown;
    };

    let body: ForkConversationBody;
    try {
      body = await parseJsonBody<ForkConversationBody>(req);
    } catch (error) {
      sendJson(req, res, 400, {
        error:
          error instanceof Error ? error.message : "Invalid JSON request body.",
      });
      return;
    }

    const sourceThreadId =
      typeof body.sourceThreadId === "string" ? body.sourceThreadId.trim() : "";
    const atMessageIndex =
      typeof body.atMessageIndex === "number" ? body.atMessageIndex : -1;
    const docId =
      typeof body.docId === "string" ? body.docId.trim() : undefined;

    if (!sourceThreadId) {
      sendJson(req, res, 400, { error: "sourceThreadId is required." });
      return;
    }

    if (atMessageIndex < 0) {
      sendJson(req, res, 400, {
        error: "atMessageIndex must be a non-negative number.",
      });
      return;
    }

    const result = await forkThreadAtMessage({
      sourceThreadId,
      userId: identity.userId,
      atMessageIndex,
      ...(docId ? { docId } : {}),
    });

    sendJson(req, res, 200, {
      success: true,
      newThreadId: result.newThreadId,
      title: result.title,
    });
    return;
  }

  sendJson(req, res, 405, { error: "Method not allowed." });
};

const server = createServer(async (req, res) => {
  try {
    const requestUrl = getRequestUrl(req);
    const pathname = requestUrl.pathname;
    const method = (req.method ?? "GET").toUpperCase();

    if (method === "OPTIONS") {
      setRuntimeHeader(res);
      const origin = resolveRequestOrigin(req);
      const hasCors = setCorsHeaders(res, origin);
      if (origin && !hasCors) {
        res.statusCode = 403;
        res.end();
        return;
      }
      res.statusCode = 204;
      res.end();
      return;
    }

    if (method === "GET" && pathname === HEALTH_PATH) {
      sendJson(req, res, 200, { ok: true });
      return;
    }

    if (method === "POST" && pathname === CHAT_PATH) {
      await handleChatRequest(req, res);
      return;
    }

    if (method === "GET" && pathname === CHAT_RESUME_PATH) {
      await handleResumeRequest(req, res);
      return;
    }

    if (method === "POST" && pathname === CHAT_STOP_PATH) {
      await handleStopRequest(req, res);
      return;
    }

    if (
      (method === "GET" || method === "DELETE" || method === "POST") &&
      pathname === CHAT_HISTORY_PATH
    ) {
      await handleHistoryRequest(req, res);
      return;
    }

    sendJson(req, res, 404, { error: "Not found." });
  } catch (error) {
    console.error("[render-chat-server] Unhandled request error:", error);
    if (!res.writableEnded && !res.destroyed) {
      sendJson(req, res, 500, { error: "Internal server error." });
    }
  }
});

const port = parsePositiveInt(process.env.PORT, 8787);
const host = process.env.HOST?.trim() || "0.0.0.0";

server.listen(port, host, () => {
  console.log(
    `[render-chat-server] listening on http://${host}:${port} (chat path: ${CHAT_PATH}, history path: ${CHAT_HISTORY_PATH})`,
  );
});
