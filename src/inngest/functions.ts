import { eq, inArray } from "drizzle-orm";
import JSONL from "jsonl-parse-stringify";
import { createAgent, openai, TextMessage } from "@inngest/agent-kit";

import { db } from "@/db";
import { agents, meetings, user } from "@/db/schema";
import { inngest } from "@/inngest/client";
import { streamVideo } from "@/lib/stream-video";

import { StreamTranscriptItem } from "@/modules/meetings/types";

const summarizer = createAgent({
  name: "summarizer",
  system: `
    You are an expert summarizer. You write readable, concise, simple content. You are given a transcript of a meeting and you need to summarize it.

Use the following markdown structure for every output:

### Overview
Provide a detailed, engaging summary of the session's content. Focus on major features, user workflows, and any key takeaways. Write in a narrative style, using full sentences. Highlight unique or powerful aspects of the product, platform, or discussion.

### Notes
Break down key content into thematic sections with timestamp ranges. Each section should summarize key points, actions, or demos in bullet format.

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

    // Wait and fetch transcript from Stream if not already present in DB
    const transcriptUrl = await step.run("fetch-transcript-url", async () => {
      const [meeting] = await db
        .select()
        .from(meetings)
        .where(eq(meetings.id, meetingId));

      if (meeting?.transcriptUrl) return meeting.transcriptUrl;

      // Try to fetch from Stream directly if webhook missed it
      const call = streamVideo.video.call("default", meetingId);
      const { transcriptions } = await call.listTranscriptions();
      
      if (transcriptions.length > 0) {
        const url = transcriptions[0].url;
        await db
          .update(meetings)
          .set({ transcriptUrl: url })
          .where(eq(meetings.id, meetingId));
        return url;
      }
      
      throw new Error("Transcript not ready yet");
    });

    const response = await step.run("download-transcript", async () => {
      const res = await fetch(transcriptUrl);
      if (!res.ok) throw new Error(`Failed to download transcript: ${res.statusText}`);
      return res.text();
    });

    const transcript = await step.run("parse-transcript", async () => {
      return JSONL.parse<StreamTranscriptItem>(response);
    });

    const transcriptWithSpeakers = await step.run("add-speakers", async () => {
      const speakerIds = [...new Set(transcript.map((item) => item.speaker_id))];

      const userSpeakers = await db
        .select()
        .from(user)
        .where(inArray(user.id, speakerIds));

      const agentSpeakers = await db
        .select()
        .from(agents)
        .where(inArray(agents.id, speakerIds));

      const speakers = [...userSpeakers, ...agentSpeakers];

      return transcript.map((item) => {
        const speaker = speakers.find((s) => s.id === item.speaker_id);
        return {
          ...item,
          user: {
            name: speaker?.name ?? "Unknown",
          },
        };
      });
    });

    const { output } = await step.run("generate-summary", async () => {
      return summarizer.run(
        "Summarize the following transcript: " +
          JSON.stringify(transcriptWithSpeakers)
      );
    });

    const summaryText = (output[0] as TextMessage).content as string;

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

    return { success: true, meetingId };
  }
);
