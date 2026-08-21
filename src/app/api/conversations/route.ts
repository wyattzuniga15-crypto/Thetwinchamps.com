import { NextRequest, NextResponse } from "next/server";
import { createConversation, listConversations } from "@/lib/db";
import { getUserId } from "@/lib/user";
import { readJson } from "@/lib/api";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const userId = await getUserId();
  const search = req.nextUrl.searchParams.get("q") || undefined;
  return NextResponse.json({ conversations: listConversations(userId, search) });
}

export async function POST(req: NextRequest) {
  const userId = await getUserId();
  const body = (await readJson<{ subject?: string; kind?: string; title?: string; meta?: object }>(req)) || {};
  const conversation = createConversation(userId, {
    subject: typeof body.subject === "string" ? body.subject.slice(0, 40) : "",
    kind: body.kind === "study" ? "study" : "chat",
    title: typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 120) : undefined,
    meta: typeof body.meta === "object" && body.meta ? body.meta : {},
  });
  return NextResponse.json({ conversation });
}
