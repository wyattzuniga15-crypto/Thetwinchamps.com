import { AIMessage, AIProvider, AIRequest, friendlyAIError } from "./types";

/** OpenAI-compatible provider (works with OpenAI, Azure-compatible gateways, local servers). */

const BASE_URL = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
const DEFAULT_MODEL = process.env.AI_MODEL || "gpt-4o";

function toOpenAIMessages(system: string, messages: AIMessage[]) {
  const out: any[] = [{ role: "system", content: system }];
  for (const m of messages) {
    const content = m.content.map((part) =>
      part.type === "text"
        ? { type: "text", text: part.text }
        : { type: "image_url", image_url: { url: `data:${part.mediaType};base64,${part.dataBase64}` } }
    );
    out.push({ role: m.role, content });
  }
  return out;
}

async function request(req: AIRequest, stream: boolean): Promise<Response> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw friendlyAIError(401, "OPENAI_API_KEY is not set");
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: req.model || DEFAULT_MODEL,
        max_tokens: req.maxTokens ?? 4096,
        temperature: req.temperature ?? 0.7,
        messages: toOpenAIMessages(req.system, req.messages),
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

export const openaiProvider: AIProvider = {
  name: "openai",

  configured() {
    return Boolean(process.env.OPENAI_API_KEY);
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
          try {
            const event = JSON.parse(payload);
            const delta = event.choices?.[0]?.delta?.content;
            if (typeof delta === "string" && delta) yield delta;
          } catch {
            continue;
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
    return data.choices?.[0]?.message?.content ?? "";
  },
};
