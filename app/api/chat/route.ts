import { NextResponse } from "next/server";

import { auth } from "@/lib/auth/server";
import { isAdminUser } from "@/lib/auth/admin";
import { normalizeAssistantErrorMessage } from "@/lib/chat/errors";
import { encodeChatStreamEvent } from "@/lib/chat/protocol";
import {
  type ChatAbortReason,
  type ChatProvider,
  type ChatRequestBody,
  ensureChatRunCredits,
  executeChatRunStream,
  resolveRunSystemInstructions,
  resolveChatRequest,
} from "@/lib/chat/server-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEFAULT_CHAT_SERVER_TIMEOUT_MS = 280_000;
const MAX_CHAT_SERVER_TIMEOUT_MS = 295_000;

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
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          await executeChatRunStream({
            request: runRequest,
            userId,
            isAdmin,
            persistEvents: true,
            abortSignal: runAbortController.signal,
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
          clearTimeout(timeoutHandle);
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
