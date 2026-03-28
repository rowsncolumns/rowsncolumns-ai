import { NextResponse } from "next/server";

import { auth } from "@/lib/auth/server";
import {
  getChatRun,
  getChatRunEvents,
  getLatestChatRunForThread,
} from "@/lib/chat/runs-repository";
import { encodeChatStreamEvent } from "@/lib/chat/protocol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // Vercel limit (Railway ignores this)

export async function GET(request: Request) {
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

    const url = new URL(request.url);
    const runId = url.searchParams.get("runId")?.trim();
    const threadId = url.searchParams.get("threadId")?.trim();
    const stream = url.searchParams.get("stream") === "true";
    const lastEventIdParam = url.searchParams.get("lastEventId")?.trim();
    const lastEventId = lastEventIdParam
      ? Number.parseInt(lastEventIdParam, 10)
      : 0;

    if (!runId && !threadId) {
      return NextResponse.json(
        { error: "Either runId or threadId is required." },
        { status: 400 },
      );
    }

    // Get the run record
    let run = runId ? await getChatRun({ runId, userId }) : null;

    // If no runId provided, get the latest run for the thread
    if (!run && threadId) {
      run = await getLatestChatRunForThread({ threadId, userId });
    }

    if (!run) {
      return NextResponse.json({ error: "Run not found." }, { status: 404 });
    }

    // Non-streaming response (for initial check)
    if (!stream) {
      const events = await getChatRunEvents({
        runId: run.runId,
        afterEventId: lastEventId,
      });

      return NextResponse.json({
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
    }

    // Streaming response - replay events and continue streaming if still running
    const encoder = new TextEncoder();
    const currentRunId = run.runId;
    const SSE_HEARTBEAT_INTERVAL_MS = 15_000; // 15 seconds

    const readable = new ReadableStream({
      async start(controller) {
        let currentLastEventId = lastEventId;
        let isRunning = run!.status === "running";
        const maxIterations = 1200; // 10 minutes max (500ms intervals)
        let iterations = 0;

        // SSE heartbeat: send comment lines to keep connection alive
        const heartbeatHandle = setInterval(() => {
          controller.enqueue(encoder.encode(": ping\n\n"));
        }, SSE_HEARTBEAT_INTERVAL_MS);

        try {
          while (iterations < maxIterations) {
            // Get new events
            const events = await getChatRunEvents({
              runId: currentRunId,
              afterEventId: currentLastEventId,
            });

            // Stream each event
            for (const event of events) {
              const encoded = encoder.encode(
                encodeChatStreamEvent(event.eventData),
              );
              controller.enqueue(encoded);
              currentLastEventId = Math.max(currentLastEventId, event.id);
            }

            // Check if run is complete
            const updatedRun = await getChatRun({ runId: currentRunId, userId });
            if (!updatedRun || updatedRun.status !== "running") {
              isRunning = false;
              break;
            }

            // Wait before next poll
            await new Promise((resolve) => setTimeout(resolve, 500));
            iterations++;
          }

          controller.close();
        } catch (error) {
          console.error("[api/chat/resume] Stream error:", error);
          controller.error(error);
        } finally {
          clearInterval(heartbeatHandle);
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("[api/chat/resume] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch run status." },
      { status: 500 },
    );
  }
}
