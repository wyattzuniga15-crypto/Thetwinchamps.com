"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Layers, Plus, Trash2 } from "lucide-react";
import { SUBJECTS, subjectName } from "@/lib/subjects";
import { api } from "@/lib/client";
import { Button, EmptyState, ErrorBanner, Field, PageHeader, Spinner, inputCls } from "@/components/ui";

interface Deck {
  id: string;
  title: string;
  subject: string;
  created_at: number;
  card_count: number;
  known_count: number;
}

interface Convo {
  id: string;
  title: string;
}

type SourceTab = "topic" | "notes" | "conversation";

export default function FlashcardsClient() {
  const params = useSearchParams();
  const router = useRouter();
  const [decks, setDecks] = useState<Deck[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [tab, setTab] = useState<SourceTab>("topic");
  const [topic, setTopic] = useState("");
  const [subject, setSubject] = useState(params.get("subject") || "math");
  const [notes, setNotes] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [convos, setConvos] = useState<Convo[]>([]);
  const [count, setCount] = useState(12);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api<{ decks: Deck[] }>("/api/flashcards")
      .then((d) => setDecks(d.decks))
      .catch((e) => setLoadError(e.message));
  };
  useEffect(load, []);
  useEffect(() => {
    if (tab === "conversation" && convos.length === 0) {
      api<{ conversations: Convo[] }>("/api/conversations")
        .then((d) => setConvos(d.conversations))
        .catch(() => setConvos([]));
    }
  }, [tab, convos.length]);

  const generate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (tab === "topic" && !topic.trim()) return setError("Enter a topic for the deck.");
    if (tab === "notes" && notes.trim().length < 40) return setError("Paste at least a paragraph of notes.");
    if (tab === "conversation" && !conversationId) return setError("Pick a conversation to generate from.");
    setBusy(true);
    try {
      const body: Record<string, unknown> = { count, subject };
      if (tab === "topic") body.topic = topic.trim();
      if (tab === "notes") {
        body.sourceText = notes.trim();
        body.topic = topic.trim() || undefined;
      }
      if (tab === "conversation") body.conversationId = conversationId;
      const data = await api<{ deck: Deck }>("/api/flashcards", { method: "POST", body: JSON.stringify(body) });
      router.push(`/flashcards/${data.deck.id}`);
    } catch (err: any) {
      setError(err?.message || "Could not generate the deck.");
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this deck and all its cards?")) return;
    setDecks((d) => (d ? d.filter((x) => x.id !== id) : d));
    try {
      await api(`/api/flashcards/${id}`, { method: "DELETE" });
    } catch {
      load();
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:px-8">
      <PageHeader
        title="Flashcards"
        subtitle="AI-generated decks from any topic, your notes, or a tutoring conversation."
        action={
          <Button onClick={() => setShowForm((v) => !v)} variant={showForm ? "secondary" : "primary"}>
            <Plus size={15} /> New deck
          </Button>
        }
      />

      {showForm && (
        <form onSubmit={generate} className="mb-8 space-y-4 rounded-2xl border border-line bg-surface-raised p-6 shadow-sm animate-fade-up">
          <div role="tablist" aria-label="Deck source" className="flex gap-1 rounded-xl bg-surface-sunken p-1">
            {(
              [
                ["topic", "From a topic"],
                ["notes", "From my notes"],
                ["conversation", "From a chat"],
              ] as [SourceTab, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  tab === key ? "bg-surface-raised shadow-sm" : "text-ink-muted hover:text-ink"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Subject">
              <select value={subject} onChange={(e) => setSubject(e.target.value)} className={inputCls}>
                {SUBJECTS.map((s) => (
                  <option key={s.slug} value={s.slug}>
                    {s.emoji} {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={`Cards: ${count}`}>
              <input
                type="range"
                min={4}
                max={30}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                className="mt-3 w-full accent-[rgb(var(--accent))]"
                aria-label="Number of cards"
              />
            </Field>
          </div>

          {tab === "topic" && (
            <Field label="Topic">
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g. Spanish travel vocabulary, cell organelles, US state capitals…"
                className={inputCls}
                maxLength={150}
              />
            </Field>
          )}
          {tab === "notes" && (
            <>
              <Field label="Deck title (optional)">
                <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Biology chapter 4" className={inputCls} maxLength={150} />
              </Field>
              <Field label="Paste your notes">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={6}
                  placeholder="Paste study notes, a textbook passage, or lecture notes…"
                  className={`${inputCls} resize-y`}
                  maxLength={20000}
                />
              </Field>
            </>
          )}
          {tab === "conversation" && (
            <Field label="Conversation">
              <select value={conversationId} onChange={(e) => setConversationId(e.target.value)} className={inputCls}>
                <option value="">Choose a conversation…</option>
                {convos.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {error && <ErrorBanner message={error} />}
          <Button type="submit" loading={busy} className="w-full">
            <Layers size={15} /> {busy ? "Generating cards…" : "Generate deck"}
          </Button>
        </form>
      )}

      {loadError && <ErrorBanner message={loadError} onRetry={load} />}
      {!decks && !loadError && <Spinner label="Loading decks…" />}

      {decks && decks.length === 0 && !showForm && (
        <EmptyState
          icon={<Layers size={32} />}
          title="No flashcard decks yet"
          message="Generate your first deck from a topic, your notes, or one of your tutoring conversations."
          action={
            <Button onClick={() => setShowForm(true)}>
              <Plus size={15} /> Create a deck
            </Button>
          }
        />
      )}

      {decks && decks.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {decks.map((d) => {
            const pct = d.card_count > 0 ? Math.round(((d.known_count || 0) / d.card_count) * 100) : 0;
            return (
              <li key={d.id} className="group relative">
                <Link
                  href={`/flashcards/${d.id}`}
                  className="block rounded-2xl border border-line bg-surface-raised p-5 shadow-sm transition hover:border-accent/40"
                >
                  <h2 className="pr-8 font-semibold leading-6">{d.title}</h2>
                  <p className="mt-0.5 text-xs text-ink-faint">
                    {d.subject ? `${subjectName(d.subject)} · ` : ""}
                    {d.card_count} cards
                  </p>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-sunken" aria-hidden>
                    <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="mt-1.5 text-xs text-ink-muted">
                    {d.known_count || 0} of {d.card_count} known ({pct}%)
                  </p>
                </Link>
                <button
                  onClick={() => remove(d.id)}
                  aria-label={`Delete deck ${d.title}`}
                  className="absolute right-3 top-3 rounded-lg p-1.5 text-ink-faint opacity-0 transition hover:bg-surface-sunken hover:text-red-500 focus:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 size={15} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
