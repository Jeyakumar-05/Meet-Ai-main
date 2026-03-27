import { serve } from "inngest/next";

import { inngest } from "@/inngest/client";
import { meetingsProcessing } from "@/inngest/functions";

// Using explicit destructured export for Next.js App Router
const handler = serve({
  client: inngest,
  functions: [
    meetingsProcessing,
  ],
});

export { handler as GET, handler as POST, handler as PUT };
