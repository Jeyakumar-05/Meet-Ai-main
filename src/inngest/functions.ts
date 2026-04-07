import { eq } from "drizzle-orm";
import { createAgent, openai, TextMessage } from "@inngest/agent-kit";

import { db } from "@/db";
import { meetings } from "@/db/schema";
import { inngest } from "@/inngest/client";

const summarizer = createAgent({
  name: "summarizer",
  system: `
    You are an expert summarizer. You write readable, concise, simple content. You are given a transcript of a meeting and you need to summarize it.

Use the following markdown structure for every output:

### Overview
Provide a detailed, engaging summary of the session's content. Focus on major features, user workflows, and any key takeaways. Write in a narrative style, using full sentences. Highlight unique or powerful aspects of the product, platform, or discussion.

### Notes
Break down key content into thematic sections with timestamp ranges (if available, otherwise just logical sections). Each section should summarize key points, actions, or demos in bullet format.

Example:
#### Section Name
- Main point or demo shown here
- Another key insight or interaction
- Follow-up tool or explanation provided

#### Next Section
- Feature X automatically does Y
- Mention of integration with Z
  `.trim(),
  model: openai({
    model: "llama-3.3-70b-versatile",
    apiKey: process.env.GROQ_API_KEY,
    baseUrl: "https://api.groq.com/openai/v1/",
  }),
});

export const meetingsProcessing = inngest.createFunction(
  { id: "meeting-completed", name: "Meeting Completed Processing" },
  { event: "meeting.completed" },
  async ({ event, step }) => {
    const { meetingId } = event.data;

    console.log(`[inngest] Starting processing for meeting: ${meetingId}`);

    // Update status to processing
    await step.run("update-status-processing", async () => {
      await db
        .update(meetings)
        .set({ status: "processing" })
        .where(eq(meetings.id, meetingId));
    });

    try {
      // 1. Get meeting data (specifically our internal transcript field)
      const meeting = await step.run("get-meeting-data", async () => {
        const [m] = await db
          .select()
          .from(meetings)
          .where(eq(meetings.id, meetingId));
        return m;
      });

      if (!meeting) throw new Error("Meeting not found");

      // 2. Parse or provide mock transcript
      const transcriptData = await step.run("prepare-transcript", async () => {
        if (!meeting.transcript) {
          console.warn(`[inngest] No transcript found for meeting ${meetingId}. Using mock data for testing.`);
          return [
            { role: "assistant", content: "Hello! How can I help you today?" },
            { role: "user", content: "Can you tell me about the project status?" },
            { role: "assistant", content: "The project is on track for the Q3 release. We have completed the core backend migration." }
          ];
        }

        try {
          return JSON.parse(meeting.transcript);
        } catch (e) {
          console.warn(`[inngest] Failed to parse transcript JSON for ${meetingId}. Using raw text.`);
          return [{ role: "user", content: meeting.transcript }];
        }
      });

      // 3. Generate summary using Groq Agent
      console.log(`[inngest] Generating summary via Groq for meeting: ${meetingId}`);
      
      const { output } = await summarizer.run(
        "Summarize the following meeting transcript: " +
          JSON.stringify(transcriptData)
      );

      const summaryText = (output[0] as TextMessage).content as string;
      console.log(`[inngest] Summary generated successfully.`);

      // 4. Save results
      await step.run("save-results", async () => {
        await db
          .update(meetings)
          .set({
            summary: summaryText,
            status: "completed",
            endedAt: new Date(),
          })
          .where(eq(meetings.id, meetingId));
        
        console.log(`[inngest] Successfully processed meeting: ${meetingId}`);
      });

    } catch (error) {
      console.error(`[inngest] Error processing meeting ${meetingId}:`, error);
      
      await step.run("save-fallback-results", async () => {
        await db
          .update(meetings)
          .set({
            status: "completed",
            summary: "An error occurred during summary generation. Please check the transcript.",
            endedAt: new Date(),
          })
          .where(eq(meetings.id, meetingId));
      });
    }

    return { success: true, meetingId };
  }
);
