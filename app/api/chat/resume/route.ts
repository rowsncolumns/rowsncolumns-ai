import { NextResponse } from "next/server";

import { auth } from "@/lib/auth/server";
import {
  getChatRun,
  getChatRunEvents,
  getLatestChatRunForThread,
} from "@/lib/chat/runs-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

    // Get events since lastEventId
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
  } catch (error) {
    console.error("[api/chat/resume] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch run status." },
      { status: 500 },
    );
  }
}
