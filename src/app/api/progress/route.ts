import { NextResponse } from "next/server";
import { listActivity, listConversations, listDecks, listQuizResults } from "@/lib/db";
import { getUserId } from "@/lib/user";
import { subjectName } from "@/lib/subjects";

export const runtime = "nodejs";

/**
 * Progress is derived entirely from real recorded activity — nothing is
 * fabricated. With no activity, everything returns empty/zero and the UI
 * shows empty states.
 */
export async function GET() {
  const userId = await getUserId();
  const activity = listActivity(userId, 1000);
  const quizzes = listQuizResults(userId, 200);
  const decks = listDecks(userId);
  const conversations = listConversations(userId);

  // Study streak: consecutive days (ending today or yesterday) with any activity.
  const days = new Set(activity.map((a) => new Date(a.created_at).toDateString()));
  let streak = 0;
  const cursor = new Date();
  if (!days.has(cursor.toDateString())) cursor.setDate(cursor.getDate() - 1); // streak survives until end of today
  while (days.has(cursor.toDateString())) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  // Per-subject quiz accuracy.
  const bySubject = new Map<string, { total: number; correct: number; quizzes: number }>();
  for (const q of quizzes) {
    const key = q.subject || "general";
    const entry = bySubject.get(key) || { total: 0, correct: 0, quizzes: 0 };
    entry.total += q.total;
    entry.correct += q.correct;
    entry.quizzes += 1;
    bySubject.set(key, entry);
  }
  const subjectStats = [...bySubject.entries()]
    .map(([slug, s]) => ({
      subject: slug,
      name: subjectName(slug),
      accuracy: s.total > 0 ? Math.round((s.correct / s.total) * 100) : 0,
      quizzes: s.quizzes,
      questions: s.total,
    }))
    .sort((a, b) => a.accuracy - b.accuracy);

  const weakSubjects = subjectStats.filter((s) => s.questions >= 3 && s.accuracy < 75);

  // Weak topics from stored quiz details (incorrect answers).
  const topicMisses = new Map<string, number>();
  for (const q of quizzes) {
    try {
      const details = JSON.parse(q.details) as { topic?: string; correct?: boolean }[];
      for (const d of details) {
        if (d && d.correct === false && d.topic) {
          topicMisses.set(d.topic, (topicMisses.get(d.topic) || 0) + 1);
        }
      }
    } catch {
      /* ignore malformed details */
    }
  }
  const weakTopics = [...topicMisses.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([topic, misses]) => ({ topic, misses }));

  const flashcardsReviewed = activity.filter((a) => a.kind === "flashcard_review").length;
  const chatSessions = conversations.filter((c) => c.kind === "chat").length;
  const studySessions = conversations.filter((c) => c.kind === "study").length;

  // Activity per day for the last 14 days (for a simple chart).
  const daily: { date: string; count: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toDateString();
    daily.push({
      date: d.toISOString().slice(0, 10),
      count: activity.filter((a) => new Date(a.created_at).toDateString() === key).length,
    });
  }

  const totalQuestions = quizzes.reduce((s, q) => s + q.total, 0);
  const totalCorrect = quizzes.reduce((s, q) => s + q.correct, 0);

  return NextResponse.json({
    streak,
    chatSessions,
    studySessions,
    quizCount: quizzes.length,
    totalQuestions,
    overallAccuracy: totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : null,
    flashcardsReviewed,
    deckCount: decks.length,
    subjectStats,
    weakSubjects,
    weakTopics,
    daily,
    recentQuizzes: quizzes.slice(0, 8),
    recentConversations: conversations.slice(0, 6),
    hasAnyActivity: activity.length > 0 || quizzes.length > 0 || conversations.length > 0 || decks.length > 0,
  });
}
