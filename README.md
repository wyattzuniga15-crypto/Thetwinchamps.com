# AI Education Tutor

A polished, full-stack AI education platform — a personal tutor that combines a ChatGPT-style
streaming chat experience with structured learning tools: study lessons, quizzes, flashcards,
progress tracking, file uploads, and tutor memory.

Covers every school subject: English/language arts, mathematics (with step-by-step LaTeX
solutions), science, history, geography, computer science, reading, writing, grammar,
vocabulary, foreign languages, study skills, test prep, homework help, and research.

## Features

- **AI Tutor chat** — streaming responses, Markdown + LaTeX math + syntax-highlighted code,
  chat history with search/rename/delete, copy, regenerate, stop generation, timestamps.
- **Subjects** — 10 subject areas with curated topic launchers, each opening a focused
  tutoring session.
- **Study Mode** — configurable interactive lessons (subject, topic, level, difficulty,
  duration) with a structured teaching arc: objective → explanation → examples → practice →
  knowledge check → review → next step.
- **Quiz system** — AI-generated quizzes (multiple choice, true/false, short answer,
  fill-in-the-blank) with per-question explanations, AI grading of free-text answers, score
  summary, weak-topic detection, and one-click review with the tutor.
- **Flashcards** — decks generated from a topic, pasted notes, or an existing conversation;
  flip/prev/next/shuffle, known / needs-review tracking with keyboard support.
- **Progress** — study streak, quiz accuracy by subject, weak topics, 14-day activity chart —
  derived entirely from real recorded activity (never fabricated).
- **File uploads** — PDF, DOCX, TXT/MD/CSV, and images (photographed homework goes to the
  vision model). Validated by type, size, and magic bytes; never executed.
- **Memory** — the tutor saves durable educational facts (level, goals, struggles) and uses
  them to personalize sessions; fully viewable and deletable in Settings.
- **Settings** — light/dark/system theme, student level, response length, model override,
  memory controls, clear conversations, delete-all-data.
- Responsive (mobile drawer navigation), accessible (keyboard nav, labels, focus states),
  dark mode, graceful error handling everywhere.

## Tech stack

- **Next.js 15** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS** with a token-based light/dark design system
- **SQLite** (better-sqlite3) — zero-config local persistence in `.data/`; the data layer is
  isolated in `src/lib/db.ts` so it can be swapped for Postgres/Supabase
- **Anthropic API** (default) with a provider abstraction — any OpenAI-compatible API works too
- Server-side streaming (SSE) — API keys never reach the client

## Getting started

```bash
npm install
cp .env.example .env       # then put your real API key in .env
npm run dev                # http://localhost:3000
```

### Required environment variables

| Variable | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Your Anthropic API key (default provider) |

### Optional

| Variable | Default | Purpose |
| --- | --- | --- |
| `AI_PROVIDER` | `anthropic` | `anthropic` or `openai` (any OpenAI-compatible API) |
| `AI_MODEL` | `claude-sonnet-5` | Main tutor model |
| `AI_FAST_MODEL` | (main model) | Cheap model for chat titles / grading |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` | — | Only when `AI_PROVIDER=openai` |
| `DATA_DIR` | `.data` | Where the SQLite DB and uploads live |
| `MAX_UPLOAD_MB` | `10` | Upload size limit |

### Production

```bash
npm run build
npm start
```

## Architecture notes

- **Identity**: each browser gets an anonymous httpOnly-cookie user id; every table is keyed by
  `user_id`, so real authentication can be plugged in later by swapping `src/lib/user.ts`.
- **AI layer**: `src/lib/ai/` — a small `AIProvider` interface with Anthropic and
  OpenAI-compatible implementations; switch with `AI_PROVIDER`.
- **Security**: keys are server-only; uploads are validated (type, size, magic bytes) and never
  executed; all inputs are length-limited; DB access is parameterized.

## Scripts

- `npm run dev` — development server
- `npm run build` — production build
- `npm start` — serve the production build
- `npm run lint` — ESLint
- `npm run typecheck` — TypeScript check
