"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Bot, ChevronDown, Layers, ListChecks, Loader2 } from "lucide-react";
import { SUBJECTS } from "@/lib/subjects";
import { api, emit } from "@/lib/client";
import { ErrorBanner, PageHeader } from "@/components/ui";

export default function SubjectsClient() {
  const router = useRouter();
  const params = useSearchParams();
  const [open, setOpen] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startChat = async (subjectSlug: string, prompt: string, key: string) => {
    if (starting) return;
    setStarting(key);
    setError(null);
    try {
      const data = await api<{ conversation: { id: string } }>("/api/conversations", {
        method: "POST",
        body: JSON.stringify({ subject: subjectSlug }),
      });
      sessionStorage.setItem(`tutor-autosend-${data.conversation.id}`, prompt);
      emit("conversations-changed");
      router.push(`/tutor/${data.conversation.id}`);
    } catch (err: any) {
      setError(err?.message || "Could not start the lesson. Please try again.");
      setStarting(null);
    }
  };

  // Deep link from the dashboard: /subjects?start=<topic>&subject=<slug>
  useEffect(() => {
    const topic = params.get("start");
    const subject = params.get("subject");
    if (topic && subject) {
      startChat(subject, `Teach me about ${topic}. Start with the basics and check my understanding as we go.`, `deep-${topic}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:px-8">
      <PageHeader
        title="Subjects"
        subtitle="Pick a subject to start a focused tutoring session, or jump straight into a topic."
      />
      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2">
        {SUBJECTS.map((s) => {
          const expanded = open === s.slug;
          return (
            <div
              key={s.slug}
              className="rounded-2xl border border-line bg-surface-raised p-5 shadow-sm transition hover:border-accent/40"
            >
              <div className="flex items-start gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent-soft text-xl" aria-hidden>
                  {s.emoji}
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="font-semibold">{s.name}</h2>
                  <p className="mt-0.5 text-sm text-ink-muted">{s.description}</p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  onClick={() =>
                    startChat(
                      s.slug,
                      `I'd like to learn ${s.name}. Ask me a couple of quick questions to figure out my level, then suggest where we should start.`,
                      `chat-${s.slug}`
                    )
                  }
                  disabled={!!starting}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink transition hover:opacity-90 disabled:opacity-50"
                >
                  {starting === `chat-${s.slug}` ? <Loader2 size={14} className="animate-spin" /> : <Bot size={14} />}
                  Start tutoring
                </button>
                <a
                  href={`/quiz?subject=${s.slug}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink-muted transition hover:bg-surface-sunken hover:text-ink"
                >
                  <ListChecks size={14} /> Quiz
                </a>
                <a
                  href={`/flashcards?subject=${s.slug}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink-muted transition hover:bg-surface-sunken hover:text-ink"
                >
                  <Layers size={14} /> Cards
                </a>
                <button
                  onClick={() => setOpen(expanded ? null : s.slug)}
                  aria-expanded={expanded}
                  aria-label={`${expanded ? "Hide" : "Show"} ${s.name} topics`}
                  className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-ink-faint transition hover:text-ink"
                >
                  Topics <ChevronDown size={14} className={`transition ${expanded ? "rotate-180" : ""}`} />
                </button>
              </div>

              {expanded && (
                <ul className="mt-3 space-y-1 border-t border-line pt-3 animate-fade-up">
                  {s.topics.map((t) => (
                    <li key={t}>
                      <button
                        onClick={() =>
                          startChat(
                            s.slug,
                            `Teach me about ${t}. Start with the basics and check my understanding as we go.`,
                            `topic-${s.slug}-${t}`
                          )
                        }
                        disabled={!!starting}
                        className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-sm text-ink-muted transition hover:bg-surface-sunken hover:text-ink disabled:opacity-50"
                      >
                        {t}
                        {starting === `topic-${s.slug}-${t}` && <Loader2 size={13} className="animate-spin" />}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
