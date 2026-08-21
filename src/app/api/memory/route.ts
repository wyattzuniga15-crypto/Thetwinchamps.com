import { NextRequest, NextResponse } from "next/server";
import { addMemory, clearMemories, deleteMemory, listMemories } from "@/lib/db";
import { getUserId } from "@/lib/user";
import { jsonError, readJson } from "@/lib/api";

export const runtime = "nodejs";

export async function GET() {
  const userId = await getUserId();
  return NextResponse.json({ memories: listMemories(userId) });
}

export async function POST(req: NextRequest) {
  const userId = await getUserId();
  const body = await readJson<{ content?: string }>(req);
  const content = body?.content?.trim();
  if (!content) return jsonError(400, "content is required");
  addMemory(userId, content);
  return NextResponse.json({ memories: listMemories(userId) });
}

export async function DELETE(req: NextRequest) {
  const userId = await getUserId();
  const id = req.nextUrl.searchParams.get("id");
  if (id === "all") clearMemories(userId);
  else if (id) deleteMemory(userId, id);
  else return jsonError(400, "id query param is required ('all' to clear)");
  return NextResponse.json({ memories: listMemories(userId) });
}
