"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, RotateCcw, Shuffle, X } from "lucide-react";
import Markdown from "@/components/Markdown";
import { api } from "@/lib/client";
import { Button, ErrorBanner, Spinner } from "@/components/ui";
import { subjectName } from "@/lib/subjects";

interface Card {
  id: string;
  front: string;
  back: string;
  status: "new" | "known" | "review";
}

interface Deck {
  id: string;
  title: string;
  subject: string;
}

export default function DeckClient({ deckId }: { deckId: string }) {
  const [deck, setDeck] = useState<Deck | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [order, setOrder] = useState<number[]>([]);
  const [pos, setPos] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ deck: Deck; cards: Card[] }>(`/api/flashcards/${deckId}`)
      .then((data) => {
        setDeck(data.deck);
        setCards(data.cards);
        setOrder(data.cards.map((_, i) => i));
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || "Could not load this deck.");
        setLoading(false);
      });
  }, [deckId]);

  const current = cards[order[pos]];
  const knownCount = useMemo(() => cards.filter((c) => c.status === "known").length, [cards]);

  const go = useCallback(
    (delta: number) => {
      setFlipped(false);
      setPos((p) => Math.min(Math.max(p + delta, 0), Math.max(order.length - 1, 0)));
    },
    [order.length]
  );

  const shuffle = () => {
    const next = [...order];
    for (let i = next.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [next[i], next[j]] = [next[j], next[i]];
    }
    setOrder(next);
    setPos(0);
    setFlipped(false);
  };

  const mark = async (status: "known" | "review") => {
    if (!current) return;
    setCards((cs) => cs.map((c) => (c.id === current.id ? { ...c, status } : c)));
    if (pos < order.length - 1) go(1);
    try {
      await api(`/api/flashcards/${deckId}`, {
        method: "PATCH",
        body: JSON.stringify({ cardId: current.id, status }),
      });
    } catch {
      /* progress save is best-effort; UI already advanced */
    }
  };

  // Keyboard navigation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        setFlipped((f) => !f);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  if (loading) return <Spinner label="Loading deck…" />;
  if (error || !deck || cards.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <ErrorBanner message={error || "This deck has no cards."} />
        <Link href="/flashcards" className="mt-4 inline-block text-sm text-accent hover:underline">
          ← Back to flashcards
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col px-4 py-6 md:px-8">
      <div className="mb-4 flex items-center justify-between gap-3">
        <Link href="/flashcards" className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
          <ArrowLeft size={15} /> Decks
        </Link>
        <div className="min-w-0 text-center">
          <h1 className="truncate text-base font-semibold">{deck.title}</h1>
          <p className="text-xs text-ink-faint">
            {deck.subject ? `${subjectName(deck.subject)} · ` : ""}
            {knownCount}/{cards.length} known
          </p>
        </div>
        <button
          onClick={shuffle}
          aria-label="Shuffle deck"
          className="rounded-lg p-2 text-ink-muted transition hover:bg-surface-sunken hover:text-ink"
        >
          <Shuffle size={16} />
        </button>
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunken" aria-hidden>
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${((pos + 1) / order.length) * 100}%` }} />
      </div>
      <p className="mt-1.5 text-center text-xs text-ink-faint">
        Card {pos + 1} of {order.length}
        {current.status !== "new" && (
          <span className={current.status === "known" ? " text-green-600" : " text-amber-600"}>
            {" "}
            · {current.status === "known" ? "known" : "needs review"}
          </span>
        )}
      </p>

      <div className="flip-scene mt-4 flex-1" style={{ minHeight: "280px" }}>
        <button
          onClick={() => setFlipped((f) => !f)}
          aria-label={flipped ? "Show question" : "Show answer"}
          className="flip-inner relative block h-full min-h-[280px] w-full text-left"
        >
          <div className={`flip-inner absolute inset-0 ${flipped ? "flipped" : ""}`}>
            <div className="flip-face absolute inset-0 flex flex-col items-center justify-center rounded-3xl border border-line bg-surface-raised p-8 shadow-sm">
              <span className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Question</span>
              <div className="max-h-full overflow-y-auto text-center text-lg font-medium leading-8">
                <Markdown text={current.front} />
              </div>
              <span className="mt-4 text-xs text-ink-faint">Tap or press Space to flip</span>
            </div>
            <div className="flip-face flip-back absolute inset-0 flex flex-col items-center justify-center rounded-3xl border border-accent/40 bg-accent-soft p-8">
              <span className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-accent">Answer</span>
              <div className="max-h-full overflow-y-auto text-center text-base leading-7">
                <Markdown text={current.back} />
              </div>
            </div>
          </div>
        </button>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={() => mark("review")} className="!border-amber-400/50">
          <X size={15} className="text-amber-500" /> Need review
        </Button>
        <Button variant="secondary" onClick={() => mark("known")} className="!border-green-500/50">
          <Check size={15} className="text-green-600" /> I know this
        </Button>
      </div>
      <div className="mb-2 mt-2 flex items-center justify-between">
        <Button variant="ghost" onClick={() => go(-1)} disabled={pos === 0} aria-label="Previous card">
          <ArrowLeft size={15} /> Previous
        </Button>
        <Button variant="ghost" onClick={() => setFlipped((f) => !f)} aria-label="Flip card">
          <RotateCcw size={15} /> Flip
        </Button>
        <Button variant="ghost" onClick={() => go(1)} disabled={pos >= order.length - 1} aria-label="Next card">
          Next <ArrowRight size={15} />
        </Button>
      </div>
    </div>
  );
}
