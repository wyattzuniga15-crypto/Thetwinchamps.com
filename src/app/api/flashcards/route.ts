import { NextRequest, NextResponse } from "next/server";
import { createDeck, getConversation, listDecks, listMessages, getSettings } from "@/lib/db";
import { getUserId } from "@/lib/user";
import { getProvider, AIError } from "@/lib/ai";
import { extractJson } from "@/lib/json";
import { jsonError, readJson } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  const userId = await getUserId();
  return NextResponse.json({ decks: listDecks(userId) });
}

interface Body {
  topic?: string;
  subject?: string;
  count?: number;
  sourceText?: string;
  conversationId?: string;
}

export async function POST(req: NextRequest) {
  const userId = await getUserId();
  const body = await readJson<Body>(req);
  if (!body?.topic && !body?.sourceText && !body?.conversationId) {
    return jsonError(400, "Provide a topic, source material, or a conversation to generate from");
  }
  const provider = getProvider();
  if (!provider.configured()) {
    return jsonError(401, "No AI API key is configured. Add ANTHROPIC_API_KEY to your .env file and restart the server.");
  }

  const count = Math.min(Math.max(Number(body.count) || 12, 4), 40);
  const settings = getSettings(userId);

  let source = "";
  if (body.conversationId) {
    const convo = getConversation(userId, body.conversationId);
    if (!convo) return jsonError(404, "Conversation not found");
    const messages = listMessages(convo.id);
    source = messages
      .map((m) => `${m.role === "user" ? "Student" : "Tutor"}: ${m.content}`)
      .join("\n\n")
      .slice(-20000);
    if (!source) return jsonError(400, "That conversation has no messages yet");
  } else if (body.sourceText) {
    source = body.sourceText.slice(0, 20000);
  }

  const prompt = `Create ${count} study flashcards.
${body.topic ? `Topic: ${body.topic}` : ""}
${body.subject ? `Subject: ${body.subject}` : ""}
${settings.level ? `Student level: ${settings.level}` : ""}
${source ? `Base them on this material:\n---\n${source}\n---` : ""}

Respond with ONLY valid JSON:
{
  "title": "short deck title",
  "cards": [ { "front": "question / term / prompt", "back": "clear, concise answer or definition" } ]
}
Rules: fronts must be answerable from memory, backs must be accurate and brief (1-3 sentences). Cover the most important concepts first. Use LaTeX $...$ for math where needed.`;

  try {
    const raw = await provider.complete({
      system: "You are an expert at creating effective spaced-repetition flashcards. You output only valid JSON.",
      messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
      maxTokens: 6000,
      temperature: 0.5,
      model: settings.model || undefined,
    });
    const parsed = extractJson<{ title?: string; cards: { front: string; back: string }[] }>(raw);
    const cards = (parsed.cards || [])
      .filter((c) => c && typeof c.front === "string" && typeof c.back === "string" && c.front.trim() && c.back.trim())
      .slice(0, count);
    if (cards.length === 0) return jsonError(502, "The AI did not return usable flashcards. Please try again.");
    const deck = createDeck(userId, parsed.title || body.topic || "Flashcards", body.subject || "", cards);
    return NextResponse.json({ deck: { ...deck, card_count: cards.length, known_count: 0 } });
  } catch (err) {
    console.error("flashcard generate error:", err);
    if (err instanceof AIError) return jsonError(502, err.userMessage);
    return jsonError(502, "Could not generate flashcards. Please try again.");
  }
}
