import { NextResponse } from "next/server";

import { streamSpreadsheetAssistant } from "@/lib/chat/graph";
import { encodeChatStreamEvent } from "@/lib/chat/protocol";
import { chargeUserCreditsForRun, getUserCredits } from "@/lib/credits/repository";
import {
  calculateChatRunCredits,
  MIN_CREDITS_PER_RUN,
} from "@/lib/credits/pricing";
import { auth } from "@/lib/auth/server";

export const runtime = "nodejs";

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
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized. Please sign in to continue." },
        { status: 401 },
      );
    }

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

    const credits = await getUserCredits(userId);
    if (credits.balance < MIN_CREDITS_PER_RUN) {
      return NextResponse.json(
        {
          error: "Insufficient credits. Please top up to continue.",
          code: "INSUFFICIENT_CREDITS",
          remainingCredits: credits.balance,
        },
        { status: 402 },
      );
    }

    const runId = crypto.randomUUID();

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
            docId,
            message,
            model,
            provider: provider as "openai" | "anthropic" | undefined,
            reasoningEnabled,
            systemInstructions,
            abortSignal: request.signal,
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
          const errorMessage =
            error instanceof Error
              ? error.message
              : "Failed to process chat request.";

          controller.enqueue(
            encoder.encode(
              encodeChatStreamEvent({
                type: "error",
                error: errorMessage,
              }),
            ),
          );
        } finally {
          if (isCompleted) {
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
