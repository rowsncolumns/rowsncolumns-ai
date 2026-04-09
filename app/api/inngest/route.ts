import { serve } from "inngest/next";

import { processDocumentImportJob } from "@/lib/inngest/functions/process-document-import";
import { sendWeeklyUserCheckInEmails } from "@/lib/inngest/functions/send-weekly-user-check-in";
import { inngest } from "@/lib/inngest/client";

export const runtime = "nodejs";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [processDocumentImportJob, sendWeeklyUserCheckInEmails],
});
