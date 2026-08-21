import { NextRequest, NextResponse } from "next/server";
import { clearAllConversations, deleteAllUserData, getSettings, updateSettings } from "@/lib/db";
import { getUserId } from "@/lib/user";
import { getProvider } from "@/lib/ai";
import { jsonError, readJson } from "@/lib/api";

export const runtime = "nodejs";

const THEMES = ["system", "light", "dark"];
const LENGTHS = ["concise", "balanced", "detailed"];

export async function GET() {
  const userId = await getUserId();
  const provider = getProvider();
  return NextResponse.json({
    settings: getSettings(userId),
    ai: {
      provider: provider.name,
      configured: provider.configured(),
      defaultModel: process.env.AI_MODEL || (provider.name === "anthropic" ? "claude-sonnet-5" : "gpt-4o"),
    },
  });
}

export async function PATCH(req: NextRequest) {
  const userId = await getUserId();
  const body = await readJson<Record<string, unknown>>(req);
  if (!body) return jsonError(400, "Invalid body");
  const patch: Record<string, string> = {};
  if (typeof body.theme === "string" && THEMES.includes(body.theme)) patch.theme = body.theme;
  if (typeof body.response_length === "string" && LENGTHS.includes(body.response_length)) {
    patch.response_length = body.response_length;
  }
  if (typeof body.level === "string") patch.level = body.level.slice(0, 80);
  if (typeof body.model === "string") patch.model = body.model.slice(0, 80);
  const settings = updateSettings(userId, patch);
  return NextResponse.json({ settings });
}

export async function DELETE(req: NextRequest) {
  const userId = await getUserId();
  const target = req.nextUrl.searchParams.get("target");
  if (target === "conversations") {
    clearAllConversations(userId);
    return NextResponse.json({ ok: true });
  }
  if (target === "everything") {
    deleteAllUserData(userId);
    return NextResponse.json({ ok: true });
  }
  return jsonError(400, "target must be 'conversations' or 'everything'");
}
