"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Check, ListChecks, RotateCcw, X } from "lucide-react";
import { SUBJECTS, subjectName } from "@/lib/subjects";
import { api, emit } from "@/lib/client";
import Markdown from "@/components/Markdown";
import { Button, ErrorBanner, Field, PageHeader, Spinner, inputCls } from "@/components/ui";

interface Question {
  type: "multiple_choice" | "true_false" | "short_answer" | "fill_blank";
  question: string;
  options?: string[];
  answer: string;
  explanation: string;
  topic: string;
}

interface AnswerRecord {
  question: Question;
  studentAnswer: string;
  correct: boolean;
  feedback?: string;
}

type Phase = "setup" | "generating" | "running" | "summary";

const normalize = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[.,;:!?'"()]/g, "")
    .replace(/\s+/g, " ");

export default function QuizClient() {
  const params = useSearchParams();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("setup");
  const [subject, setSubject] = useState(params.get("subject") || "math");
  const [topic, setTopic] = useState("");
  const [difficulty, setDifficulty] = useState("medium");
  const [count, setCount] = useState(5);
  const [error, setError] = useState<string | null>(null);

  const [questions, setQuestions] = useState<Question[]>([]);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string>("");
  const [typed, setTyped] = useState("");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<{ correct: boolean; feedback?: string } | null>(null);
  const [records, setRecords] = useState<AnswerRecord[]>([]);
  const [saveState, setSaveState] = useState<"idle" | "saved" | "failed">("idle");

  const generate = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setPhase("generating");
    setError(null);
    try {
      const data = await api<{ questions: Question[] }>("/api/quiz/generate", {
        method: "POST",
        body: JSON.stringify({ subject, topic, difficulty, count }),
      });
      setQuestions(data.questions);
      setRecords([]);
      setIndex(0);
      setSelected("");
      setTyped("");
      setResult(null);
      setSaveState("idle");
      setPhase("running");
    } catch (err: any) {
      setError(err?.message || "Could not generate the quiz.");
      setPhase("setup");
    }
  };

  const current = questions[index];
  const isChoice = current && (current.type === "multiple_choice" || current.type === "true_false");
  const studentAnswer = isChoice ? selected : typed;

  const check = async () => {
    if (!current || checking || result) return;
    if (!studentAnswer.trim()) return;
    setChecking(true);
    let correct = false;
    let feedback: string | undefined;
    if (isChoice) {
      correct = normalize(studentAnswer) === normalize(current.answer);
    } else {
      correct = normalize(studentAnswer) === normalize(current.answer);
      if (!correct) {
        // Not an exact match — let the AI judge equivalence; fall back to exact result.
        try {
          const graded = await api<{ correct: boolean; feedback: string }>("/api/quiz/grade", {
            method: "POST",
            body: JSON.stringify({
              question: current.question,
              expectedAnswer: current.answer,
              studentAnswer,
            }),
          });
          correct = graded.correct;
          feedback = graded.feedback;
        } catch {
          feedback = "Compared literally with the expected answer (AI grading was unavailable).";
        }
      }
    }
    setResult({ correct, feedback });
    setRecords((r) => [...r, { question: current, studentAnswer, correct, feedback }]);
    setChecking(false);
  };

  const next = () => {
    if (index + 1 >= questions.length) {
      setPhase("summary");
    } else {
      setIndex(index + 1);
      setSelected("");
      setTyped("");
      setResult(null);
    }
  };

  // Persist results when the quiz completes.
  useEffect(() => {
    if (phase !== "summary" || records.length === 0 || saveState !== "idle") return;
    const correct = records.filter((r) => r.correct).length;
    api("/api/quiz/results", {
      method: "POST",
      body: JSON.stringify({
        subject,
        topic,
        difficulty,
        total: records.length,
        correct,
        details: records.map((r) => ({
          topic: r.question.topic,
          correct: r.correct,
          type: r.question.type,
        })),
      }),
    })
      .then(() => setSaveState("saved"))
      .catch(() => setSaveState("failed"));
  }, [phase, records, saveState, subject, topic, difficulty]);

  const reviewTopic = async (t: string) => {
    try {
      const data = await api<{ conversation: { id: string } }>("/api/conversations", {
        method: "POST",
        body: JSON.stringify({ subject }),
      });
      sessionStorage.setItem(
        `tutor-autosend-${data.conversation.id}`,
        `I just missed some quiz questions about "${t}" (${subjectName(subject)}). Can you explain this topic and then give me a practice question?`
      );
      emit("conversations-changed");
      router.push(`/tutor/${data.conversation.id}`);
    } catch (err: any) {
      setError(err?.message || "Could not open the tutor.");
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (phase === "setup" || phase === "generating") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8 md:px-8">
        <PageHeader
          title="Quiz"
          subtitle="Generate a fresh quiz on any topic. Answers are explained as you go, and results feed your progress."
        />
        {phase === "generating" ? (
          <div className="rounded-2xl border border-line bg-surface-raised p-6 shadow-sm">
            <Spinner label="Writing your quiz questions…" />
          </div>
        ) : (
          <form onSubmit={generate} className="space-y-5 rounded-2xl border border-line bg-surface-raised p-6 shadow-sm">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Subject">
                <select value={subject} onChange={(e) => setSubject(e.target.value)} className={inputCls}>
                  {SUBJECTS.map((s) => (
                    <option key={s.slug} value={s.slug}>
                      {s.emoji} {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Difficulty">
                <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} className={inputCls}>
                  {["easy", "medium", "hard", "challenge"].map((d) => (
                    <option key={d} value={d}>
                      {d[0].toUpperCase() + d.slice(1)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Topic (optional)" hint="Leave blank for a general quiz on the subject.">
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g. fractions, the water cycle, World War II…"
                className={inputCls}
                maxLength={150}
              />
            </Field>
            <Field label={`Questions: ${count}`}>
              <input
                type="range"
                min={3}
                max={15}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                className="w-full accent-[rgb(var(--accent))]"
                aria-label="Number of questions"
              />
            </Field>
            {error && <ErrorBanner message={error} onRetry={() => generate()} />}
            <Button type="submit" className="w-full">
              <ListChecks size={16} /> Generate quiz
            </Button>
          </form>
        )}
      </div>
    );
  }

  if (phase === "running" && current) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8 md:px-8">
        <div className="mb-4 flex items-center justify-between text-sm text-ink-muted">
          <span className="font-medium">
            Question {index + 1} of {questions.length}
          </span>
          <span>
            {subjectName(subject)}
            {topic ? ` · ${topic}` : ""} · {difficulty}
          </span>
        </div>
        <div
          className="mb-6 h-1.5 overflow-hidden rounded-full bg-surface-sunken"
          role="progressbar"
          aria-valuenow={index + 1}
          aria-valuemin={0}
          aria-valuemax={questions.length}
        >
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${((index + (result ? 1 : 0)) / questions.length) * 100}%` }}
          />
        </div>

        <div className="rounded-2xl border border-line bg-surface-raised p-6 shadow-sm animate-fade-up" key={index}>
          <div className="text-xs font-medium uppercase tracking-wide text-ink-faint">
            {current.type.replace("_", " ")}
            {current.topic ? ` · ${current.topic}` : ""}
          </div>
          <div className="mt-2 text-[15px] font-medium leading-7">
            <Markdown text={current.question} />
          </div>

          {isChoice ? (
            <div className="mt-5 space-y-2" role="radiogroup" aria-label="Answer choices">
              {(current.options || []).map((opt) => {
                const isSelected = selected === opt;
                const isAnswer = result && normalize(opt) === normalize(current.answer);
                const wasWrongPick = result && isSelected && !result.correct;
                return (
                  <button
                    key={opt}
                    role="radio"
                    aria-checked={isSelected}
                    disabled={!!result}
                    onClick={() => setSelected(opt)}
                    className={`flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left text-sm transition ${
                      isAnswer
                        ? "border-green-500 bg-green-50 dark:bg-green-950/40"
                        : wasWrongPick
                          ? "border-red-400 bg-red-50 dark:bg-red-950/40"
                          : isSelected
                            ? "border-accent bg-accent-soft"
                            : "border-line bg-surface hover:border-accent/40"
                    } disabled:cursor-default`}
                  >
                    <span>{opt}</span>
                    {isAnswer && <Check size={16} className="shrink-0 text-green-600" />}
                    {wasWrongPick && <X size={16} className="shrink-0 text-red-500" />}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="mt-5">
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && check()}
                disabled={!!result}
                placeholder={current.type === "fill_blank" ? "Fill in the blank…" : "Type your answer…"}
                aria-label="Your answer"
                className={inputCls}
              />
            </div>
          )}

          {result && (
            <div
              role="status"
              className={`mt-5 rounded-xl border p-4 text-sm animate-fade-up ${
                result.correct
                  ? "border-green-500/40 bg-green-50 dark:bg-green-950/30"
                  : "border-red-400/40 bg-red-50 dark:bg-red-950/30"
              }`}
            >
              <div className={`flex items-center gap-1.5 font-semibold ${result.correct ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                {result.correct ? <Check size={15} /> : <X size={15} />}
                {result.correct ? "Correct!" : "Not quite"}
              </div>
              {!result.correct && (
                <p className="mt-1.5">
                  <span className="font-medium">Correct answer:</span> {current.answer}
                </p>
              )}
              {result.feedback && <p className="mt-1 text-ink-muted">{result.feedback}</p>}
              {current.explanation && (
                <div className="mt-2 text-ink-muted">
                  <Markdown text={current.explanation} />
                </div>
              )}
            </div>
          )}

          <div className="mt-6 flex justify-end gap-2">
            {result ? (
              <Button onClick={next}>
                {index + 1 >= questions.length ? "See results" : "Next question"} <ArrowRight size={15} />
              </Button>
            ) : (
              <Button onClick={check} loading={checking} disabled={!studentAnswer.trim()}>
                Check answer
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Summary
  const correctCount = records.filter((r) => r.correct).length;
  const accuracy = records.length ? Math.round((correctCount / records.length) * 100) : 0;
  const missedTopics = [...new Set(records.filter((r) => !r.correct).map((r) => r.question.topic).filter(Boolean))];

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8">
      <PageHeader title="Quiz results" subtitle={`${subjectName(subject)}${topic ? ` · ${topic}` : ""} · ${difficulty}`} />

      <div className="rounded-2xl border border-line bg-surface-raised p-6 text-center shadow-sm">
        <div className="text-5xl font-semibold tabular-nums">
          {correctCount}
          <span className="text-2xl text-ink-faint">/{records.length}</span>
        </div>
        <div className="mt-1 text-sm text-ink-muted">{accuracy}% accuracy</div>
        <div className="mx-auto mt-4 h-2 max-w-xs overflow-hidden rounded-full bg-surface-sunken">
          <div
            className={`h-full rounded-full ${accuracy >= 75 ? "bg-green-500" : accuracy >= 50 ? "bg-amber-500" : "bg-red-500"}`}
            style={{ width: `${accuracy}%` }}
          />
        </div>
        <p className="mt-3 text-xs text-ink-faint">
          {saveState === "saved" && "Result saved to your progress."}
          {saveState === "failed" && "Result could not be saved to your progress."}
          {saveState === "idle" && "Saving result…"}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <Button variant="secondary" onClick={() => setPhase("setup")}>
            <RotateCcw size={15} /> New quiz
          </Button>
          <Button onClick={() => generate()}>Retry this topic</Button>
        </div>
      </div>

      {missedTopics.length > 0 && (
        <div className="mt-6 rounded-2xl border border-line bg-surface-raised p-5 shadow-sm">
          <h2 className="text-sm font-semibold">Recommended review</h2>
          <p className="mt-1 text-sm text-ink-muted">You missed questions on these topics — review them with your tutor:</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {missedTopics.map((t) => (
              <button
                key={t}
                onClick={() => reviewTopic(t)}
                className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink-muted transition hover:border-accent/40 hover:text-ink"
              >
                {t} →
              </button>
            ))}
          </div>
        </div>
      )}

      <h2 className="mb-3 mt-8 text-base font-semibold">Question review</h2>
      <ol className="space-y-3">
        {records.map((r, i) => (
          <li key={i} className={`rounded-2xl border p-5 ${r.correct ? "border-line bg-surface-raised" : "border-red-400/40 bg-surface-raised"}`}>
            <div className="flex items-start gap-2.5">
              <span
                className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-white ${r.correct ? "bg-green-500" : "bg-red-500"}`}
                aria-label={r.correct ? "Correct" : "Incorrect"}
              >
                {r.correct ? <Check size={12} /> : <X size={12} />}
              </span>
              <div className="min-w-0 flex-1 text-sm">
                <div className="font-medium leading-6">
                  <Markdown text={r.question.question} />
                </div>
                <p className="mt-1.5">
                  <span className="text-ink-faint">Your answer:</span> {r.studentAnswer || "—"}
                </p>
                {!r.correct && (
                  <p className="mt-0.5">
                    <span className="text-ink-faint">Correct answer:</span> {r.question.answer}
                  </p>
                )}
                {r.question.explanation && (
                  <div className="mt-2 border-t border-line pt-2 text-ink-muted">
                    <Markdown text={r.question.explanation} />
                  </div>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>
      {error && (
        <div className="mt-4">
          <ErrorBanner message={error} />
        </div>
      )}
    </div>
  );
}
