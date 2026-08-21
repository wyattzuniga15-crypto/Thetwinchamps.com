import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

/**
 * SQLite persistence layer. Zero-config: the database lives in .data/tutor.db.
 * All access goes through the query helpers below so the storage engine can be
 * swapped for Postgres/Supabase later without touching route handlers.
 */

const DATA_DIR = path.resolve(process.cwd(), process.env.DATA_DIR || ".data");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  db = new Database(path.join(DATA_DIR, "tutor.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      theme TEXT NOT NULL DEFAULT 'system',
      level TEXT NOT NULL DEFAULT '',
      response_length TEXT NOT NULL DEFAULT 'balanced',
      model TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT 'New chat',
      subject TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'chat',
      meta TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      meta TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS quiz_results (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject TEXT NOT NULL,
      topic TEXT NOT NULL,
      difficulty TEXT NOT NULL,
      total INTEGER NOT NULL,
      correct INTEGER NOT NULL,
      details TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_quiz_user ON quiz_results(user_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS decks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      subject TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
      front TEXT NOT NULL,
      back TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      reviews INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cards_deck ON cards(deck_id);
    CREATE TABLE IF NOT EXISTS activity_log (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      subject TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_log(user_id, created_at DESC);
  `);
}

export const now = () => Date.now();
export const uid = () => crypto.randomUUID();

// ── Users & settings ─────────────────────────────────────────────────────────

export function ensureUser(id: string) {
  const db = getDb();
  db.prepare("INSERT OR IGNORE INTO users (id, created_at) VALUES (?, ?)").run(id, now());
  db.prepare(
    "INSERT OR IGNORE INTO settings (user_id, updated_at) VALUES (?, ?)"
  ).run(id, now());
}

export interface Settings {
  theme: string;
  level: string;
  response_length: string;
  model: string;
}

export function getSettings(userId: string): Settings {
  ensureUser(userId);
  return getDb()
    .prepare("SELECT theme, level, response_length, model FROM settings WHERE user_id = ?")
    .get(userId) as Settings;
}

export function updateSettings(userId: string, patch: Partial<Settings>) {
  ensureUser(userId);
  const current = getSettings(userId);
  const next = { ...current, ...patch };
  getDb()
    .prepare(
      "UPDATE settings SET theme = ?, level = ?, response_length = ?, model = ?, updated_at = ? WHERE user_id = ?"
    )
    .run(next.theme, next.level, next.response_length, next.model, now(), userId);
  return next;
}

// ── Conversations & messages ─────────────────────────────────────────────────

export interface Conversation {
  id: string;
  title: string;
  subject: string;
  kind: string;
  meta: string;
  created_at: number;
  updated_at: number;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  meta: string;
  created_at: number;
}

export function createConversation(
  userId: string,
  opts: { title?: string; subject?: string; kind?: string; meta?: object } = {}
): Conversation {
  ensureUser(userId);
  const id = uid();
  const t = now();
  getDb()
    .prepare(
      "INSERT INTO conversations (id, user_id, title, subject, kind, meta, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .run(
      id,
      userId,
      opts.title || "New chat",
      opts.subject || "",
      opts.kind || "chat",
      JSON.stringify(opts.meta || {}),
      t,
      t
    );
  return getConversation(userId, id)!;
}

export function getConversation(userId: string, id: string): Conversation | undefined {
  return getDb()
    .prepare(
      "SELECT id, title, subject, kind, meta, created_at, updated_at FROM conversations WHERE id = ? AND user_id = ?"
    )
    .get(id, userId) as Conversation | undefined;
}

export function listConversations(userId: string, search?: string): Conversation[] {
  ensureUser(userId);
  if (search) {
    return getDb()
      .prepare(
        `SELECT DISTINCT c.id, c.title, c.subject, c.kind, c.meta, c.created_at, c.updated_at
         FROM conversations c
         LEFT JOIN messages m ON m.conversation_id = c.id
         WHERE c.user_id = ? AND (c.title LIKE ? OR m.content LIKE ?)
         ORDER BY c.updated_at DESC LIMIT 100`
      )
      .all(userId, `%${search}%`, `%${search}%`) as Conversation[];
  }
  return getDb()
    .prepare(
      "SELECT id, title, subject, kind, meta, created_at, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100"
    )
    .all(userId) as Conversation[];
}

export function renameConversation(userId: string, id: string, title: string) {
  getDb()
    .prepare("UPDATE conversations SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    .run(title.slice(0, 120), now(), id, userId);
}

export function deleteConversation(userId: string, id: string) {
  getDb().prepare("DELETE FROM conversations WHERE id = ? AND user_id = ?").run(id, userId);
}

export function clearConversationMessages(userId: string, id: string) {
  const convo = getConversation(userId, id);
  if (!convo) return;
  getDb().prepare("DELETE FROM messages WHERE conversation_id = ?").run(id);
}

export function touchConversation(id: string) {
  getDb().prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(now(), id);
}

export function addMessage(
  conversationId: string,
  role: "user" | "assistant",
  content: string,
  meta: object = {}
): Message {
  const id = uid();
  const t = now();
  getDb()
    .prepare(
      "INSERT INTO messages (id, conversation_id, role, content, meta, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(id, conversationId, role, content, JSON.stringify(meta), t);
  touchConversation(conversationId);
  return { id, conversation_id: conversationId, role, content, meta: JSON.stringify(meta), created_at: t };
}

export function listMessages(conversationId: string): Message[] {
  return getDb()
    .prepare(
      "SELECT id, conversation_id, role, content, meta, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC"
    )
    .all(conversationId) as Message[];
}

export function deleteMessage(id: string) {
  getDb().prepare("DELETE FROM messages WHERE id = ?").run(id);
}

// ── Memory ───────────────────────────────────────────────────────────────────

export interface MemoryItem {
  id: string;
  content: string;
  created_at: number;
}

export function listMemories(userId: string): MemoryItem[] {
  ensureUser(userId);
  return getDb()
    .prepare("SELECT id, content, created_at FROM memories WHERE user_id = ? ORDER BY created_at DESC LIMIT 50")
    .all(userId) as MemoryItem[];
}

export function addMemory(userId: string, content: string) {
  ensureUser(userId);
  // avoid exact duplicates
  const existing = getDb()
    .prepare("SELECT id FROM memories WHERE user_id = ? AND content = ?")
    .get(userId, content);
  if (existing) return;
  getDb()
    .prepare("INSERT INTO memories (id, user_id, content, created_at) VALUES (?, ?, ?, ?)")
    .run(uid(), userId, content.slice(0, 500), now());
}

export function deleteMemory(userId: string, id: string) {
  getDb().prepare("DELETE FROM memories WHERE id = ? AND user_id = ?").run(id, userId);
}

export function clearMemories(userId: string) {
  getDb().prepare("DELETE FROM memories WHERE user_id = ?").run(userId);
}

// ── Quiz results ─────────────────────────────────────────────────────────────

export interface QuizResult {
  id: string;
  subject: string;
  topic: string;
  difficulty: string;
  total: number;
  correct: number;
  details: string;
  created_at: number;
}

export function saveQuizResult(
  userId: string,
  r: { subject: string; topic: string; difficulty: string; total: number; correct: number; details: unknown }
): QuizResult {
  ensureUser(userId);
  const id = uid();
  const t = now();
  getDb()
    .prepare(
      "INSERT INTO quiz_results (id, user_id, subject, topic, difficulty, total, correct, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .run(id, userId, r.subject, r.topic, r.difficulty, r.total, r.correct, JSON.stringify(r.details ?? []), t);
  logActivity(userId, "quiz", r.subject, `${r.correct}/${r.total} on ${r.topic || r.subject}`);
  return { id, ...r, details: JSON.stringify(r.details ?? []), created_at: t };
}

export function listQuizResults(userId: string, limit = 50): QuizResult[] {
  ensureUser(userId);
  return getDb()
    .prepare(
      "SELECT id, subject, topic, difficulty, total, correct, details, created_at FROM quiz_results WHERE user_id = ? ORDER BY created_at DESC LIMIT ?"
    )
    .all(userId, limit) as QuizResult[];
}

// ── Flashcards ───────────────────────────────────────────────────────────────

export interface Deck {
  id: string;
  title: string;
  subject: string;
  created_at: number;
  card_count?: number;
  known_count?: number;
}

export interface Card {
  id: string;
  deck_id: string;
  front: string;
  back: string;
  status: "new" | "known" | "review";
  reviews: number;
  updated_at: number;
}

export function createDeck(
  userId: string,
  title: string,
  subject: string,
  cards: { front: string; back: string }[]
): Deck {
  ensureUser(userId);
  const id = uid();
  const t = now();
  const db = getDb();
  const insertDeck = db.prepare(
    "INSERT INTO decks (id, user_id, title, subject, created_at) VALUES (?, ?, ?, ?, ?)"
  );
  const insertCard = db.prepare(
    "INSERT INTO cards (id, deck_id, front, back, status, reviews, updated_at) VALUES (?, ?, ?, ?, 'new', 0, ?)"
  );
  const tx = db.transaction(() => {
    insertDeck.run(id, userId, title.slice(0, 120), subject, t);
    for (const c of cards) insertCard.run(uid(), id, c.front.slice(0, 1000), c.back.slice(0, 2000), t);
  });
  tx();
  logActivity(userId, "flashcards_created", subject, title);
  return { id, title, subject, created_at: t };
}

export function listDecks(userId: string): Deck[] {
  ensureUser(userId);
  return getDb()
    .prepare(
      `SELECT d.id, d.title, d.subject, d.created_at,
              COUNT(c.id) AS card_count,
              SUM(CASE WHEN c.status = 'known' THEN 1 ELSE 0 END) AS known_count
       FROM decks d LEFT JOIN cards c ON c.deck_id = d.id
       WHERE d.user_id = ?
       GROUP BY d.id ORDER BY d.created_at DESC`
    )
    .all(userId) as Deck[];
}

export function getDeck(userId: string, id: string): { deck: Deck; cards: Card[] } | undefined {
  const deck = getDb()
    .prepare("SELECT id, title, subject, created_at FROM decks WHERE id = ? AND user_id = ?")
    .get(id, userId) as Deck | undefined;
  if (!deck) return undefined;
  const cards = getDb()
    .prepare("SELECT id, deck_id, front, back, status, reviews, updated_at FROM cards WHERE deck_id = ? ORDER BY rowid ASC")
    .all(id) as Card[];
  return { deck, cards };
}

export function updateCardStatus(userId: string, deckId: string, cardId: string, status: "known" | "review") {
  const deck = getDb().prepare("SELECT id FROM decks WHERE id = ? AND user_id = ?").get(deckId, userId);
  if (!deck) return false;
  getDb()
    .prepare("UPDATE cards SET status = ?, reviews = reviews + 1, updated_at = ? WHERE id = ? AND deck_id = ?")
    .run(status, now(), cardId, deckId);
  logActivity(userId, "flashcard_review", "", status);
  return true;
}

export function deleteDeck(userId: string, id: string) {
  getDb().prepare("DELETE FROM decks WHERE id = ? AND user_id = ?").run(id, userId);
}

// ── Activity / progress ──────────────────────────────────────────────────────

export function logActivity(userId: string, kind: string, subject = "", detail = "") {
  ensureUser(userId);
  getDb()
    .prepare("INSERT INTO activity_log (id, user_id, kind, subject, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(uid(), userId, kind, subject, detail.slice(0, 300), now());
}

export interface ActivityRow {
  kind: string;
  subject: string;
  detail: string;
  created_at: number;
}

export function listActivity(userId: string, limit = 500): ActivityRow[] {
  ensureUser(userId);
  return getDb()
    .prepare("SELECT kind, subject, detail, created_at FROM activity_log WHERE user_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(userId, limit) as ActivityRow[];
}

// ── Danger zone ──────────────────────────────────────────────────────────────

export function clearAllConversations(userId: string) {
  getDb().prepare("DELETE FROM conversations WHERE user_id = ?").run(userId);
}

export function deleteAllUserData(userId: string) {
  getDb().prepare("DELETE FROM users WHERE id = ?").run(userId);
}
