"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Bot,
  Check,
  Copy,
  FileText,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  RefreshCw,
  Square,
  X,
} from "lucide-react";
import Markdown from "@/components/Markdown";
import { ErrorBanner, Spinner } from "@/components/ui";
import { api, emit, formatTime } from "@/lib/client";

interface Attachment {
  name: string;
  kind: "pdf" | "docx" | "text" | "image";
  text?: string;
  imageId?: string;
  mediaType?: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: number;
  attachments?: Attachment[];
}

interface Props {
  conversationId: string;
  suggestions?: string[];
  emptyTitle?: string;
  emptyBody?: string;
}

const AUTOSEND_PREFIX = "tutor-autosend-";

export default function ChatView({ conversationId, suggestions, emptyTitle, emptyBody }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamingRef = useRef(false);

  const parseMessage = (m: any): ChatMessage => {
    let attachments: Attachment[] | undefined;
    try {
      attachments = JSON.parse(m.meta || "{}")?.attachments;
    } catch {
      attachments = undefined;
    }
    return { id: m.id, role: m.role, content: m.content, created_at: m.created_at, attachments };
  };

  // Load history.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    api<{ messages: any[] }>(`/api/conversations/${conversationId}`)
      .then((data) => {
        if (cancelled) return;
        setMessages(data.messages.map(parseMessage));
        setLoading(false);
        // Auto-send a pending prompt handed off from another page (Subjects / Study Mode).
        const pending = sessionStorage.getItem(AUTOSEND_PREFIX + conversationId);
        if (pending && data.messages.length === 0) {
          sessionStorage.removeItem(AUTOSEND_PREFIX + conversationId);
          void send(pending, []);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err.message || "Could not load this conversation.");
        setLoading(false);
      });
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // Scroll handling: stick to bottom unless the user scrolled up.
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  useEffect(() => {
    if (stickToBottom.current) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }
  }, [messages, streamText]);

  const resizeTextarea = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  };

  const runStream = useCallback(
    async (body: object) => {
      setChatError(null);
      setStreaming(true);
      streamingRef.current = true;
      setStreamText("");
      const controller = new AbortController();
      abortRef.current = controller;
      let acc = "";
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const data = await res.json().catch(() => ({}));
          throw new Error((data as any)?.error || `The tutor could not respond (${res.status}).`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let done = false;
        while (!done) {
          const chunk = await reader.read();
          done = chunk.done;
          if (chunk.value) buffer += decoder.decode(chunk.value, { stream: true });
          const lines = buffer.split("\n");
          buffer = done ? "" : lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            let event: any;
            try {
              event = JSON.parse(line.slice(5).trim());
            } catch {
              continue;
            }
            if (event.type === "delta") {
              acc += event.text;
              setStreamText(acc);
            } else if (event.type === "done") {
              acc = event.content || acc;
            } else if (event.type === "error") {
              throw new Error(event.message);
            }
          }
        }
        if (acc.trim()) {
          setMessages((m) => [
            ...m,
            { id: `local-${Date.now()}`, role: "assistant", content: acc, created_at: Date.now() },
          ]);
        }
        emit("conversations-changed"); // title may have updated
      } catch (err: any) {
        if (err?.name === "AbortError") {
          // Stopped by the user — keep the partial text as a message.
          if (acc.trim()) {
            setMessages((m) => [
              ...m,
              { id: `local-${Date.now()}`, role: "assistant", content: acc, created_at: Date.now() },
            ]);
          }
        } else {
          setChatError(err?.message || "Something went wrong. Please try again.");
        }
      } finally {
        setStreaming(false);
        streamingRef.current = false;
        setStreamText("");
        abortRef.current = null;
      }
    },
    []
  );

  const send = useCallback(
    async (text: string, atts: Attachment[]) => {
      const trimmed = text.trim();
      if ((!trimmed && atts.length === 0) || streamingRef.current) return;
      setMessages((m) => [
        ...m,
        {
          id: `local-u-${Date.now()}`,
          role: "user",
          content: trimmed,
          created_at: Date.now(),
          attachments: atts.length ? atts : undefined,
        },
      ]);
      setInput("");
      setAttachments([]);
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      stickToBottom.current = true;
      await runStream({ conversationId, message: trimmed, attachments: atts });
    },
    [conversationId, runStream]
  );

  const regenerate = useCallback(async () => {
    if (streamingRef.current) return;
    setMessages((m) => {
      const copy = [...m];
      while (copy.length && copy[copy.length - 1].role === "assistant") copy.pop();
      return copy;
    });
    stickToBottom.current = true;
    await runStream({ conversationId, regenerate: true });
  }, [conversationId, runStream]);

  const stop = () => abortRef.current?.abort();

  const onPickFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setChatError(null);
    setUploading(true);
    try {
      for (const file of Array.from(files).slice(0, 3)) {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: form });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((data as any)?.error || "Upload failed.");
        setAttachments((a) => [...a, (data as any).attachment]);
      }
    } catch (err: any) {
      setChatError(err?.message || "Upload failed.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const copyMessage = async (id: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const lastAssistantIdx = messages.map((m) => m.role).lastIndexOf("assistant");
  const empty = !loading && messages.length === 0 && !streaming;

  if (loading) return <Spinner label="Loading conversation…" />;
  if (loadError)
    return (
      <div className="mx-auto max-w-chat px-4 py-8">
        <ErrorBanner message={loadError} onRetry={() => location.reload()} />
      </div>
    );

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto" aria-live="polite">
        <div className="mx-auto max-w-chat px-4 py-6">
          {empty && (
            <div className="flex flex-col items-center pt-16 text-center">
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft text-accent">
                <Bot size={26} />
              </span>
              <h2 className="mt-4 text-xl font-semibold">{emptyTitle || "What would you like to learn?"}</h2>
              <p className="mt-1 max-w-md text-sm text-ink-muted">
                {emptyBody ||
                  "Ask me anything — math problems, essay feedback, science concepts, history questions, or a language you're learning."}
              </p>
              {suggestions && suggestions.length > 0 && (
                <div className="mt-6 grid w-full gap-2 sm:grid-cols-2">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s, [])}
                      className="rounded-xl border border-line bg-surface-raised px-4 py-3 text-left text-sm text-ink-muted transition hover:border-accent/40 hover:text-ink"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <ol className="space-y-6">
            {messages.map((m, i) => (
              <li key={m.id} className="animate-fade-up">
                {m.role === "user" ? (
                  <div className="flex justify-end">
                    <div className="max-w-[85%]">
                      {m.attachments && m.attachments.length > 0 && (
                        <div className="mb-1.5 flex flex-wrap justify-end gap-1.5">
                          {m.attachments.map((a, j) => (
                            <span
                              key={j}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-raised px-2.5 py-1 text-xs text-ink-muted"
                            >
                              {a.kind === "image" ? <ImageIcon size={12} /> : <FileText size={12} />}
                              <span className="max-w-[160px] truncate">{a.name}</span>
                            </span>
                          ))}
                        </div>
                      )}
                      {m.content && (
                        <div className="rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-[15px] leading-7 text-accent-ink whitespace-pre-wrap break-words">
                          {m.content}
                        </div>
                      )}
                      <div className="mt-1 text-right text-[11px] text-ink-faint">{formatTime(m.created_at)}</div>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-3">
                    <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
                      <Bot size={15} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <Markdown text={m.content} />
                      <div className="mt-2 flex items-center gap-1 text-ink-faint">
                        <span className="text-[11px]">{formatTime(m.created_at)}</span>
                        <button
                          onClick={() => copyMessage(m.id, m.content)}
                          aria-label="Copy response"
                          className="ml-2 rounded p-1 hover:bg-surface-sunken hover:text-ink"
                        >
                          {copiedId === m.id ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
                        </button>
                        {i === lastAssistantIdx && !streaming && (
                          <button
                            onClick={regenerate}
                            aria-label="Regenerate response"
                            className="rounded p-1 hover:bg-surface-sunken hover:text-ink"
                          >
                            <RefreshCw size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </li>
            ))}

            {streaming && (
              <li className="flex gap-3 animate-fade-up">
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
                  <Bot size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  {streamText ? (
                    <div className="stream-caret">
                      <Markdown text={streamText} />
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 py-1 text-sm text-ink-muted">
                      <Loader2 size={14} className="animate-spin" /> Thinking…
                    </div>
                  )}
                </div>
              </li>
            )}
          </ol>

          {chatError && (
            <div className="mt-4">
              <ErrorBanner
                message={chatError}
                onRetry={
                  messages.length > 0 && messages[messages.length - 1].role === "user"
                    ? () => runStream({ conversationId, regenerate: true })
                    : undefined
                }
              />
            </div>
          )}
        </div>
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-line bg-surface px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3">
        <div className="mx-auto max-w-chat">
          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {attachments.map((a, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-raised px-2.5 py-1.5 text-xs"
                >
                  {a.kind === "image" ? <ImageIcon size={13} /> : <FileText size={13} />}
                  <span className="max-w-[180px] truncate">{a.name}</span>
                  <button
                    onClick={() => setAttachments((list) => list.filter((_, j) => j !== i))}
                    aria-label={`Remove ${a.name}`}
                    className="text-ink-faint hover:text-ink"
                  >
                    <X size={13} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input, attachments);
            }}
            className="flex items-end gap-2 rounded-2xl border border-line bg-surface-raised p-2 shadow-sm focus-within:border-accent"
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.docx,.txt,.md,.csv,.png,.jpg,.jpeg,.webp,.gif"
              className="hidden"
              onChange={(e) => onPickFiles(e.target.files)}
              aria-label="Attach files"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || streaming}
              aria-label="Attach a file (PDF, DOCX, TXT, or image)"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-ink-muted transition hover:bg-surface-sunken hover:text-ink disabled:opacity-40"
            >
              {uploading ? <Loader2 size={17} className="animate-spin" /> : <Paperclip size={17} />}
            </button>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                resizeTextarea();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input, attachments);
                }
              }}
              rows={1}
              placeholder="Ask your tutor anything…"
              aria-label="Message the tutor"
              className="max-h-[200px] min-h-[36px] flex-1 resize-none bg-transparent px-1 py-1.5 text-[15px] placeholder:text-ink-faint focus:outline-none"
            />
            {streaming ? (
              <button
                type="button"
                onClick={stop}
                aria-label="Stop generating"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ink text-surface transition hover:opacity-80"
              >
                <Square size={14} fill="currentColor" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim() && attachments.length === 0}
                aria-label="Send message"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent text-accent-ink transition hover:opacity-90 disabled:opacity-30"
              >
                <ArrowUp size={17} />
              </button>
            )}
          </form>
          <p className="mt-1.5 text-center text-[11px] text-ink-faint">
            The tutor can make mistakes — double-check important work.
          </p>
        </div>
      </div>
    </div>
  );
}
