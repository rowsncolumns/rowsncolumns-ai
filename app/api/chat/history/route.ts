import { NextResponse } from "next/server";

import { auth } from "@/lib/auth/server";
import {
  forkThreadAtMessage,
  getSpreadsheetAssistantRecentSessions,
  getSpreadsheetAssistantThreadMessages,
} from "@/lib/chat/graph";
import {
  deleteAssistantSession,
  upsertAssistantSession,
} from "@/lib/chat/sessions-repository";

export const runtime = "nodejs";

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
    const listMode = url.searchParams.get("list")?.trim().toLowerCase() ?? "";
    if (listMode === "sessions") {
      const limitParam = Number.parseInt(
        url.searchParams.get("limit")?.trim() ?? "",
        10,
      );
      const limit =
        Number.isFinite(limitParam) && limitParam > 0
          ? Math.min(limitParam, 50)
          : 10;
      const docId = url.searchParams.get("docId")?.trim() || undefined;
      const currentThreadId =
        url.searchParams.get("currentThreadId")?.trim() || undefined;
      const sessions = await getSpreadsheetAssistantRecentSessions({
        userId,
        limit,
        ...(docId ? { docId } : {}),
      });

      if (sessions.length === 0 && currentThreadId) {
        try {
          await upsertAssistantSession({
            threadId: currentThreadId,
            userId,
            ...(docId ? { docId } : {}),
          });
        } catch {
          // Ignore fallback touch failures; still return a minimal session entry.
        }

        return NextResponse.json({
          sessions: [
            {
              threadId: currentThreadId,
              updatedAt: new Date().toISOString(),
            },
          ],
        });
      }

      return NextResponse.json({
        sessions,
      });
    }

    const threadId = url.searchParams.get("threadId")?.trim();
    if (!threadId) {
      return NextResponse.json(
        { error: "threadId is required." },
        { status: 400 },
      );
    }

    const messages = await getSpreadsheetAssistantThreadMessages({
      threadId,
      userId,
    });

    return NextResponse.json({
      threadId,
      messages,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to load chat history.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
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
    const listMode = url.searchParams.get("list")?.trim().toLowerCase() ?? "";
    if (listMode !== "sessions") {
      return NextResponse.json(
        { error: "Unsupported delete operation." },
        { status: 400 },
      );
    }

    const threadId = url.searchParams.get("threadId")?.trim();
    if (!threadId) {
      return NextResponse.json(
        { error: "threadId is required." },
        { status: 400 },
      );
    }

    const deleted = await deleteAssistantSession({
      threadId,
      userId,
    });

    return NextResponse.json({
      deleted,
      threadId,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to delete chat session.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

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

    const url = new URL(request.url);
    const action = url.searchParams.get("action")?.trim().toLowerCase() ?? "";

    if (action !== "fork") {
      return NextResponse.json(
        { error: "Unsupported action. Use action=fork." },
        { status: 400 },
      );
    }

    const body = await request.json();
    const sourceThreadId =
      typeof body?.sourceThreadId === "string"
        ? body.sourceThreadId.trim()
        : "";
    const atMessageIndex =
      typeof body?.atMessageIndex === "number" ? body.atMessageIndex : -1;
    const docId =
      typeof body?.docId === "string" ? body.docId.trim() : undefined;

    if (!sourceThreadId) {
      return NextResponse.json(
        { error: "sourceThreadId is required." },
        { status: 400 },
      );
    }

    if (atMessageIndex < 0) {
      return NextResponse.json(
        { error: "atMessageIndex must be a non-negative number." },
        { status: 400 },
      );
    }

    const result = await forkThreadAtMessage({
      sourceThreadId,
      userId,
      atMessageIndex,
      docId,
    });

    return NextResponse.json({
      success: true,
      newThreadId: result.newThreadId,
      title: result.title,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fork conversation.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
