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
