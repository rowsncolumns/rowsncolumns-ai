import { NextResponse } from "next/server";

import { auth } from "@/lib/auth/server";
import { getSpreadsheetAssistantThreadMessages } from "@/lib/chat/graph";

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
