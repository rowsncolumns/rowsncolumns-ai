import { NextResponse } from "next/server";

import { auth } from "@/lib/auth/server";
import { abortRegisteredChatRun } from "@/lib/chat/run-abort-registry";
import {
  requestChatRunCancel,
  requestThreadRunCancel,
} from "@/lib/chat/runs-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StopChatRunRequest = {
  runId?: string;
  threadId?: string;
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

    const body = (await request.json().catch(() => null)) as
      | StopChatRunRequest
      | null;
    const runId =
      typeof body?.runId === "string" ? body.runId.trim() : undefined;
    const threadId =
      typeof body?.threadId === "string" ? body.threadId.trim() : undefined;

    if (!runId && !threadId) {
      return NextResponse.json(
        { error: "Either runId or threadId is required." },
        { status: 400 },
      );
    }

    const reason = {
      code: "CLIENT_ABORT" as const,
      message: "Chat run stopped by user.",
    };

    const dbCancelResult = runId
      ? await requestChatRunCancel({
          userId,
          runId,
          reason: reason.message,
        })
      : await requestThreadRunCancel({
          userId,
          threadId: threadId!,
          reason: reason.message,
        });

    const abortRunId = dbCancelResult.runId ?? runId;
    const abortThreadId = dbCancelResult.threadId ?? threadId;

    let result =
      abortRunId !== undefined
        ? abortRegisteredChatRun({ userId, runId: abortRunId, reason })
        : abortThreadId
          ? abortRegisteredChatRun({ userId, threadId: abortThreadId, reason })
          : { stopped: false as const };

    return NextResponse.json({
      success: true,
      stopped: dbCancelResult.cancelled || result.stopped,
      runId: dbCancelResult.runId ?? result.runId ?? null,
      pending: false,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to stop chat run.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
