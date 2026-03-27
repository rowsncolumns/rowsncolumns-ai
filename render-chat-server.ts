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
import {
  getChatRun,
  getChatRunEvents,
  getLatestChatRunForThread,
} from "@/lib/chat/runs-repository";

type AuthIdentity = {
  userId: string;
  email: string | null;
};

type JwtPayloadLike = {
  sub?: unknown;
  email?: unknown;
  [key: string]: unknown;
};

const CHAT_PATH = process.env.CHAT_RENDER_PATH?.trim() || "/chat";
const CHAT_RESUME_PATH = process.env.CHAT_RESUME_PATH?.trim() || "/chat/resume";
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

const CHAT_SSE_HEARTBEAT_INTERVAL_MS = Math.max(
  0,
  parsePositiveInt(process.env.CHAT_SSE_HEARTBEAT_INTERVAL_MS, 15000),
);

const normalizeAuthBaseUrl = () => {
  const raw = process.env.NEON_AUTH_BASE_URL?.trim();
  if (!raw) {
    throw new Error("Missing NEON_AUTH_BASE_URL for Render chat server.");
  }
  return raw.replace(/\/+$/, "");
};

const AUTH_BASE_URL = normalizeAuthBaseUrl();
const AUTH_BASE_ORIGIN = new URL(AUTH_BASE_URL).origin;
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
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  } as const;
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
  const origin = req.headers.origin ?? null;
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
    const response = await fetch(`${AUTH_BASE_URL}/verify-jwt`, {
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
  } | null;
} | null;

const tryGetSessionFromCookieName = async (
  cookieName: string,
  token: string,
): Promise<SessionIntrospectionResult> => {
  try {
    const response = await fetch(`${AUTH_BASE_URL}/get-session`, {
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

    return { userId, email };
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
  const origin = req.headers.origin ?? null;
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

  const resolved = resolveChatRequest(body, {
    model: CHAT_MODEL,
    provider: CHAT_PROVIDER,
    reasoningEnabled: CHAT_REASONING_ENABLED,
  });
  if (!resolved.ok) {
    sendJson(req, res, resolved.error.status, resolved.error.payload);
    return;
  }
  const chatRequest = resolved.value;

  const isAdmin = isAdminUser({ id: identity.userId, email: identity.email });
  const creditCheck = await ensureChatRunCredits({
    isAdmin,
    userId: identity.userId,
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
      isAdmin,
      persistEvents: true,
      abortSignal: runAbortController.signal,
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
    req.off("close", onClientClose);

    if (!res.writableEnded && !res.destroyed) {
      res.end();
    }
  }
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
  const origin = req.headers.origin ?? null;
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

const server = createServer(async (req, res) => {
  try {
    const requestUrl = getRequestUrl(req);
    const pathname = requestUrl.pathname;
    const method = (req.method ?? "GET").toUpperCase();

    if (method === "OPTIONS") {
      setRuntimeHeader(res);
      const origin = req.headers.origin ?? null;
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
    `[render-chat-server] listening on http://${host}:${port} (chat path: ${CHAT_PATH})`,
  );
});
