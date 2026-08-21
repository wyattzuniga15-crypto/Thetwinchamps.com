import { NextRequest, NextResponse } from "next/server";
import {
  clearConversationMessages,
  deleteConversation,
  getConversation,
  listMessages,
  renameConversation,
} from "@/lib/db";
import { getUserId } from "@/lib/user";
import { jsonError, readJson } from "@/lib/api";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const userId = await getUserId();
  const { id } = await params;
  const conversation = getConversation(userId, id);
  if (!conversation) return jsonError(404, "Conversation not found");
  return NextResponse.json({ conversation, messages: listMessages(id) });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const userId = await getUserId();
  const { id } = await params;
  const conversation = getConversation(userId, id);
  if (!conversation) return jsonError(404, "Conversation not found");
  const body = await readJson<{ title?: string; clear?: boolean }>(req);
  if (body?.clear) {
    clearConversationMessages(userId, id);
    return NextResponse.json({ ok: true });
  }
  const title = body?.title?.trim();
  if (!title) return jsonError(400, "Title is required");
  renameConversation(userId, id, title);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const userId = await getUserId();
  const { id } = await params;
  deleteConversation(userId, id);
  return NextResponse.json({ ok: true });
}
