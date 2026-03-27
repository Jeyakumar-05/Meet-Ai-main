import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { agents, meetings } from "@/db/schema";

// ─── Groq chat completion ────────────────────────────────────────────────────
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface GroqChatResponse {
  id: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string | null;
    };
    finish_reason: string;
  }[];
}

async function groqChatCompletion(
  messages: ChatMessage[]
): Promise<string | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY environment variable is not set");
  }

  const response = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages,
      temperature: 0.7,
      max_tokens: 2048,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`[groq-chat] API error [${response.status}]: ${errorBody}`);
    throw new Error(
      `Groq API request failed with status ${response.status}: ${errorBody}`
    );
  }

  const data: GroqChatResponse = await response.json();
  return data.choices?.[0]?.message?.content ?? null;
}

// ─── POST handler ────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { meetingId, userMessage, conversationHistory } = body as {
      meetingId: string;
      userMessage: string;
      conversationHistory?: ChatMessage[];
    };

    if (!meetingId || !userMessage) {
      return NextResponse.json(
        { error: "Missing meetingId or userMessage" },
        { status: 400 }
      );
    }

    // Fetch the meeting and agent
    const [existingMeeting] = await db
      .select()
      .from(meetings)
      .where(eq(meetings.id, meetingId));

    if (!existingMeeting) {
      return NextResponse.json(
        { error: "Meeting not found" },
        { status: 404 }
      );
    }

    const [existingAgent] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, existingMeeting.agentId));

    if (!existingAgent) {
      return NextResponse.json(
        { error: "Agent not found" },
        { status: 404 }
      );
    }

    // Build messages array
    const systemPrompt = `${existingAgent.instructions}

You are an AI meeting assistant named "${existingAgent.name}". 
You are currently in a live meeting session with the user.
Keep your responses conversational, concise, and helpful.
Respond naturally as if you are speaking in a meeting.
Do not use markdown formatting since your response will be spoken aloud.`;

    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...(conversationHistory ?? []),
      { role: "user", content: userMessage },
    ];

    const responseText = await groqChatCompletion(messages);

    if (!responseText) {
      return NextResponse.json(
        { error: "No response from AI" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      response: responseText,
      agentName: existingAgent.name,
    });
  } catch (error) {
    console.error("[groq-chat] Error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
