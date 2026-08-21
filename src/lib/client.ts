"use client";

/** Client-side helpers: typed fetch wrapper + a tiny event bus for cross-component refresh. */

export async function api<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as any)?.error || `Request failed (${res.status})`);
  }
  return data as T;
}

type BusEvent = "conversations-changed" | "settings-changed";

export function emit(event: BusEvent) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(`tutor:${event}`));
}

export function subscribe(event: BusEvent, handler: () => void): () => void {
  const key = `tutor:${event}`;
  window.addEventListener(key, handler);
  return () => window.removeEventListener(key, handler);
}

export function formatTime(ts: number): string {
  const d = new Date(ts);
  const today = new Date().toDateString() === d.toDateString();
  if (today) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const thisYear = new Date().getFullYear() === d.getFullYear();
  return d.toLocaleDateString([], thisYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}

export function applyTheme(theme: string) {
  try {
    localStorage.setItem("tutor-theme", theme);
    const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
  } catch {
    /* ignore */
  }
}
