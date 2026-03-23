import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

import {
  persistAssistantFailureToCheckpoint,
  streamSpreadsheetAssistant,
} from "@/lib/chat/graph";
import { encodeChatStreamEvent } from "@/lib/chat/protocol";
import { normalizeAssistantErrorMessage } from "@/lib/chat/errors";
import { isAdminUser } from "@/lib/auth/admin";
import {
  calculateChatRunCredits,
  MIN_CREDITS_PER_RUN,
} from "@/lib/credits/pricing";
import {
  chargeUserCreditsForRun,
  getUserCredits,
} from "@/lib/credits/repository";

type ChatRequestBody = {
  threadId?: string;
  docId?: string;
  message?: string;
  reasoningEnabled?: boolean;
};

type ChatAbortReason = {
  code: "SERVER_TIMEOUT" | "CLIENT_ABORT";
  message: string;
  timeoutMs?: number;
};

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
const HEALTH_PATH = process.env.CHAT_RENDER_HEALTH_PATH?.trim() || "/health";
const DEFAULT_CHAT_SERVER_TIMEOUT_MS = 30 * 60_000; // 30 minutes
const MAX_CHAT_SERVER_TIMEOUT_MS = 95 * 60_000; // Keep below common 100-min gateway limits
const DEFAULT_CHAT_ALLOWED_ORIGINS = [
  "https://rowsncolumns.ai",
  "https://www.rowsncolumns.ai",
  "http://localhost:3000",
];
const CHAT_MODEL = process.env.CHAT_MODEL?.trim() || undefined;
const CHAT_PROVIDER = (() => {
  const value = process.env.CHAT_PROVIDER?.trim().toLowerCase();
  if (value === "openai" || value === "anthropic") {
    return value;
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

const sendJson = (
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  payload: unknown,
) => {
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

    const payload = (await response.json().catch(() => null)) as
      | { payload?: JwtPayloadLike | null; data?: { payload?: JwtPayloadLike | null } }
      | null;
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

    const payload = (await response.json().catch(() => null)) as SessionIntrospectionResult;
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

const startSse = (req: IncomingMessage, res: ServerResponse) => {
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
  res.setHeader("X-Accel-Buffering", "no");
  return true;
};

const toProvider = (provider: string | undefined) => {
  const normalized = provider?.trim().toLowerCase();
  if (normalized === "anthropic") return "anthropic" as const;
  if (normalized === "openai") return "openai" as const;
  return undefined;
};

const writeSseEvent = (res: ServerResponse, event: unknown) => {
  if (res.writableEnded || res.destroyed) {
    return;
  }
  res.write(encodeChatStreamEvent(event as never));
};

const handleChatRequest = async (req: IncomingMessage, res: ServerResponse) => {
  const bearerToken = getBearerToken(req.headers.authorization);
  if (!bearerToken) {
    sendJson(req, res, 401, {
      error: "Unauthorized. Bearer token is required.",
    });
    return;
  }

  const identity = await verifyAuthToken(bearerToken);
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

  const threadId = body.threadId?.trim();
  const docId = body.docId?.trim();
  const message = body.message?.trim();
  const model = CHAT_MODEL;
  const provider = CHAT_PROVIDER;
  const reasoningEnabled =
    typeof body.reasoningEnabled === "boolean"
      ? body.reasoningEnabled
      : CHAT_REASONING_ENABLED;
  const systemInstructions = CHAT_SYSTEM_INSTRUCTIONS;

  if (!threadId) {
    sendJson(req, res, 400, { error: "threadId is required." });
    return;
  }

  if (!message) {
    sendJson(req, res, 400, { error: "message is required." });
    return;
  }

  const isAdmin = isAdminUser({ id: identity.userId, email: identity.email });
  if (!isAdmin) {
    const credits = await getUserCredits(identity.userId);
    if (credits.balance < MIN_CREDITS_PER_RUN) {
      const outOfCreditsErrorMessage =
        "Insufficient credits for today. Credits reset to 30 at the next daily reset.";
      await persistAssistantFailureToCheckpoint({
        threadId,
        userId: identity.userId,
        userMessage: message,
        errorMessage: outOfCreditsErrorMessage,
      });

      sendJson(req, res, 402, {
        error: outOfCreditsErrorMessage,
        code: "INSUFFICIENT_CREDITS",
        remainingCredits: credits.balance,
      });
      return;
    }
  }

  if (!startSse(req, res)) {
    return;
  }

  const runId = crypto.randomUUID();
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

  const abortFromClientClose = () => {
    if (!runAbortController.signal.aborted) {
      runAbortController.abort({
        code: "CLIENT_ABORT",
        message: "Client disconnected.",
      } satisfies ChatAbortReason);
    }
  };

  req.on("close", abortFromClientClose);

  let toolCallCount = 0;
  let messageDeltaChars = 0;
  let messageCompleteChars = 0;
  let isCompleted = false;

  try {
    for await (const event of streamSpreadsheetAssistant({
      threadId,
      userId: identity.userId,
      docId,
      message,
      model,
      provider: toProvider(provider),
      reasoningEnabled,
      systemInstructions,
      abortSignal: runAbortController.signal,
    })) {
      if (event.type === "tool.call") {
        toolCallCount += 1;
      }

      if (event.type === "message.delta") {
        messageDeltaChars += event.delta.length;
      }

      if (event.type === "message.complete") {
        isCompleted = true;
        messageCompleteChars = Math.max(
          messageCompleteChars,
          event.message.length,
        );
      }

      const outgoingEvent =
        event.type === "message.complete" ? { ...event, runId } : event;
      writeSseEvent(res, outgoingEvent);
    }
  } catch (error) {
    if (!res.writableEnded && !res.destroyed) {
      const errorMessage = normalizeAssistantErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to process chat request.",
        "Failed to process chat request.",
      );
      writeSseEvent(res, {
        type: "error",
        error: errorMessage,
      });
    }
  } finally {
    clearTimeout(timeoutHandle);
    req.off("close", abortFromClientClose);

    if (isCompleted && !isAdmin) {
      const outputChars = Math.max(messageDeltaChars, messageCompleteChars);
      const pricing = calculateChatRunCredits({
        model,
        outputChars,
        toolCallCount,
      });

      try {
        await chargeUserCreditsForRun({
          userId: identity.userId,
          runId,
          requestedCredits: pricing.credits,
          metadata: {
            threadId,
            docId,
            model,
            provider,
            outputChars,
            toolCallCount,
            pricing,
          },
        });
      } catch (chargeError) {
        console.error("[credits] Failed to charge user credits", {
          userId: identity.userId,
          runId,
          error:
            chargeError instanceof Error
              ? chargeError.message
              : String(chargeError),
        });
      }
    }

    if (!res.writableEnded && !res.destroyed) {
      res.end();
    }
  }
};

const server = createServer(async (req, res) => {
  try {
    const requestUrl = getRequestUrl(req);
    const pathname = requestUrl.pathname;
    const method = (req.method ?? "GET").toUpperCase();

    if (method === "OPTIONS") {
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
