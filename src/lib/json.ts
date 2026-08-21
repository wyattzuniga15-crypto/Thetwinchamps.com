/**
 * Robustly extract a JSON object/array from model output that may include
 * code fences or surrounding prose.
 */
export function extractJson<T = unknown>(text: string): T {
  // 1. Try direct parse
  try {
    return JSON.parse(text) as T;
  } catch {
    /* continue */
  }
  // 2. Try fenced code block
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim()) as T;
    } catch {
      /* continue */
    }
  }
  // 3. Find first balanced {...} or [...]
  for (const open of ["{", "["]) {
    const close = open === "{" ? "}" : "]";
    const start = text.indexOf(open);
    if (start === -1) continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = !inString;
      if (inString) continue;
      if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(start, i + 1)) as T;
          } catch {
            break;
          }
        }
      }
    }
  }
  throw new Error("Could not parse JSON from AI response");
}
