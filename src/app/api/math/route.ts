import { NextRequest } from "next/server";
import { getSettings, logActivity } from "@/lib/db";
import { getUserId } from "@/lib/user";
import { AIError, getProvider, mathModel } from "@/lib/ai";
import { buildMathPrompt } from "@/lib/ai/prompts";
import { cacheGet, cacheKey, cacheSet, getInflight, setInflight } from "@/lib/math/cache";
import { solveLocally } from "@/lib/math/solve";
import { jsonError, readJson } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Math Mode endpoint — the same question, answered by the fastest tier that
 * can answer it correctly:
 *
 *   1. local engine   ~0.05 ms   no network, no tokens
 *   2. answer cache   ~1 ms      no model call
 *   3. fast model     streamed   smallest capable model, minimal prompt
 *
 * Tiers 1 and 2 are checked before anything leaves the process.
 */

interface MathBody {
  question?: string;
  /** Show worked steps (default true). */
  steps?: boolean;
  /**
   * The local engine already produced the answer and the student asked for an
   * explanation — skip tier 1 and ground the model in the verified result.
   */
  explain?: boolean;
}

const MAX_QUESTION_CHARS = 1000;

/** Warm-up ping: opens the connection and loads this route before the first real question. */
export function GET() {
  const provider = getProvider();
  return Response.json({
    ok: true,
    provider: provider.name,
    configured: provider.configured(),
    model: mathModel() || "default",
  });
}

export async function POST(req: NextRequest) {
  const started = Date.now();
  // Resolved once, up front: `cookies()` is only readable while the request
  // scope is open, and the streaming path outlives it.
  const userId = await getUserId().catch(() => null);
  const body = await readJson<MathBody>(req);
  const question = (body?.question || "").trim();
  if (!question) return jsonError(400, "Question is empty");
  if (question.length > MAX_QUESTION_CHARS) return jsonError(400, "Question is too long");

  const withSteps = body?.steps !== false;
  const encoder = new TextEncoder();

  // ── Tier 1: local engine ────────────────────────────────────────────────
  const local = solveLocally(question);
  if (local && !body?.explain) {
    logSolve(userId, question, "local");
    return sse(
      encoder,
      [
        { type: "meta", source: "local", ms: Date.now() - started },
        { type: "local", solution: local },
        { type: "done", ms: Date.now() - started },
      ],
      { "x-math-source": "local" }
    );
  }

  const provider = getProvider();
  if (!provider.configured()) {
    return jsonError(
      401,
      "No AI API key is configured. Add ANTHROPIC_API_KEY to your .env file (see .env.example) and restart the server."
    );
  }

  const model = mathModel();
  const key = cacheKey(question, withSteps, model || "default");

  // ── Tier 2: answer cache ────────────────────────────────────────────────
  const cached = cacheGet(key);
  if (cached) {
    logSolve(userId, question, "cache");
    return sse(
      encoder,
      [
        { type: "meta", source: "cache", model, ms: Date.now() - started },
        { type: "delta", text: cached },
        { type: "done", ms: Date.now() - started },
      ],
      { "x-math-source": "cache" }
    );
  }

  // A request for the same question is already in flight — wait for its
  // answer instead of paying for a second one.
  const shared = getInflight(key);
  if (shared) {
    const text = await shared.catch(() => "");
    if (text) {
      logSolve(userId, question, "shared");
      return sse(
        encoder,
        [
          { type: "meta", source: "shared", model, ms: Date.now() - started },
          { type: "delta", text },
          { type: "done", ms: Date.now() - started },
        ],
        { "x-math-source": "shared" }
      );
    }
  }

  // ── Tier 3: fast model, streamed ────────────────────────────────────────
  let level: string | undefined;
  try {
    level = userId ? getSettings(userId).level || undefined : undefined;
  } catch {
    level = undefined;
  }

  const system = buildMathPrompt({
    steps: withSteps,
    level,
    knownAnswer: body?.explain && local ? local.answer : undefined,
  });

  let resolveShared: (text: string) => void = () => undefined;
  let rejectShared: (err: unknown) => void = () => undefined;
  setInflight(
    key,
    new Promise<string>((res, rej) => {
      resolveShared = res;
      rejectShared = rej;
    })
  );

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: object) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          /* client gone */
        }
      };
      let full = "";
      let ttft: number | null = null;
      try {
        for await (const delta of provider.stream({
          system,
          messages: [{ role: "user", content: [{ type: "text", text: question }] }],
          model,
          // Deterministic: the same problem should not get two different answers.
          temperature: 0,
          maxTokens: withSteps ? 900 : 120,
          signal: req.signal,
        })) {
          if (ttft === null) {
            ttft = Date.now() - started;
            send({ type: "meta", source: "model", model: model || "default", ttft });
          }
          full += delta;
          send({ type: "delta", text: delta });
        }
        cacheSet(key, full);
        resolveShared(full);
        logSolve(userId, question, "model");
        send({ type: "done", ms: Date.now() - started, ttft });
      } catch (err) {
        rejectShared(err);
        if (err instanceof Error && err.name === "AbortError") {
          // Client stopped: nothing to report.
        } else {
          console.error("math stream error:", err);
          send({
            type: "error",
            message:
              err instanceof AIError && err.userMessage
                ? err.userMessage
                : "Something went wrong while solving that. Please try again.",
          });
        }
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, { headers: sseHeaders({ "x-math-source": "model" }) });
}

/** Send a fixed list of events as a one-shot SSE response. */
function sse(encoder: TextEncoder, events: object[], extra: Record<string, string> = {}) {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(encoder.encode(body), { headers: sseHeaders(extra) });
}

function sseHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
    ...extra,
  };
}

/** Record the solve for Progress. Never blocks or breaks the response. */
function logSolve(userId: string | null, question: string, source: string) {
  if (!userId) return;
  try {
    logActivity(userId, "math", "math", `${question.slice(0, 80)} (${source})`);
  } catch {
    /* activity logging is best-effort */
  }
}
