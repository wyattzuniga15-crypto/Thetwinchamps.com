"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BookOpen,
  Bot,
  Check,
  GraduationCap,
  Home,
  Layers,
  ListChecks,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Settings,
  Trash2,
  TrendingUp,
  X,
} from "lucide-react";
import { api, emit, subscribe } from "@/lib/client";

interface Convo {
  id: string;
  title: string;
  kind: string;
  updated_at: number;
}

const NAV = [
  { href: "/", label: "Home", icon: Home },
  { href: "/tutor", label: "AI Tutor", icon: Bot },
  { href: "/subjects", label: "Subjects", icon: BookOpen },
  { href: "/study", label: "Study Mode", icon: GraduationCap },
  { href: "/quiz", label: "Quiz", icon: ListChecks },
  { href: "/flashcards", label: "Flashcards", icon: Layers },
  { href: "/progress", label: "Progress", icon: TrendingUp },
];

export default function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const [convos, setConvos] = useState<Convo[]>([]);
  const [query, setQuery] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (q?: string) => {
    try {
      const data = await api<{ conversations: Convo[] }>(
        `/api/conversations${q ? `?q=${encodeURIComponent(q)}` : ""}`
      );
      setConvos(data.conversations);
    } catch {
      /* sidebar list is non-critical; leave as-is */
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
    return subscribe("conversations-changed", () => load());
  }, [load]);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => load(query || undefined), 250);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query, load]);

  const newChat = async () => {
    try {
      const data = await api<{ conversation: Convo }>("/api/conversations", {
        method: "POST",
        body: JSON.stringify({}),
      });
      emit("conversations-changed");
      onNavigate?.();
      router.push(`/tutor/${data.conversation.id}`);
    } catch {
      router.push("/tutor");
    }
  };

  const doRename = async (id: string) => {
    const title = renameValue.trim();
    setRenaming(null);
    if (!title) return;
    setConvos((c) => c.map((x) => (x.id === id ? { ...x, title } : x)));
    try {
      await api(`/api/conversations/${id}`, { method: "PATCH", body: JSON.stringify({ title }) });
    } finally {
      emit("conversations-changed");
    }
  };

  const doDelete = async (id: string) => {
    if (!confirm("Delete this chat? This cannot be undone.")) return;
    setConvos((c) => c.filter((x) => x.id !== id));
    setMenuFor(null);
    try {
      await api(`/api/conversations/${id}`, { method: "DELETE" });
    } finally {
      emit("conversations-changed");
      if (pathname === `/tutor/${id}`) router.push("/tutor");
    }
  };

  return (
    <nav className="flex h-full w-full flex-col" aria-label="Main navigation">
      <div className="px-4 pb-2 pt-5">
        <Link href="/" onClick={onNavigate} className="flex items-center gap-2.5 px-1">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-accent text-accent-ink">
            <GraduationCap size={18} />
          </span>
          <span className="text-[15px] font-semibold tracking-tight">AI Education Tutor</span>
        </Link>
      </div>

      <div className="px-3 pt-2">
        <button
          onClick={newChat}
          className="flex w-full items-center gap-2 rounded-xl bg-accent px-3.5 py-2.5 text-sm font-medium text-accent-ink shadow-sm transition hover:opacity-90"
        >
          <Plus size={16} /> New chat
        </button>
      </div>

      <ul className="mt-4 space-y-0.5 px-3">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                  active
                    ? "bg-accent-soft font-medium text-accent"
                    : "text-ink-muted hover:bg-surface-sunken hover:text-ink"
                }`}
              >
                <Icon size={16} /> {label}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="mt-5 flex min-h-0 flex-1 flex-col border-t border-line pt-4">
        <div className="flex items-center justify-between px-5 pb-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">History</h2>
        </div>
        <div className="px-3 pb-2">
          <label className="relative block">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search chats"
              aria-label="Search chats"
              className="w-full rounded-lg border border-line bg-surface-raised py-1.5 pl-8 pr-7 text-sm placeholder:text-ink-faint focus:border-accent focus:outline-none"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink"
              >
                <X size={13} />
              </button>
            )}
          </label>
        </div>

        <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
          {loaded && convos.length === 0 && (
            <li className="px-3 py-6 text-center text-xs text-ink-faint">
              {query ? "No chats match your search." : "No chats yet — start one!"}
            </li>
          )}
          {convos.map((c) => {
            const active = pathname === `/tutor/${c.id}`;
            return (
              <li key={c.id} className="group relative">
                {renaming === c.id ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      doRename(c.id);
                    }}
                    className="flex items-center gap-1 px-1"
                  >
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => doRename(c.id)}
                      onKeyDown={(e) => e.key === "Escape" && setRenaming(null)}
                      aria-label="Rename chat"
                      className="w-full rounded-lg border border-accent bg-surface-raised px-2 py-1.5 text-sm focus:outline-none"
                    />
                    <button type="submit" aria-label="Save name" className="rounded p-1.5 text-accent hover:bg-surface-sunken">
                      <Check size={14} />
                    </button>
                  </form>
                ) : (
                  <div
                    className={`flex items-center rounded-lg transition ${
                      active ? "bg-surface-sunken" : "hover:bg-surface-sunken"
                    }`}
                  >
                    <Link
                      href={`/tutor/${c.id}`}
                      onClick={onNavigate}
                      className={`flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2 text-sm ${
                        active ? "font-medium text-ink" : "text-ink-muted"
                      }`}
                    >
                      {c.kind === "study" ? (
                        <GraduationCap size={14} className="shrink-0 text-ink-faint" />
                      ) : (
                        <MessageSquare size={14} className="shrink-0 text-ink-faint" />
                      )}
                      <span className="truncate">{c.title}</span>
                    </Link>
                    <button
                      onClick={() => setMenuFor(menuFor === c.id ? null : c.id)}
                      aria-label={`Options for ${c.title}`}
                      aria-expanded={menuFor === c.id}
                      className={`mr-1 rounded p-1.5 text-ink-faint hover:text-ink ${
                        menuFor === c.id ? "" : "opacity-0 group-hover:opacity-100 focus:opacity-100"
                      }`}
                    >
                      <MoreHorizontal size={15} />
                    </button>
                  </div>
                )}
                {menuFor === c.id && (
                  <div className="absolute right-0 top-9 z-20 w-40 overflow-hidden rounded-xl border border-line bg-surface-raised shadow-lg animate-fade-up">
                    <button
                      onClick={() => {
                        setRenaming(c.id);
                        setRenameValue(c.title);
                        setMenuFor(null);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-sm text-ink-muted hover:bg-surface-sunken"
                    >
                      <Pencil size={13} /> Rename
                    </button>
                    <button
                      onClick={() => doDelete(c.id)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-surface-sunken"
                    >
                      <Trash2 size={13} /> Delete
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="border-t border-line p-3">
        <Link
          href="/settings"
          onClick={onNavigate}
          aria-current={pathname.startsWith("/settings") ? "page" : undefined}
          className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
            pathname.startsWith("/settings")
              ? "bg-accent-soft font-medium text-accent"
              : "text-ink-muted hover:bg-surface-sunken hover:text-ink"
          }`}
        >
          <Settings size={16} /> Settings
        </Link>
      </div>
    </nav>
  );
}
