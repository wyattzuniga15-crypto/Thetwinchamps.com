import { NextRequest } from "next/server";
import {
  addMessage,
  addMemory,
  deleteMessage,
  getConversation,
  getSettings,
  listMemories,
  listMessages,
  logActivity,
  renameConversation,
  Message,
} from "@/lib/db";
import { getUserId } from "@/lib/user";
import { getProvider, fastModel, AIMessage, AIError } from "@/lib/ai";
import { buildTutorSystemPrompt, extractMemoryDirectives } from "@/lib/ai/prompts";
import { Attachment, buildContentParts } from "@/lib/attachments";
import { jsonError, readJson } from "@/lib/api";
import { subjectName } from "@/lib/subjects";

export const runtime = "nodejs";
export const maxDuration = 300;

interface ChatBody {
  conversationId: string;
  message?: string;
  attachments?: Attachment[];
  regenerate?: boolean;
}

const MAX_MESSAGE_CHARS = 32_000;
const MAX_HISTORY_MESSAGES = 30;

function toAIMessages(messages: Message[]): AIMessage[] {
  const recent = messages.slice(-MAX_HISTORY_MESSAGES);
  return recent.map((m) => {
    if (m.role === "user") {
      let attachments: Attachment[] | undefined;
      try {
        attachments = JSON.parse(m.meta)?.attachments;
      } catch {
        attachments = undefined;
      }
      return { role: "user" as const, content: buildContentParts(m.content, attachments) };
    }
    return { role: "assistant" as const, content: [{ type: "text" as const, text: m.content }] };
  });
}

export async function POST(req: NextRequest) {
  const userId = await getUserId();
  const body = await readJson<ChatBody>(req);
  if (!body?.conversationId) return jsonError(400, "conversationId is required");

  const conversation = getConversation(userId, body.conversationId);
  if (!conversation) return jsonError(404, "Conversation not found");

  const provider = getProvider();
  if (!provider.configured()) {
    return jsonError(
      401,
      "No AI API key is configured. Add ANTHROPIC_API_KEY to your .env file (see .env.example) and restart the server."
    );
  }

  const history = listMessages(conversation.id);

  if (body.regenerate) {
    // Remove trailing assistant message(s) so the last user message is re-answered.
    while (history.length > 0 && history[history.length - 1].role === "assistant") {
      deleteMessage(history[history.length - 1].id);
      history.pop();
    }
    if (history.length === 0 || history[history.length - 1].role !== "user") {
      return jsonError(400, "Nothing to regenerate yet");
    }
  } else {
    const text = (body.message || "").trim();
    const hasAttachment = Array.isArray(body.attachments) && body.attachments.length > 0;
    if (!text && !hasAttachment) return jsonError(400, "Message is empty");
    if (text.length > MAX_MESSAGE_CHARS) return jsonError(400, "Message is too long");
    const userMsg = addMessage(conversation.id, "user", text, {
      attachments: (body.attachments || []).slice(0, 5),
    });
    history.push(userMsg);
  }

  const settings = getSettings(userId);
  const memories = listMemories(userId);
  let studyMeta: any = {};
  try {
    studyMeta = JSON.parse(conversation.meta);
  } catch {
    /* ignore */
  }
  const system = buildTutorSystemPrompt({
    settings,
    memories,
    subject: conversation.subject ? subjectName(conversation.subject) : undefined,
    kind: conversation.kind,
    studyMeta,
  });

  const aiMessages = toAIMessages(history);
  const model = settings.model || undefined;

  const isFirstExchange = history.filter((m) => m.role === "user").length === 1;
  const firstUserText = history.find((m) => m.role === "user")?.content || "";

  const encoder = new TextEncoder();
  const send = (controller: ReadableStreamDefaultController, event: object) =>
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));

  const stream = new ReadableStream({
    async start(controller) {
      let full = "";
      let clientGone = false;
      const finalize = () => {
        if (!full.trim()) return null;
        const { cleaned, memories: newMemories } = extractMemoryDirectives(full);
        for (const m of newMemories.slice(0, 1)) addMemory(userId, m);
        const saved = addMessage(conversation.id, "assistant", cleaned || full);
        logActivity(userId, "chat", conversation.subject, conversation.title);
        return saved;
      };

      try {
        for await (const delta of provider.stream({
          system,
          messages: aiMessages,
          model,
          signal: req.signal,
        })) {
          full += delta;
          if (!clientGone) {
            try {
              send(controller, { type: "delta", text: delta });
            } catch {
              clientGone = true;
            }
          }
        }
        const saved = finalize();
        maybeTitle(userId, conversation.id, conversation.title, isFirstExchange, firstUserText, full);
        if (!clientGone) {
          try {
            send(controller, {
              type: "done",
              messageId: saved?.id ?? null,
              content: saved?.content ?? "",
            });
          } catch {
            /* client gone */
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          // Client stopped generation — persist what we have so far.
          const saved = finalize();
          maybeTitle(userId, conversation.id, conversation.title, isFirstExchange, firstUserText, full);
          void saved;
        } else {
          const message =
            err instanceof AIError && err.userMessage
              ? err.userMessage
              : "Something went wrong while generating the response. Please try again.";
          console.error("chat stream error:", err);
          if (!clientGone) {
            try {
              send(controller, { type: "error", message });
            } catch {
              /* client gone */
            }
          }
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

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

/** Auto-title new conversations with a fast model call; fall back to truncated text. */
function maybeTitle(
  userId: string,
  conversationId: string,
  currentTitle: string,
  isFirstExchange: boolean,
  userText: string,
  assistantText: string
) {
  if (!isFirstExchange || currentTitle !== "New chat") return;
  const fallback = () => {
    const base = userText.replace(/\s+/g, " ").trim().slice(0, 48);
    if (base) renameConversation(userId, conversationId, base + (userText.length > 48 ? "…" : ""));
  };
  const provider = getProvider();
  provider
    .complete({
      system:
        "You generate short chat titles. Reply with ONLY a 2-5 word title (no quotes, no punctuation at the end) describing the student's topic.",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Student: ${userText.slice(0, 600)}\n\nTutor: ${assistantText.slice(0, 600)}\n\nTitle:`,
            },
          ],
        },
      ],
      model: fastModel(),
      maxTokens: 24,
      temperature: 0.2,
    })
    .then((title) => {
      const clean = title.replace(/^["'\s]+|["'\s.]+$/g, "").slice(0, 60);
      if (clean) renameConversation(userId, conversationId, clean);
      else fallback();
    })
    .catch(fallback);
}
