import { serve } from "inngest/next";

import { processDocumentImportJob } from "@/lib/inngest/functions/process-document-import";
import { inngest } from "@/lib/inngest/client";

export const runtime = "nodejs";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [processDocumentImportJob],
});
