import { NextRequest, NextResponse } from "next/server";
import { deleteDeck, getDeck, updateCardStatus } from "@/lib/db";
import { getUserId } from "@/lib/user";
import { jsonError, readJson } from "@/lib/api";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const userId = await getUserId();
  const { id } = await params;
  const result = getDeck(userId, id);
  if (!result) return jsonError(404, "Deck not found");
  return NextResponse.json(result);
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const userId = await getUserId();
  const { id } = await params;
  const body = await readJson<{ cardId?: string; status?: string }>(req);
  if (!body?.cardId || (body.status !== "known" && body.status !== "review")) {
    return jsonError(400, "cardId and status ('known'|'review') are required");
  }
  const ok = updateCardStatus(userId, id, body.cardId, body.status);
  if (!ok) return jsonError(404, "Deck not found");
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const userId = await getUserId();
  const { id } = await params;
  deleteDeck(userId, id);
  return NextResponse.json({ ok: true });
}
