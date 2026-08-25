import Link from "next/link";
import {
  ArrowRight,
  Bot,
  Calculator,
  Flame,
  GraduationCap,
  Layers,
  ListChecks,
  MessageSquare,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { getUserId } from "@/lib/user";
import { listActivity, listConversations, listDecks, listQuizResults } from "@/lib/db";
import { SUBJECTS, subjectName } from "@/lib/subjects";

export const dynamic = "force-dynamic";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default async function HomePage() {
  const userId = await getUserId();
  const conversations = listConversations(userId);
  const quizzes = listQuizResults(userId, 100);
  const decks = listDecks(userId);
  const activity = listActivity(userId, 500);

  // Streak from real activity days.
  const days = new Set(activity.map((a) => new Date(a.created_at).toDateString()));
  let streak = 0;
  const cursor = new Date();
  if (!days.has(cursor.toDateString())) cursor.setDate(cursor.getDate() - 1);
  while (days.has(cursor.toDateString())) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  const totalQuestions = quizzes.reduce((s, q) => s + q.total, 0);
  const totalCorrect = quizzes.reduce((s, q) => s + q.correct, 0);
  const accuracy = totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : null;

  // Weak subjects (real quiz data only).
  const bySubject = new Map<string, { total: number; correct: number }>();
  for (const q of quizzes) {
    const e = bySubject.get(q.subject || "general") || { total: 0, correct: 0 };
    e.total += q.total;
    e.correct += q.correct;
    bySubject.set(q.subject || "general", e);
  }
  const weak = [...bySubject.entries()]
    .filter(([, s]) => s.total >= 3)
    .map(([slug, s]) => ({ slug, accuracy: Math.round((s.correct / s.total) * 100) }))
    .filter((s) => s.accuracy < 75)
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, 3);

  const recentChats = conversations.slice(0, 4);
  const hasActivity = conversations.length > 0 || quizzes.length > 0 || decks.length > 0;

  // Recommended topics: from weak subjects when known, otherwise a starter mix.
  const recommended = weak.length
    ? weak.flatMap((w) => {
        const subj = SUBJECTS.find((s) => s.slug === w.slug);
        return (subj?.topics.slice(0, 2) || []).map((t) => ({ topic: t, subject: subj!.slug, name: subj!.name }));
      })
    : [
        { topic: "Fractions & decimals", subject: "math", name: "Mathematics" },
        { topic: "Essay writing", subject: "english", name: "English" },
        { topic: "Scientific method", subject: "science", name: "Science" },
        { topic: "Study techniques", subject: "general", name: "General Knowledge" },
      ];

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{greeting()} 👋</h1>
          <p className="mt-1.5 text-sm text-ink-muted md:text-base">
            {hasActivity
              ? "Ready to keep learning? Pick up where you left off."
              : "Welcome to your personal AI tutor. Start your first lesson to begin tracking your progress."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/math"
            className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface-raised px-4 py-2.5 text-sm font-medium transition hover:bg-surface-sunken"
          >
            <Calculator size={16} /> Math Mode
          </Link>
          <Link
            href="/tutor"
            className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-ink shadow-sm transition hover:opacity-90"
          >
            <Bot size={16} /> Ask the tutor
          </Link>
        </div>
      </div>

      {/* Stats — only real data; helpful zeros/empty states otherwise */}
      <div className="mt-7 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          icon={<Flame size={17} />}
          label="Study streak"
          value={streak > 0 ? `${streak} day${streak === 1 ? "" : "s"}` : "—"}
          hint={streak > 0 ? "Keep it going!" : "Study today to start one"}
        />
        <StatCard
          icon={<ListChecks size={17} />}
          label="Quiz accuracy"
          value={accuracy !== null ? `${accuracy}%` : "—"}
          hint={accuracy !== null ? `${quizzes.length} quiz${quizzes.length === 1 ? "" : "zes"} taken` : "Take your first quiz"}
        />
        <StatCard
          icon={<MessageSquare size={17} />}
          label="Tutor sessions"
          value={conversations.length > 0 ? String(conversations.length) : "—"}
          hint={conversations.length > 0 ? "across all subjects" : "Start your first chat"}
        />
        <StatCard
          icon={<Layers size={17} />}
          label="Flashcard decks"
          value={decks.length > 0 ? String(decks.length) : "—"}
          hint={decks.length > 0 ? `${decks.reduce((s, d) => s + (d.card_count || 0), 0)} cards` : "Generate a deck"}
        />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-5">
        <section className="lg:col-span-3" aria-labelledby="continue-heading">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="continue-heading" className="text-base font-semibold">
              Continue learning
            </h2>
            {recentChats.length > 0 && (
              <Link href="/tutor" className="text-sm text-accent hover:underline">
                New chat
              </Link>
            )}
          </div>
          {recentChats.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line px-6 py-10 text-center">
              <p className="text-sm text-ink-muted">Start your first lesson to begin tracking your progress.</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Link
                  href="/study"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface-raised px-3.5 py-2 text-sm font-medium hover:bg-surface-sunken"
                >
                  <GraduationCap size={15} /> Study Mode
                </Link>
                <Link
                  href="/subjects"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface-raised px-3.5 py-2 text-sm font-medium hover:bg-surface-sunken"
                >
                  <Sparkles size={15} /> Browse subjects
                </Link>
              </div>
            </div>
          ) : (
            <ul className="space-y-2">
              {recentChats.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/tutor/${c.id}`}
                    className="group flex items-center gap-3 rounded-xl border border-line bg-surface-raised px-4 py-3 transition hover:border-accent/40"
                  >
                    {c.kind === "study" ? (
                      <GraduationCap size={16} className="shrink-0 text-ink-faint" />
                    ) : (
                      <MessageSquare size={16} className="shrink-0 text-ink-faint" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{c.title}</div>
                      <div className="text-xs text-ink-faint">
                        {c.subject ? `${subjectName(c.subject)} · ` : ""}
                        {new Date(c.updated_at).toLocaleDateString([], { month: "short", day: "numeric" })}
                      </div>
                    </div>
                    <ArrowRight size={15} className="shrink-0 text-ink-faint transition group-hover:translate-x-0.5 group-hover:text-accent" />
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {weak.length > 0 && (
            <div className="mt-6">
              <h2 className="mb-3 text-base font-semibold">Needs attention</h2>
              <ul className="space-y-2">
                {weak.map((w) => (
                  <li
                    key={w.slug}
                    className="flex items-center justify-between rounded-xl border border-line bg-surface-raised px-4 py-3"
                  >
                    <span className="text-sm">
                      <span className="font-medium">{subjectName(w.slug)}</span>
                      <span className="text-ink-muted"> — {w.accuracy}% quiz accuracy</span>
                    </span>
                    <Link href={`/quiz?subject=${w.slug}`} className="text-sm font-medium text-accent hover:underline">
                      Practice
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="lg:col-span-2" aria-labelledby="recommended-heading">
          <h2 id="recommended-heading" className="mb-3 text-base font-semibold">
            {weak.length > 0 ? "Suggested practice" : "Recommended topics"}
          </h2>
          <ul className="space-y-2">
            {recommended.slice(0, 5).map((r) => (
              <li key={`${r.subject}-${r.topic}`}>
                <Link
                  href={`/subjects?start=${encodeURIComponent(r.topic)}&subject=${r.subject}`}
                  className="group flex items-center gap-3 rounded-xl border border-line bg-surface-raised px-4 py-3 transition hover:border-accent/40"
                >
                  <span className="text-lg" aria-hidden>
                    {SUBJECTS.find((s) => s.slug === r.subject)?.emoji || "✨"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{r.topic}</div>
                    <div className="text-xs text-ink-faint">{r.name}</div>
                  </div>
                  <ArrowRight size={15} className="shrink-0 text-ink-faint transition group-hover:translate-x-0.5 group-hover:text-accent" />
                </Link>
              </li>
            ))}
          </ul>

          <div className="mt-6 rounded-2xl border border-line bg-surface-raised p-5">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <TrendingUp size={16} className="text-accent" /> Your progress
            </div>
            <p className="mt-1.5 text-sm text-ink-muted">
              {hasActivity
                ? "See your quiz scores, streak, and weak areas in detail."
                : "Complete lessons and quizzes to build your progress picture."}
            </p>
            <Link href="/progress" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
              View progress <ArrowRight size={14} />
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface-raised p-4">
      <div className="flex items-center gap-2 text-ink-muted">
        <span className="text-accent">{icon}</span>
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs text-ink-faint">{hint}</div>
    </div>
  );
}
