"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GraduationCap } from "lucide-react";
import { SUBJECTS } from "@/lib/subjects";
import { api, emit } from "@/lib/client";
import { Button, ErrorBanner, Field, PageHeader, inputCls } from "@/components/ui";

const DIFFICULTIES = ["easy", "medium", "hard", "challenge"];
const DURATIONS = ["10 minutes", "20 minutes", "30 minutes", "45+ minutes"];
const LEVELS = [
  "Elementary school",
  "Middle school",
  "High school",
  "College",
  "Adult learner",
];

export default function StudyClient() {
  const router = useRouter();
  const [subject, setSubject] = useState("math");
  const [topic, setTopic] = useState("");
  const [level, setLevel] = useState("");
  const [difficulty, setDifficulty] = useState("medium");
  const [duration, setDuration] = useState("20 minutes");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!topic.trim()) {
      setError("Enter a topic to study — for example “solving two-step equations”.");
      return;
    }
    setBusy(true);
    setError(null);
    const subjectName = SUBJECTS.find((s) => s.slug === subject)?.name || subject;
    try {
      const data = await api<{ conversation: { id: string } }>("/api/conversations", {
        method: "POST",
        body: JSON.stringify({
          subject,
          kind: "study",
          title: `Lesson: ${topic.trim()}`,
          meta: { topic: topic.trim(), level, difficulty, duration },
        }),
      });
      sessionStorage.setItem(
        `tutor-autosend-${data.conversation.id}`,
        `I'm ready to start my ${subjectName} lesson on "${topic.trim()}". Please begin with the learning objective and the first explanation.`
      );
      emit("conversations-changed");
      router.push(`/tutor/${data.conversation.id}`);
    } catch (err: any) {
      setError(err?.message || "Could not start the lesson. Please try again.");
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8">
      <PageHeader
        title="Study Mode"
        subtitle="Set up a focused, interactive lesson. Your tutor will teach step by step, give examples and practice, then check your understanding."
      />
      <form onSubmit={start} className="space-y-5 rounded-2xl border border-line bg-surface-raised p-6 shadow-sm">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Subject">
            <select value={subject} onChange={(e) => setSubject(e.target.value)} className={inputCls} aria-label="Subject">
              {SUBJECTS.map((s) => (
                <option key={s.slug} value={s.slug}>
                  {s.emoji} {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Grade / level">
            <select value={level} onChange={(e) => setLevel(e.target.value)} className={inputCls} aria-label="Grade or level">
              <option value="">Let the tutor adapt</option>
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Topic" hint="Be specific — “photosynthesis”, “the French Revolution”, “solving two-step equations”…">
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="What do you want to learn?"
            className={inputCls}
            maxLength={200}
            required
          />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Difficulty">
            <select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value)}
              className={inputCls}
              aria-label="Difficulty"
            >
              {DIFFICULTIES.map((d) => (
                <option key={d} value={d}>
                  {d[0].toUpperCase() + d.slice(1)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Study duration">
            <select value={duration} onChange={(e) => setDuration(e.target.value)} className={inputCls} aria-label="Study duration">
              {DURATIONS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {error && <ErrorBanner message={error} />}
        <Button type="submit" loading={busy} className="w-full">
          <GraduationCap size={16} /> Start lesson
        </Button>
        <p className="text-center text-xs text-ink-faint">
          During the lesson you can say “explain this more simply”, “give me another example”, “quiz me”, or “give me a
          harder question”.
        </p>
      </form>
    </div>
  );
}
