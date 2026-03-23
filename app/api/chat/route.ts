import { NextResponse } from "next/server";

import {
  persistAssistantFailureToCheckpoint,
  streamSpreadsheetAssistant,
} from "@/lib/chat/graph";
import { encodeChatStreamEvent } from "@/lib/chat/protocol";
import { chargeUserCreditsForRun, getUserCredits } from "@/lib/credits/repository";
import {
  calculateChatRunCredits,
  MIN_CREDITS_PER_RUN,
} from "@/lib/credits/pricing";
import { isAdminUser } from "@/lib/auth/admin";
import { auth } from "@/lib/auth/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEFAULT_CHAT_SERVER_TIMEOUT_MS = 280_000;
const MAX_CHAT_SERVER_TIMEOUT_MS = 295_000;

type ChatAbortReason = {
  code: "SERVER_TIMEOUT" | "CLIENT_ABORT";
  message: string;
  timeoutMs?: number;
};

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

const isChatAbortReason = (value: unknown): value is ChatAbortReason => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const maybe = value as Partial<ChatAbortReason>;
  return (
    (maybe.code === "SERVER_TIMEOUT" || maybe.code === "CLIENT_ABORT") &&
    typeof maybe.message === "string"
  );
};

type ChatRequestBody = {
  threadId?: string;
  docId?: string;
  message?: string;
  model?: string;
  provider?: string;
  reasoningEnabled?: boolean;
  systemInstructions?: string;
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
    const threadId = body.threadId?.trim();
    const docId = body.docId?.trim();
    const message = body.message?.trim();
    const model = body.model?.trim();
    const provider = body.provider?.trim().toLowerCase();
    const reasoningEnabled =
      typeof body.reasoningEnabled === "boolean"
        ? body.reasoningEnabled
        : undefined;
    const systemInstructions =
      typeof body.systemInstructions === "string"
        ? body.systemInstructions.trim()
        : undefined;

    if (!threadId) {
      return NextResponse.json(
        { error: "threadId is required." },
        { status: 400 },
      );
    }

    if (!message) {
      return NextResponse.json(
        { error: "message is required." },
        { status: 400 },
      );
    }

    if (provider && provider !== "openai" && provider !== "anthropic") {
      return NextResponse.json(
        { error: "provider must be 'openai' or 'anthropic'." },
        { status: 400 },
      );
    }

    if (!isAdmin) {
      const credits = await getUserCredits(userId);
      if (credits.balance < MIN_CREDITS_PER_RUN) {
        const outOfCreditsErrorMessage =
          "Insufficient credits for today. Credits reset to 30 at the next daily reset.";
        await persistAssistantFailureToCheckpoint({
          threadId,
          userId,
          userMessage: message,
          errorMessage: outOfCreditsErrorMessage,
        });

        return NextResponse.json(
          {
            error: outOfCreditsErrorMessage,
            code: "INSUFFICIENT_CREDITS",
            remainingCredits: credits.balance,
          },
          { status: 402 },
        );
      }
    }

    const runId = crypto.randomUUID();
    const chatServerTimeoutMs = parseChatServerTimeoutMs();
    const runAbortController = new AbortController();

    const abortFromClientSignal = () => {
      if (runAbortController.signal.aborted) {
        return;
      }

      runAbortController.abort({
        code: "CLIENT_ABORT",
        message: "Client aborted chat request.",
      } satisfies ChatAbortReason);
    };

    if (request.signal.aborted) {
      abortFromClientSignal();
    } else {
      request.signal.addEventListener("abort", abortFromClientSignal, {
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
        let toolCallCount = 0;
        let messageDeltaChars = 0;
        let messageCompleteChars = 0;
        let isCompleted = false;

        try {
          for await (const event of streamSpreadsheetAssistant({
            threadId,
            userId,
            docId,
            message,
            model,
            provider: provider as "openai" | "anthropic" | undefined,
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

            controller.enqueue(
              encoder.encode(encodeChatStreamEvent(outgoingEvent)),
            );
          }
        } catch (error) {
          const abortReason = runAbortController.signal.reason;
          const timeoutMessage =
            isChatAbortReason(abortReason) &&
            abortReason.code === "SERVER_TIMEOUT"
              ? "This request took too long and hit the server timeout. Ask me to continue, and I will pick up from where I stopped."
              : null;
          const errorMessage =
            timeoutMessage ||
            (error instanceof Error
              ? error.message
              : "Failed to process chat request.");

          controller.enqueue(
            encoder.encode(
              encodeChatStreamEvent({
                type: "error",
                error: errorMessage,
              }),
            ),
          );
        } finally {
          clearTimeout(timeoutHandle);
          request.signal.removeEventListener("abort", abortFromClientSignal);

          if (isCompleted && !isAdmin) {
            const outputChars = Math.max(messageDeltaChars, messageCompleteChars);
            const pricing = calculateChatRunCredits({
              model,
              outputChars,
              toolCallCount,
            });

            try {
              await chargeUserCreditsForRun({
                userId,
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
                userId,
                runId,
                error:
                  chargeError instanceof Error
                    ? chargeError.message
                    : String(chargeError),
              });
            }
          }

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
