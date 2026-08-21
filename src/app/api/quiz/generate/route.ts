import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/user";
import { getProvider, AIError } from "@/lib/ai";
import { extractJson } from "@/lib/json";
import { jsonError, readJson } from "@/lib/api";
import { getSettings } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 300;

export interface QuizQuestion {
  type: "multiple_choice" | "true_false" | "short_answer" | "fill_blank";
  question: string;
  options?: string[];
  answer: string;
  explanation: string;
  topic: string;
}

interface Body {
  subject: string;
  topic?: string;
  difficulty?: string;
  count?: number;
  sourceText?: string;
}

export async function POST(req: NextRequest) {
  const userId = await getUserId();
  const body = await readJson<Body>(req);
  if (!body?.subject && !body?.sourceText) return jsonError(400, "Subject or source material is required");

  const provider = getProvider();
  if (!provider.configured()) {
    return jsonError(401, "No AI API key is configured. Add ANTHROPIC_API_KEY to your .env file and restart the server.");
  }

  const count = Math.min(Math.max(Number(body.count) || 5, 1), 20);
  const difficulty = (body.difficulty || "medium").slice(0, 20);
  const settings = getSettings(userId);

  const source = body.sourceText
    ? `Base the questions on this study material:\n---\n${body.sourceText.slice(0, 20000)}\n---\n`
    : "";

  const prompt = `Create a quiz.
Subject: ${body.subject || "based on the provided material"}
Topic: ${body.topic || "general, representative of the subject"}
Difficulty: ${difficulty}
${settings.level ? `Student level: ${settings.level}` : ""}
Number of questions: ${count}
${source}
Mix question types: multiple_choice (most), true_false, fill_blank, and 1-2 short_answer if the count allows.

Respond with ONLY valid JSON, no prose, in exactly this shape:
{
  "questions": [
    {
      "type": "multiple_choice" | "true_false" | "short_answer" | "fill_blank",
      "question": "…",              // for fill_blank use ___ for the blank
      "options": ["A", "B", "C", "D"], // only for multiple_choice; for true_false use ["True","False"]
      "answer": "…",                // exact option text for MC/TF; expected answer otherwise
      "explanation": "why this is correct, teaching the concept",
      "topic": "specific sub-topic label"
    }
  ]
}
Rules: questions must be factually accurate, unambiguous, and self-contained. Double-check any math. The answer for multiple_choice must exactly match one option.`;

  try {
    const raw = await provider.complete({
      system: "You are an expert educational quiz writer. You output only valid JSON.",
      messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
      maxTokens: 6000,
      temperature: 0.6,
      model: settings.model || undefined,
    });
    const parsed = extractJson<{ questions: QuizQuestion[] }>(raw);
    const questions = (parsed.questions || [])
      .filter(
        (q) =>
          q &&
          typeof q.question === "string" &&
          typeof q.answer === "string" &&
          ["multiple_choice", "true_false", "short_answer", "fill_blank"].includes(q.type)
      )
      .slice(0, count)
      .map((q) => ({
        ...q,
        options:
          q.type === "true_false"
            ? ["True", "False"]
            : Array.isArray(q.options)
              ? q.options.map(String).slice(0, 6)
              : undefined,
        explanation: q.explanation || "",
        topic: q.topic || body.topic || body.subject,
      }));
    if (questions.length === 0) return jsonError(502, "The AI did not return usable questions. Please try again.");
    return NextResponse.json({ questions });
  } catch (err) {
    console.error("quiz generate error:", err);
    if (err instanceof AIError) return jsonError(err.status >= 400 && err.status < 600 ? err.status : 502, err.userMessage);
    return jsonError(502, "Could not generate the quiz. Please try again.");
  }
}
