"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, Bot } from "lucide-react";
import { api, emit } from "@/lib/client";
import { ErrorBanner } from "@/components/ui";

/**
 * Pre-chat screen: no conversation row is created until the student actually
 * sends something (keeps history clean). The first message is handed to the
 * chat page via sessionStorage and auto-sent there.
 */
export default function NewChatLauncher({
  subject,
  suggestions,
  title,
  body,
}: {
  subject?: string;
  suggestions: string[];
  title?: string;
  body?: string;
}) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const start = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ conversation: { id: string } }>("/api/conversations", {
        method: "POST",
        body: JSON.stringify({ subject: subject || "" }),
      });
      sessionStorage.setItem(`tutor-autosend-${data.conversation.id}`, trimmed);
      emit("conversations-changed");
      router.push(`/tutor/${data.conversation.id}`);
    } catch (err: any) {
      setError(err?.message || "Could not start a chat. Please try again.");
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-chat">
        <div className="flex flex-col items-center text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft text-accent">
            <Bot size={26} />
          </span>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">{title || "What would you like to learn?"}</h1>
          <p className="mt-1.5 max-w-md text-sm text-ink-muted">
            {body ||
              "Ask me anything — math problems, essay feedback, science concepts, history questions, or a language you're learning."}
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            start(input);
          }}
          className="mt-7 flex items-end gap-2 rounded-2xl border border-line bg-surface-raised p-2 shadow-sm focus-within:border-accent"
        >
          <textarea
            ref={textareaRef}
            autoFocus
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              const el = textareaRef.current;
              if (el) {
                el.style.height = "auto";
                el.style.height = Math.min(el.scrollHeight, 200) + "px";
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                start(input);
              }
            }}
            rows={1}
            placeholder="Ask your tutor anything…"
            aria-label="Ask your tutor anything"
            className="max-h-[200px] min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-[15px] placeholder:text-ink-faint focus:outline-none"
          />
          <button
            type="submit"
            disabled={!input.trim() || busy}
            aria-label="Start chat"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent text-accent-ink transition hover:opacity-90 disabled:opacity-30"
          >
            <ArrowUp size={18} />
          </button>
        </form>

        {error && (
          <div className="mt-3">
            <ErrorBanner message={error} />
          </div>
        )}

        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => start(s)}
              disabled={busy}
              className="rounded-xl border border-line bg-surface-raised px-4 py-3 text-left text-sm text-ink-muted transition hover:border-accent/40 hover:text-ink disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
