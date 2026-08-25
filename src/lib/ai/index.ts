import { anthropicProvider } from "./anthropic";
import { openaiProvider } from "./openai";
import { AIProvider } from "./types";

export * from "./types";

/** Resolve the active provider from AI_PROVIDER (default: anthropic). */
export function getProvider(): AIProvider {
  const name = (process.env.AI_PROVIDER || "anthropic").toLowerCase();
  return name === "openai" ? openaiProvider : anthropicProvider;
}

/** Fast/cheap model for lightweight tasks (titles). Falls back to the main model. */
export function fastModel(): string | undefined {
  return process.env.AI_FAST_MODEL || undefined;
}

/**
 * Model for Math Mode. Math questions are short and the answer format is
 * fixed, so the smallest capable model is both the cheapest and — because
 * time-to-first-token scales with model size — by far the fastest.
 * AI_MATH_MODEL > AI_FAST_MODEL > provider default.
 */
export function mathModel(): string | undefined {
  return process.env.AI_MATH_MODEL || process.env.AI_FAST_MODEL || undefined;
}
