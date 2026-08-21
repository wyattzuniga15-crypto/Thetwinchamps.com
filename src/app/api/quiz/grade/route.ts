import { NextRequest, NextResponse } from "next/server";
import { getProvider, AIError, fastModel } from "@/lib/ai";
import { extractJson } from "@/lib/json";
import { jsonError, readJson } from "@/lib/api";

export const runtime = "nodejs";

interface Body {
  question: string;
  expectedAnswer: string;
  studentAnswer: string;
}

/** AI grading for short-answer / fill-in-the-blank responses that don't match exactly. */
export async function POST(req: NextRequest) {
  const body = await readJson<Body>(req);
  if (!body?.question || !body?.expectedAnswer || typeof body.studentAnswer !== "string") {
    return jsonError(400, "question, expectedAnswer and studentAnswer are required");
  }
  const provider = getProvider();
  if (!provider.configured()) return jsonError(401, "No AI API key is configured.");

  try {
    const raw = await provider.complete({
      system: "You grade student answers fairly. Accept equivalent phrasings, synonyms, and equivalent math forms. Output only JSON.",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Question: ${body.question.slice(0, 2000)}\nExpected answer: ${body.expectedAnswer.slice(0, 500)}\nStudent answer: ${body.studentAnswer.slice(0, 500)}\n\nIs the student's answer correct (allowing reasonable equivalents)? Respond with ONLY JSON: {"correct": true|false, "feedback": "one short sentence"}`,
            },
          ],
        },
      ],
      maxTokens: 200,
      temperature: 0,
      model: fastModel(),
    });
    const parsed = extractJson<{ correct: boolean; feedback?: string }>(raw);
    return NextResponse.json({ correct: Boolean(parsed.correct), feedback: parsed.feedback || "" });
  } catch (err) {
    console.error("quiz grade error:", err);
    if (err instanceof AIError) return jsonError(502, err.userMessage);
    return jsonError(502, "Could not grade this answer.");
  }
}
