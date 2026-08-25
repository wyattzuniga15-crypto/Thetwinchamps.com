"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Calculator, CornerDownLeft, Loader2, Sparkles, Square, Trash2, Zap } from "lucide-react";
import Markdown from "@/components/Markdown";
import { Button, ErrorBanner, PageHeader } from "@/components/ui";
import { LocalSolution, solveLocally } from "@/lib/math/solve";

/**
 * Math Mode.
 *
 * The whole point of this screen is time-to-answer. The local engine runs on
 * every keystroke in the browser, so anything it can solve is already answered
 * before the student presses Enter — no request, no spinner. Only questions it
 * declines to answer reach the model.
 */

type Source = "local" | "cache" | "shared" | "model";

interface Result {
  id: string;
  question: string;
  source: Source | null;
  local?: LocalSolution;
  text: string;
  ms: number;
  ttft?: number;
  error?: string;
  streaming: boolean;
  explaining?: boolean;
}

const EXAMPLES = [
  "2x + 3 = 11",
  "x^2 - 5x + 6 = 0",
  "15% of 80",
  "sqrt(144) + 5!",
  "prime factorization of 360",
  "derivative of x^2 + 3x",
];

const KEYPAD = ["(", ")", "/", "^", "sqrt(", "pi", "%", "="];

const HISTORY_KEY = "tutor-math-history";

const SOURCE_LABEL: Record<Source, string> = {
  local: "instant",
  cache: "cached",
  shared: "cached",
  model: "AI",
};

