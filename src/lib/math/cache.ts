/**
 * Server-side answer cache for Math Mode.
 *
 * Two jobs, both about latency:
 *  - repeat questions (the same homework problem from 30 students) skip the
 *    model entirely and stream back from memory;
 *  - concurrent identical questions share ONE upstream request instead of
 *    racing (in-flight de-duplication).
 *
 * Deliberately in-process and bounded: no external cache to connect to, so
 * there is no extra network hop on the hot path.
 */

interface Entry {
  value: string;
  expires: number;
}

const MAX_ENTRIES = 500;
const TTL_MS = 60 * 60 * 1000; // 1 hour

const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<string>>();

export function cacheKey(question: string, steps: boolean, model: string): string {
  return `${model}|${steps ? "s" : "a"}|${question.toLowerCase().replace(/\s+/g, " ").trim()}`;
}

export function cacheGet(key: string): string | null {
  const hit = store.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    store.delete(key);
    return null;
  }
  // Refresh recency (Map preserves insertion order).
  store.delete(key);
  store.set(key, hit);
  return hit.value;
}

export function cacheSet(key: string, value: string): void {
  if (!value.trim()) return;
  store.delete(key);
  store.set(key, { value, expires: Date.now() + TTL_MS });
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next();
    if (oldest.done) break;
    store.delete(oldest.value);
  }
}

/** Join an identical in-flight request instead of starting a second one. */
export function getInflight(key: string): Promise<string> | undefined {
  return inflight.get(key);
}

export function setInflight(key: string, p: Promise<string>): void {
  inflight.set(key, p);
  p.catch(() => undefined).finally(() => inflight.delete(key));
}
