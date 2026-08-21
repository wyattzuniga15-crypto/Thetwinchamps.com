"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Flame, GraduationCap, Layers, ListChecks, MessageSquare, TrendingUp } from "lucide-react";
import { api } from "@/lib/client";
import { subjectName } from "@/lib/subjects";
import { EmptyState, ErrorBanner, LinkButton, PageHeader, Spinner } from "@/components/ui";

interface ProgressData {
  streak: number;
  chatSessions: number;
  studySessions: number;
  quizCount: number;
  totalQuestions: number;
  overallAccuracy: number | null;
  flashcardsReviewed: number;
  deckCount: number;
  subjectStats: { subject: string; name: string; accuracy: number; quizzes: number; questions: number }[];
  weakSubjects: { subject: string; name: string; accuracy: number }[];
  weakTopics: { topic: string; misses: number }[];
  daily: { date: string; count: number }[];
  recentQuizzes: { id: string; subject: string; topic: string; total: number; correct: number; created_at: number }[];
  hasAnyActivity: boolean;
}

export default function ProgressClient() {
  const [data, setData] = useState<ProgressData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    api<ProgressData>("/api/progress")
      .then(setData)
      .catch((e) => setError(e.message));
  };
  useEffect(load, []);

  if (error)
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <ErrorBanner message={error} onRetry={load} />
      </div>
    );
  if (!data) return <Spinner label="Loading progress…" />;

  if (!data.hasAnyActivity) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 md:px-8">
        <PageHeader title="Progress" subtitle="Everything here is built from your real activity — nothing is made up." />
        <EmptyState
          icon={<TrendingUp size={32} />}
          title="No progress to show yet"
          message="Start your first lesson to begin tracking your progress. Chats, quizzes, and flashcard reviews all count."
          action={<LinkButton href="/study">Start your first lesson</LinkButton>}
        />
      </div>
    );
  }

  const maxDaily = Math.max(...data.daily.map((d) => d.count), 1);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:px-8">
      <PageHeader title="Progress" subtitle="Everything here is built from your real activity — nothing is made up." />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat icon={<Flame size={16} />} label="Streak" value={data.streak > 0 ? `${data.streak} day${data.streak === 1 ? "" : "s"}` : "—"} />
        <Stat
          icon={<ListChecks size={16} />}
          label="Quiz accuracy"
          value={data.overallAccuracy !== null ? `${data.overallAccuracy}%` : "—"}
          sub={data.totalQuestions > 0 ? `${data.totalQuestions} questions` : undefined}
        />
        <Stat
          icon={<MessageSquare size={16} />}
          label="Sessions"
          value={String(data.chatSessions + data.studySessions)}
          sub={`${data.studySessions} study · ${data.chatSessions} chat`}
        />
        <Stat
          icon={<Layers size={16} />}
          label="Card reviews"
          value={data.flashcardsReviewed > 0 ? String(data.flashcardsReviewed) : "—"}
          sub={data.deckCount > 0 ? `${data.deckCount} deck${data.deckCount === 1 ? "" : "s"}` : undefined}
        />
      </div>

      {/* 14-day activity chart */}
      <section className="mt-6 rounded-2xl border border-line bg-surface-raised p-5 shadow-sm" aria-label="Activity for the last 14 days">
        <h2 className="text-sm font-semibold">Last 14 days</h2>
        <div className="mt-4 flex h-24 items-end gap-1.5">
          {data.daily.map((d) => (
            <div key={d.date} className="group relative flex-1">
              <div
                className={`w-full rounded-t transition-all ${d.count > 0 ? "bg-accent" : "bg-surface-sunken"}`}
                style={{ height: `${Math.max((d.count / maxDaily) * 88, 4)}px` }}
                role="img"
                aria-label={`${d.date}: ${d.count} activities`}
              />
              <span className="pointer-events-none absolute -top-7 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-1.5 py-0.5 text-[10px] text-surface opacity-0 transition group-hover:opacity-100">
                {d.count} · {d.date.slice(5)}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-1.5 flex justify-between text-[10px] text-ink-faint">
          <span>{data.daily[0]?.date.slice(5)}</span>
          <span>today</span>
        </div>
      </section>

      {data.subjectStats.length > 0 && (
        <section className="mt-6 rounded-2xl border border-line bg-surface-raised p-5 shadow-sm" aria-label="Accuracy by subject">
          <h2 className="text-sm font-semibold">Quiz accuracy by subject</h2>
          <ul className="mt-4 space-y-3">
            {data.subjectStats.map((s) => (
              <li key={s.subject}>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-medium">{s.name}</span>
                  <span className="tabular-nums text-ink-muted">
                    {s.accuracy}% · {s.questions} questions
                  </span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-sunken">
                  <div
                    className={`h-full rounded-full ${s.accuracy >= 75 ? "bg-green-500" : s.accuracy >= 50 ? "bg-amber-500" : "bg-red-500"}`}
                    style={{ width: `${s.accuracy}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        {data.weakTopics.length > 0 && (
          <section className="rounded-2xl border border-line bg-surface-raised p-5 shadow-sm" aria-label="Topics to review">
            <h2 className="text-sm font-semibold">Weak topics</h2>
            <p className="mt-1 text-xs text-ink-muted">Topics where you&apos;ve missed quiz questions.</p>
            <ul className="mt-3 space-y-1.5">
              {data.weakTopics.map((t) => (
                <li key={t.topic} className="flex items-center justify-between rounded-lg bg-surface-sunken px-3 py-2 text-sm">
                  <span className="truncate">{t.topic}</span>
                  <span className="ml-2 shrink-0 text-xs text-ink-faint">
                    {t.misses} miss{t.misses === 1 ? "" : "es"}
                  </span>
                </li>
              ))}
            </ul>
            <LinkButton href="/quiz" variant="secondary" className="mt-4 w-full">
              <ListChecks size={15} /> Practice again
            </LinkButton>
          </section>
        )}

        {data.recentQuizzes.length > 0 && (
          <section className="rounded-2xl border border-line bg-surface-raised p-5 shadow-sm" aria-label="Recent quizzes">
            <h2 className="text-sm font-semibold">Recent quizzes</h2>
            <ul className="mt-3 space-y-1.5">
              {data.recentQuizzes.map((q) => {
                const pct = q.total > 0 ? Math.round((q.correct / q.total) * 100) : 0;
                return (
                  <li key={q.id} className="flex items-center justify-between rounded-lg bg-surface-sunken px-3 py-2 text-sm">
                    <span className="min-w-0 truncate">
                      {q.topic || subjectName(q.subject) || "General"}
                      <span className="ml-1.5 text-xs text-ink-faint">
                        {new Date(q.created_at).toLocaleDateString([], { month: "short", day: "numeric" })}
                      </span>
                    </span>
                    <span
                      className={`ml-2 shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums ${
                        pct >= 75
                          ? "bg-green-100 text-green-700 dark:bg-green-950/60 dark:text-green-400"
                          : pct >= 50
                            ? "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400"
                            : "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-400"
                      }`}
                    >
                      {q.correct}/{q.total}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>

      <div className="mt-8 text-center">
        <Link href="/study" className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline">
          <GraduationCap size={15} /> Keep the streak going — start a lesson
        </Link>
      </div>
    </div>
  );
}

function Stat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface-raised p-4">
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ink-muted">
        <span className="text-accent">{icon}</span> {label}
      </div>
      <div className="mt-1.5 text-xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-faint">{sub}</div>}
    </div>
  );
}