export default function MathClient() {
  const [input, setInput] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [showSteps, setShowSteps] = useState(true);
  const [history, setHistory] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Live local answer — recomputed on every keystroke because it costs
  // microseconds. This is what makes the common case feel instantaneous.
  const preview = useMemo(() => solveLocally(input), [input]);

  useEffect(() => {
    inputRef.current?.focus();
    try {
      const saved = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
      if (Array.isArray(saved)) setHistory(saved.filter((x) => typeof x === "string").slice(0, 12));
    } catch {
      /* ignore */
    }
    // Warm the route so the first model-backed question doesn't also pay for
    // module load and connection setup.
    fetch("/api/math").catch(() => undefined);
    return () => abortRef.current?.abort();
  }, []);

  const remember = useCallback((q: string) => {
    setHistory((prev) => {
      const next = [q, ...prev.filter((x) => x !== q)].slice(0, 12);
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      } catch {
        /* storage may be unavailable */
      }
      return next;
    });
  }, []);

  const update = useCallback((id: string, patch: Partial<Result>) => {
    setResults((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  /** Stream an answer from the API into an existing result row. */
  const streamAnswer = useCallback(
    async (id: string, question: string, opts: { explain?: boolean } = {}) => {
      const started = performance.now();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch("/api/math", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ question, steps: showSteps, explain: opts.explain }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data?.error || `Request failed (${res.status})`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let text = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;
            let event: {
              type: string;
              text?: string;
              message?: string;
              source?: Source;
              ttft?: number;
              solution?: LocalSolution;
            };
            try {
              event = JSON.parse(payload);
            } catch {
              continue;
            }
            if (event.type === "meta") {
              update(id, { source: event.source ?? "model", ttft: event.ttft });
            } else if (event.type === "local" && event.solution) {
              update(id, { local: event.solution, source: "local" });
            } else if (event.type === "delta" && event.text) {
              text += event.text;
              update(id, { text });
            } else if (event.type === "error") {
              update(id, { error: event.message || "Something went wrong." });
            }
          }
        }
        update(id, { streaming: false, explaining: false, ms: Math.round(performance.now() - started) });
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          update(id, { streaming: false, explaining: false });
          return;
        }
        update(id, {
          streaming: false,
          explaining: false,
          error: err instanceof Error ? err.message : "Could not reach the solver.",
        });
      } finally {
        abortRef.current = null;
      }
    },
    [showSteps, update]
  );

  const submit = useCallback(
    (raw?: string) => {
      const question = (raw ?? input).trim();
      if (!question) return;
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setInput("");
      remember(question);

      const t0 = performance.now();
      const local = solveLocally(question);
      if (local) {
        // Answered without touching the network.
        setResults((prev) => [
          { id, question, source: "local", local, text: "", ms: Math.round((performance.now() - t0) * 100) / 100, streaming: false },
          ...prev,
        ]);
        return;
      }

      setResults((prev) => [{ id, question, source: null, text: "", ms: 0, streaming: true }, ...prev]);
      void streamAnswer(id, question);
    },
    [input, remember, streamAnswer]
  );

  const explain = useCallback(
    (r: Result) => {
      update(r.id, { explaining: true, text: "", error: undefined });
      void streamAnswer(r.id, r.question, { explain: true });
    },
    [streamAnswer, update]
  );

  const insert = (token: string) => {
    setInput((v) => v + token);
    inputRef.current?.focus();
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:px-8">
      <PageHeader
        title="Math Mode"
        subtitle="Arithmetic, algebra, percents, and number theory answered instantly on your device — anything harder goes to the AI tutor."
        action={
          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-muted">
            <input
              type="checkbox"
              checked={showSteps}
              onChange={(e) => setShowSteps(e.target.checked)}
              className="h-4 w-4 rounded border-line accent-[var(--accent)]"
            />
            Show steps
          </label>
        }
      />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="relative">
          <Calculator size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a problem — 2x + 3 = 11"
            aria-label="Math question"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className="w-full rounded-2xl border border-line bg-surface-raised py-4 pl-12 pr-28 font-mono text-base placeholder:font-sans placeholder:text-ink-faint focus:border-accent focus:outline-none"
          />
          <button
            type="submit"
            disabled={!input.trim()}
            aria-label="Solve"
            className="absolute right-2.5 top-1/2 inline-flex -translate-y-1/2 items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink transition hover:opacity-90 disabled:opacity-40"
          >
            Solve <CornerDownLeft size={14} />
          </button>
        </div>

        {/* Live answer, before the student even presses Enter. */}
        <div aria-live="polite" className="min-h-[2rem]">
          {preview && (
            <div className="mt-2 flex items-center gap-2 px-1 text-sm">
              <Zap size={14} className="shrink-0 text-accent" />
              <span className="text-ink-muted">Answer:</span>
              <span className="font-mono font-semibold">{preview.answer}</span>
              {preview.alt && <span className="text-xs text-ink-faint">{preview.alt}</span>}
              <span className="text-xs text-ink-faint">— press Enter for the steps</span>
            </div>
          )}
        </div>
      </form>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {KEYPAD.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => insert(k)}
            className="rounded-lg border border-line bg-surface-raised px-2.5 py-1 font-mono text-xs text-ink-muted transition hover:bg-surface-sunken hover:text-ink"
          >
            {k}
          </button>
        ))}
      </div>

      {results.length === 0 && (
        <div className="mt-8">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">Try one</h2>
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => submit(ex)}
                className="rounded-xl border border-line bg-surface-raised px-3 py-1.5 font-mono text-sm text-ink-muted transition hover:border-accent/40 hover:text-ink"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      )}

      {history.length > 0 && results.length === 0 && (
        <div className="mt-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">Recent</h2>
          <div className="flex flex-wrap gap-2">
            {history.map((h) => (
              <button
                key={h}
                onClick={() => submit(h)}
                className="max-w-full truncate rounded-xl border border-line bg-surface-raised px-3 py-1.5 font-mono text-sm text-ink-muted transition hover:border-accent/40 hover:text-ink"
              >
                {h}
              </button>
            ))}
          </div>
        </div>
      )}

      <ul className="mt-8 space-y-4">
        {results.map((r) => (
          <li key={r.id} className="rounded-2xl border border-line bg-surface-raised p-5 shadow-sm animate-fade-up">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <p className="font-mono text-sm text-ink-muted">{r.question}</p>
              <div className="flex items-center gap-2">
                <SpeedBadge result={r} />
                {r.streaming && (
                  <button
                    onClick={() => abortRef.current?.abort()}
                    className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-xs text-ink-muted hover:bg-surface-sunken"
                  >
                    <Square size={11} /> Stop
                  </button>
                )}
              </div>
            </div>

            {r.error && (
              <div className="mt-3">
                <ErrorBanner message={r.error} onRetry={() => submit(r.question)} />
              </div>
            )}

            {r.local && !r.explaining && (
              <div className="mt-4">
                <div className="rounded-xl bg-accent-soft px-4 py-3">
                  <Markdown text={`$$${r.local.answerLatex}$$`} />
                  {r.local.alt && <p className="mt-1 text-center text-xs text-ink-muted">{r.local.alt}</p>}
                </div>
                {showSteps && (
                  <ol className="mt-4 space-y-3">
                    {r.local.steps.map((s, i) => (
                      <li key={i} className="flex gap-3">
                        <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-surface-sunken text-[11px] font-semibold text-ink-muted">
                          {i + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium uppercase tracking-wide text-ink-faint">{s.label}</div>
                          <div className="mt-0.5 text-sm">
                            <Markdown text={s.body} />
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
                {!r.text && (
                  <Button
                    variant="ghost"
                    className="mt-3 px-2 py-1.5 text-xs"
                    onClick={() => explain(r)}
                    loading={r.explaining}
                  >
                    <Sparkles size={13} /> Explain this with the tutor
                  </Button>
                )}
              </div>
            )}

            {r.text && (
              <div className="mt-4">
                <Markdown text={r.text} />
              </div>
            )}

            {r.streaming && !r.text && !r.error && (
              <div className="mt-4 flex items-center gap-2 text-sm text-ink-muted">
                <Loader2 size={15} className="animate-spin" /> Thinking…
              </div>
            )}
          </li>
        ))}
      </ul>

      {results.length > 0 && (
        <div className="mt-6 flex justify-center">
          <Button variant="ghost" className="text-xs" onClick={() => setResults([])}>
            <Trash2 size={13} /> Clear results
          </Button>
        </div>
      )}
    </div>
  );
}

/** Shows exactly which tier answered and how long it took — no rounding up. */
function SpeedBadge({ result }: { result: Result }) {
  if (result.streaming && !result.source) return null;
  if (!result.source) return null;
  const label = SOURCE_LABEL[result.source];
  const instant = result.source === "local";
  const timing =
    result.source === "local"
      ? `${result.ms < 1 ? "<1" : Math.round(result.ms)} ms`
      : result.ttft
        ? `${result.ttft} ms to first token`
        : result.ms
          ? `${result.ms} ms`
          : "";
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ${
        instant ? "bg-accent-soft text-accent" : "bg-surface-sunken text-ink-muted"
      }`}
    >
      {instant && <Zap size={11} />}
      {label}
      {timing && <span className="tabular-nums opacity-70">· {timing}</span>}
    </span>
  );
}
