import { NextRequest, NextResponse } from "next/server";
import { listQuizResults, saveQuizResult } from "@/lib/db";
import { getUserId } from "@/lib/user";
import { jsonError, readJson } from "@/lib/api";

export const runtime = "nodejs";

export async function GET() {
  const userId = await getUserId();
  return NextResponse.json({ results: listQuizResults(userId) });
}

interface Body {
  subject: string;
  topic: string;
  difficulty: string;
  total: number;
  correct: number;
  details: unknown;
}

export async function POST(req: NextRequest) {
  const userId = await getUserId();
  const body = await readJson<Body>(req);
  if (!body || typeof body.total !== "number" || typeof body.correct !== "number") {
    return jsonError(400, "total and correct are required");
  }
  const total = Math.max(0, Math.min(100, Math.floor(body.total)));
  const correct = Math.max(0, Math.min(total, Math.floor(body.correct)));
  const result = saveQuizResult(userId, {
    subject: String(body.subject || "").slice(0, 60),
    topic: String(body.topic || "").slice(0, 120),
    difficulty: String(body.difficulty || "medium").slice(0, 20),
    total,
    correct,
    details: body.details,
  });
  return NextResponse.json({ result });
}
