import { AIMessage, AIProvider, AIRequest, friendlyAIError } from "./types";

const BASE_URL = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/$/, "");
const DEFAULT_MODEL = process.env.AI_MODEL || "claude-sonnet-5";

function toAnthropicMessages(messages: AIMessage[]) {
  return messages.map((m) => ({
    role: m.role,
    content: m.content.map((part) =>
      part.type === "text"
        ? { type: "text", text: part.text }
        : {
            type: "image",
            source: { type: "base64", media_type: part.mediaType, data: part.dataBase64 },
          }
    ),
  }));
}

async function request(req: AIRequest, stream: boolean): Promise<Response> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw friendlyAIError(401, "ANTHROPIC_API_KEY is not set");
  }
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: req.model || DEFAULT_MODEL,
        max_tokens: req.maxTokens ?? 4096,
        temperature: req.temperature ?? 0.7,
        system: req.system,
        messages: toAnthropicMessages(req.messages),
        stream,
      }),
      signal: req.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    throw friendlyAIError(0, String(err));
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw friendlyAIError(res.status, body.slice(0, 500));
  }
  return res;
}

export const anthropicProvider: AIProvider = {
  name: "anthropic",

  configured() {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  },

  async *stream(req: AIRequest) {
    const res = await request(req, true);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          let event: any;
          try {
            event = JSON.parse(payload);
          } catch {
            continue;
          }
          if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
            yield event.delta.text as string;
          } else if (event.type === "error") {
            throw friendlyAIError(529, JSON.stringify(event.error));
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  },

  async complete(req: AIRequest) {
    const res = await request(req, false);
    const data = await res.json();
    const parts = Array.isArray(data.content) ? data.content : [];
    return parts
      .filter((p: any) => p.type === "text")
      .map((p: any) => p.text)
      .join("");
  },
};
