export type AIContentPart =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: string; dataBase64: string };

export interface AIMessage {
  role: "user" | "assistant";
  content: AIContentPart[];
}

export interface AIRequest {
  system: string;
  messages: AIMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface AIProvider {
  name: string;
  /** Whether the provider has credentials configured. */
  configured(): boolean;
  /** Stream text deltas for a chat completion. */
  stream(req: AIRequest): AsyncGenerator<string, void, unknown>;
  /** Single-shot completion (quiz generation, titles, grading…). */
  complete(req: AIRequest): Promise<string>;
}

export class AIError extends Error {
  status: number;
  userMessage: string;
  constructor(status: number, message: string, userMessage: string) {
    super(message);
    this.status = status;
    this.userMessage = userMessage;
  }
}

export function friendlyAIError(status: number, detail: string): AIError {
  let userMessage: string;
  switch (status) {
    case 0:
      userMessage = "Could not reach the AI service. Check your network connection and try again.";
      break;
    case 401:
    case 403:
      userMessage =
        "The AI API key is missing or invalid. Add a valid ANTHROPIC_API_KEY (or provider key) to your .env file and restart the server.";
      break;
    case 429:
      userMessage = "The AI service is rate-limiting requests right now. Wait a moment and try again.";
      break;
    case 408:
    case 504:
      userMessage = "The AI request timed out. Try again — shorter questions often help.";
      break;
    case 529:
    case 503:
      userMessage = "The AI service is temporarily overloaded. Please try again in a few seconds.";
      break;
    default:
      userMessage = "The AI service returned an unexpected error. Please try again.";
  }
  return new AIError(status, `AI provider error ${status}: ${detail}`, userMessage);
}
