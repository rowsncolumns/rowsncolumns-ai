import { NextResponse } from "next/server";

import { auth } from "@/lib/auth/server";
import { getDocumentImportJobByIdForUser } from "@/lib/documents/import-jobs-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  try {
    const { data: session } = await auth.getSession();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const params = await context.params;
    const jobId =
      typeof params.jobId === "string" ? params.jobId.trim() : "";
    if (!jobId) {
      return NextResponse.json({ error: "Invalid import job id." }, { status: 400 });
    }

    const job = await getDocumentImportJobByIdForUser(jobId, userId);
    if (!job) {
      return NextResponse.json({ error: "Import job not found." }, { status: 404 });
    }

    return NextResponse.json({
      jobId: job.id,
      status: job.status,
      phase: job.phase,
      progressPercent: job.progressPercent,
      documentId: job.docId,
      error: job.errorMessage,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to read import status.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
