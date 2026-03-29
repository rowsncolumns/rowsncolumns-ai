import { NextResponse } from "next/server";

import { auth } from "@/lib/auth/server";
import { isAdminUser } from "@/lib/auth/admin";
import { normalizeAssistantErrorMessage } from "@/lib/chat/errors";
import { encodeChatStreamEvent } from "@/lib/chat/protocol";
import {
  registerChatRunAbortController,
  unregisterChatRunAbortController,
} from "@/lib/chat/run-abort-registry";
import {
  type ChatAbortReason,
  DEFAULT_CHAT_MODE,
  type ChatProvider,
  type ChatRequestBody,
  ensureChatRunCredits,
  executeChatRunStream,
  parseChatMode,
  resolveRunSystemInstructions,
  resolveChatRequest,
} from "@/lib/chat/server-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // Vercel limit (Railway ignores this)

const DEFAULT_CHAT_SERVER_TIMEOUT_MS = 600_000; // 10 minutes
const MAX_CHAT_SERVER_TIMEOUT_MS = 600_000; // 10 minutes

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
const CHAT_MODE = (() => {
  const parsed = parseChatMode(process.env.CHAT_MODE);
  return parsed ?? DEFAULT_CHAT_MODE;
})();
const CHAT_SYSTEM_INSTRUCTIONS =
  process.env.CHAT_SYSTEM_INSTRUCTIONS?.trim() || undefined;

const parseChatServerTimeoutMs = () => {
  const rawValue = process.env.CHAT_SERVER_TIMEOUT_MS?.trim();
  if (!rawValue) {
    return DEFAULT_CHAT_SERVER_TIMEOUT_MS;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_CHAT_SERVER_TIMEOUT_MS;
  }

  return Math.min(parsed, MAX_CHAT_SERVER_TIMEOUT_MS);
};

export async function POST(request: Request) {
  try {
    const { data: session } = await auth.getSession();
    const user = session?.user;
    const userId = user?.id;
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized. Please sign in to continue." },
        { status: 401 },
      );
    }
    const isAdmin = isAdminUser({ id: user.id, email: user.email });

    const body = (await request.json()) as ChatRequestBody;
    const resolved = resolveChatRequest(body, {
      model: CHAT_MODEL,
      mode: CHAT_MODE,
      provider: CHAT_PROVIDER,
      reasoningEnabled: CHAT_REASONING_ENABLED,
    });
    if (!resolved.ok) {
      return NextResponse.json(resolved.error.payload, {
        status: resolved.error.status,
      });
    }
    const chatRequest = resolved.value;

    const creditCheck = await ensureChatRunCredits({
      isAdmin,
      userId,
      threadId: chatRequest.threadId,
      message: chatRequest.message,
    });
    if (!creditCheck.ok) {
      return NextResponse.json(creditCheck.error.payload, {
        status: creditCheck.error.status,
      });
    }

    const systemInstructions = await resolveRunSystemInstructions({
      userId,
      request: chatRequest,
      defaultSystemInstructions: CHAT_SYSTEM_INSTRUCTIONS,
    });
    const runRequest = { ...chatRequest, systemInstructions };

    const chatServerTimeoutMs = parseChatServerTimeoutMs();
    const runAbortController = new AbortController();
    let activeRunId: string | null = null;

    // Track client disconnection - we'll stop writing but let the run complete
    let clientDisconnected = false;
    const onClientDisconnect = () => {
      clientDisconnected = true;
      console.log(
        "[api/chat] Client disconnected, run will continue in background",
      );
    };

    if (request.signal.aborted) {
      onClientDisconnect();
    } else {
      request.signal.addEventListener("abort", onClientDisconnect, {
        once: true,
      });
    }

    const timeoutHandle = setTimeout(() => {
      if (runAbortController.signal.aborted) {
        return;
      }

      runAbortController.abort({
        code: "SERVER_TIMEOUT",
        timeoutMs: chatServerTimeoutMs,
        message: `Chat run exceeded server timeout (${Math.ceil(chatServerTimeoutMs / 1000)}s).`,
      } satisfies ChatAbortReason);
    }, chatServerTimeoutMs);
    timeoutHandle.unref?.();

    const encoder = new TextEncoder();
    const SSE_HEARTBEAT_INTERVAL_MS = 15_000; // 15 seconds

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        // SSE heartbeat: send comment lines to keep connection alive
        const heartbeatHandle = setInterval(() => {
          if (!clientDisconnected) {
            // SSE comment format - ignored by parsers but keeps connection alive
            controller.enqueue(encoder.encode(": ping\n\n"));
          }
        }, SSE_HEARTBEAT_INTERVAL_MS);

        try {
          await executeChatRunStream({
            request: runRequest,
            userId,
            isAdmin,
            persistEvents: true,
            abortSignal: runAbortController.signal,
            onRunCreated: (runId) => {
              activeRunId = runId;
              registerChatRunAbortController({
                runId,
                userId,
                threadId: runRequest.threadId,
                controller: runAbortController,
              });
            },
            emitEvent: (event) => {
              // Only write to stream if client is still connected
              if (!clientDisconnected) {
                controller.enqueue(
                  encoder.encode(encodeChatStreamEvent(event as never)),
                );
              }
            },
          });
        } catch (streamError) {
          // Ensure any uncaught errors are sent to the client as error events
          const rawMessage =
            streamError instanceof Error
              ? streamError.message
              : "Assistant request failed.";
          const errorMessage = normalizeAssistantErrorMessage(
            rawMessage,
            "Assistant request failed.",
          );
          controller.enqueue(
            encoder.encode(
              encodeChatStreamEvent({ type: "error", error: errorMessage }),
            ),
          );
        } finally {
          clearInterval(heartbeatHandle);
          clearTimeout(timeoutHandle);
          if (activeRunId) {
            unregisterChatRunAbortController({ runId: activeRunId });
          }
          request.signal.removeEventListener("abort", onClientDisconnect);
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to process chat request.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
