"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Brain, Check, Monitor, Moon, Sun, Trash2 } from "lucide-react";
import { api, applyTheme, emit } from "@/lib/client";
import { Button, ErrorBanner, Field, PageHeader, Spinner, inputCls } from "@/components/ui";

interface Settings {
  theme: string;
  level: string;
  response_length: string;
  model: string;
}

interface AIInfo {
  provider: string;
  configured: boolean;
  defaultModel: string;
}

interface MemoryItem {
  id: string;
  content: string;
  created_at: number;
}

export default function SettingsClient() {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [ai, setAi] = useState<AIInfo | null>(null);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    Promise.all([api<{ settings: Settings; ai: AIInfo }>("/api/settings"), api<{ memories: MemoryItem[] }>("/api/memory")])
      .then(([s, m]) => {
        setSettings(s.settings);
        setAi(s.ai);
        setMemories(m.memories);
      })
      .catch((e) => setError(e.message));
  }, []);

  const save = async (patch: Partial<Settings>) => {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    if (patch.theme) applyTheme(patch.theme);
    try {
      await api("/api/settings", { method: "PATCH", body: JSON.stringify(patch) });
      emit("settings-changed");
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1200);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const deleteMemory = async (id: string) => {
    try {
      const data = await api<{ memories: MemoryItem[] }>(`/api/memory?id=${id}`, { method: "DELETE" });
      setMemories(data.memories);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const clearMemory = async () => {
    if (!confirm("Clear everything the tutor remembers about you?")) return;
    try {
      const data = await api<{ memories: MemoryItem[] }>("/api/memory?id=all", { method: "DELETE" });
      setMemories(data.memories);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const clearConversations = async () => {
    if (!confirm("Delete ALL your conversations? This cannot be undone.")) return;
    try {
      await api("/api/settings?target=conversations", { method: "DELETE" });
      emit("conversations-changed");
      router.push("/");
    } catch (e: any) {
      setError(e.message);
    }
  };

  const deleteEverything = async () => {
    if (!confirm("Delete ALL your data — conversations, quizzes, flashcards, progress, memory, and settings?")) return;
    if (!confirm("Are you absolutely sure? There is no way to recover this data.")) return;
    try {
      await api("/api/settings?target=everything", { method: "DELETE" });
      emit("conversations-changed");
      router.push("/");
    } catch (e: any) {
      setError(e.message);
    }
  };

  if (error && !settings)
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <ErrorBanner message={error} onRetry={() => location.reload()} />
      </div>
    );
  if (!settings || !ai) return <Spinner label="Loading settings…" />;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8">
      <PageHeader
        title="Settings"
        subtitle="Personalize how your tutor teaches and manage your data."
        action={savedFlash ? <span className="inline-flex items-center gap-1 text-sm text-green-600"><Check size={15} /> Saved</span> : undefined}
      />
      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}

      <div className="space-y-6">
        {/* Appearance */}
        <section className="rounded-2xl border border-line bg-surface-raised p-6 shadow-sm">
          <h2 className="text-sm font-semibold">Appearance</h2>
          <div className="mt-4 flex gap-2" role="radiogroup" aria-label="Theme">
            {(
              [
                ["light", "Light", Sun],
                ["dark", "Dark", Moon],
                ["system", "System", Monitor],
              ] as const
            ).map(([value, label, Icon]) => (
              <button
                key={value}
                role="radio"
                aria-checked={settings.theme === value}
                onClick={() => save({ theme: value })}
                className={`flex flex-1 flex-col items-center gap-1.5 rounded-xl border px-3 py-3 text-sm transition ${
                  settings.theme === value
                    ? "border-accent bg-accent-soft font-medium text-accent"
                    : "border-line text-ink-muted hover:bg-surface-sunken"
                }`}
              >
                <Icon size={17} /> {label}
              </button>
            ))}
          </div>
        </section>

        {/* Learning preferences */}
        <section className="rounded-2xl border border-line bg-surface-raised p-6 shadow-sm">
          <h2 className="text-sm font-semibold">Learning preferences</h2>
          <div className="mt-4 space-y-4">
            <Field label="Student level" hint="Helps the tutor pitch explanations at the right depth.">
              <select value={settings.level} onChange={(e) => save({ level: e.target.value })} className={inputCls}>
                <option value="">Let the tutor adapt automatically</option>
                {["Elementary school", "Middle school", "High school", "College", "Adult learner"].map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Preferred response length">
              <div className="flex gap-2" role="radiogroup" aria-label="Response length">
                {(["concise", "balanced", "detailed"] as const).map((len) => (
                  <button
                    key={len}
                    role="radio"
                    aria-checked={settings.response_length === len}
                    onClick={() => save({ response_length: len })}
                    className={`flex-1 rounded-xl border px-3 py-2.5 text-sm capitalize transition ${
                      settings.response_length === len
                        ? "border-accent bg-accent-soft font-medium text-accent"
                        : "border-line text-ink-muted hover:bg-surface-sunken"
                    }`}
                  >
                    {len}
                  </button>
                ))}
              </div>
            </Field>
          </div>
        </section>

        {/* AI configuration */}
        <section className="rounded-2xl border border-line bg-surface-raised p-6 shadow-sm">
          <h2 className="text-sm font-semibold">AI model</h2>
          <div className="mt-3 flex items-center gap-2 text-sm">
            <span
              className={`inline-block h-2 w-2 rounded-full ${ai.configured ? "bg-green-500" : "bg-red-500"}`}
              aria-hidden
            />
            <span className="text-ink-muted">
              Provider: <span className="font-medium text-ink">{ai.provider}</span> —{" "}
              {ai.configured ? "connected" : "no API key configured"}
            </span>
          </div>
          {!ai.configured && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              Add <code className="font-mono">ANTHROPIC_API_KEY</code> to your <code className="font-mono">.env</code> file
              (see .env.example) and restart the server. Keys are only ever read on the server.
            </p>
          )}
          <div className="mt-4">
            <Field label="Model override" hint={`Leave blank to use the server default (${ai.defaultModel}).`}>
              <input
                value={settings.model}
                onChange={(e) => setSettings({ ...settings, model: e.target.value })}
                onBlur={(e) => save({ model: e.target.value.trim() })}
                placeholder={ai.defaultModel}
                className={inputCls}
              />
            </Field>
          </div>
        </section>

        {/* Memory */}
        <section className="rounded-2xl border border-line bg-surface-raised p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">
              <Brain size={15} className="text-accent" /> Tutor memory
            </h2>
            {memories.length > 0 && (
              <button onClick={clearMemory} className="text-xs font-medium text-red-500 hover:underline">
                Clear all
              </button>
            )}
          </div>
          <p className="mt-1 text-xs text-ink-muted">
            Educational facts the tutor has saved to personalize your sessions. You&apos;re in control — delete anything.
          </p>
          {memories.length === 0 ? (
            <p className="mt-4 rounded-lg bg-surface-sunken px-3 py-3 text-center text-sm text-ink-faint">
              Nothing saved yet. Memory builds up as you chat with the tutor.
            </p>
          ) : (
            <ul className="mt-4 space-y-1.5">
              {memories.map((m) => (
                <li key={m.id} className="flex items-start justify-between gap-2 rounded-lg bg-surface-sunken px-3 py-2 text-sm">
                  <span className="min-w-0">{m.content}</span>
                  <button
                    onClick={() => deleteMemory(m.id)}
                    aria-label="Delete this memory"
                    className="shrink-0 rounded p-1 text-ink-faint transition hover:text-red-500"
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Danger zone */}
        <section className="rounded-2xl border border-red-300/40 bg-surface-raised p-6 shadow-sm dark:border-red-500/30">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-red-600 dark:text-red-400">
            <AlertTriangle size={15} /> Danger zone
          </h2>
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-medium">Clear all conversations</div>
                <div className="text-xs text-ink-muted">Deletes every chat and study session.</div>
              </div>
              <Button variant="secondary" onClick={clearConversations}>
                Clear conversations
              </Button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
              <div>
                <div className="text-sm font-medium">Delete all my data</div>
                <div className="text-xs text-ink-muted">Conversations, quizzes, flashcards, progress, memory, settings.</div>
              </div>
              <Button variant="danger" onClick={deleteEverything}>
                Delete everything
              </Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
