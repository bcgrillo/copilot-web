"use client";

import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import {
  Bot,
  Check,
  ChevronDown,
  Copy,
  Loader2,
  Menu,
  Paperclip,
  Pencil,
  SendHorizontal,
  Square,
  User,
  X,
} from "lucide-react";
import { apiUrl, authFetch } from "@/lib/api";
import { useT, useLang, localeOf } from "@/lib/i18n";
import type { PendingAsk } from "@/lib/helperAsk";
import { MAX_FILES, MAX_FILE_BYTES } from "@/lib/limits";
import type {
  Attachment,
  AvailableCommand,
  ChatMessage,
  LiveTurn,
  MessagePart,
  PermissionOption,
  PermissionReq,
  SessionSummary,
  ToolStep,
} from "@/lib/types";
import Logo from "@/components/Logo";

type Props = {
  session: (SessionSummary & { messages?: ChatMessage[] }) | null;
  /** GET hydration in flight: spinner in the chat area instead of the
   * "empty session" (avoids the landing flash when opening a session) */
  loading?: boolean;
  running: boolean;
  liveTurn?: LiveTurn;
  error: string | null;
  commands?: AvailableCommand[]; // paleta de comandos slash del agente
  stickyPermission?: PermissionReq | null; // permiso de turno anterior re-mostrado
  onSend: (text: string, attachments?: Attachment[]) => void;
  onMenu?: () => void; // abre el drawer de sesiones (mobile)
  // nonce that rises on every new session: moves focus to the composer
  focusNonce?: number;
  /** renames the active session (header pencil / tapping the title) */
  onRename?: (id: string, name: string) => void;
  onAbort?: () => void; // aborts the in-flight SSE stream (recovery)
  onPermission?: (reqId: number, allow: boolean, optionId?: string) => void; // responde card de permiso
};

/** Label for a permission option: by kind from i18n (allow_once →
 * "Allow once"…), falling back to the agent name/raw kind. */
function permOptionLabel(o: PermissionOption, t: (k: string) => string): string {
  if (o.kind === "allow_once") return t("chat.permAllowOnce");
  if (o.kind === "allow_always") return t("chat.permAllowAlways");
  if (o.kind === "reject_once") return t("chat.permRejectOnce");
  if (o.kind === "reject_always") return t("chat.permRejectAlways");
  return o.name ?? o.kind;
}

/** Chips de comando/herramienta: bloque tipo terminal (no burbuja de chat). */
function ToolChips({ tools }: { tools: ToolStep[] }) {
  if (!tools.length) return null;
  return (
    <div className="min-w-0 space-y-1.5">
      {tools.map((t, i) => {
        const cmdLine = t.detail?.startsWith("$ ")
          ? t.detail.slice(2).split("\n")[0]
          : undefined;
        const body = cmdLine
          ? t.detail!.replace(/^[^\n]*(\n|$)/, "").trim()
          : t.detail;
        return (
          <details
            key={t.id ?? i}
            className="group/chip overflow-hidden rounded-lg border border-border bg-muted/40"
          >
            <summary className="flex min-h-[28px] cursor-pointer list-none items-center gap-2 px-2.5 py-1 font-mono text-[11px] text-foreground/90 [&::-webkit-details-marker]:hidden hover:bg-muted">
              {t.status === "completed" ? (
                <Check className="h-3 w-3 shrink-0 text-emerald-500" />
              ) : t.status === "error" || t.status === "failed" ? (
                <X className="h-3 w-3 shrink-0 text-red-500" />
              ) : (
                <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-amber-400" />
              )}
              {cmdLine ? (
                <span className="truncate">
                  <span className="text-emerald">$</span> {cmdLine}
                </span>
              ) : (
                <span className="truncate">{t.title}</span>
              )}
              {body && (
                <ChevronDown className="ml-auto h-3 w-3 shrink-0 text-muted-foreground transition-transform group-open/chip:rotate-180" />
              )}
            </summary>
            {body && (
              <pre className="max-h-44 overflow-auto whitespace-pre-wrap border-t border-border bg-background/40 px-2.5 py-1.5 font-mono text-[10.5px] leading-relaxed text-muted-foreground">
                {body}
              </pre>
            )}
          </details>
        );
      })}
    </div>
  );
}

const SUGGESTION_KEYS = ["chat.sug1", "chat.sug2", "chat.sug3"];

/** Card para una pregunta del MCP helper (tool ask_user): opciones en vertical
 * + a free-text input ALWAYS visible (sending is enabled while typing). */
function HelperAskCard({
  ask,
  onAnswer,
}: {
  ask: PendingAsk;
  onAnswer: (id: string, answer: string) => void;
}) {
  const t = useT();
  const [val, setVal] = useState("");
  const hasOptions = ask.kind === "choice" && ask.options.length > 0;
  return (
    <div className="rounded-xl border border-sky-500/40 bg-sky-500/10 px-4 py-3">
      <p className="text-xs font-medium text-foreground">
        {t("chat.helperAskTitle")}
      </p>
      <p className="whitespace-pre-wrap text-sm text-foreground">
        {ask.question}
      </p>
      <p className="mb-2 text-[10px] text-muted-foreground/80">
        {t("chat.helperAskHint")}
      </p>
      {hasOptions && (
        <div className="mb-2 flex flex-col items-stretch gap-2">
          {ask.options.map((o) => (
            <button
              key={o}
              onClick={() => onAnswer(ask.id, o)}
              className="rounded-lg border border-emerald bg-transparent px-3 py-1.5 text-left text-xs font-medium text-foreground transition-colors hover:bg-emerald/10"
            >
              {o}
            </button>
          ))}
        </div>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (val.trim()) onAnswer(ask.id, val.trim());
        }}
      >
        <input
          autoFocus
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder={t("chat.helperAskPlaceholder")}
          className="min-w-0 flex-1 rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        <button
          type="submit"
          disabled={!val.trim()}
          className="shrink-0 rounded-lg bg-emerald px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {t("chat.send")}
        </button>
      </form>
    </div>
  );
}


const CHAT_CHUNK = 40; // mensajes visibles al cargar + por cada "cargar anteriores"

async function fileToAttachment(file: File): Promise<Attachment> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return { name: file.name, content: btoa(binary) };
}

function formatTs(ts: string, locale = "es-ES"): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (sameDay) return time;
  return `${d.toLocaleDateString(locale, { day: "numeric", month: "short" })} ${time}`;
}

const DRAFTS_KEY = "copilot-web.drafts";

export default function Chat({
  session,
  running,
  loading,
  liveTurn,
  error,
  onSend,
  onMenu,
  focusNonce,
  onRename,
  onAbort,
  onPermission,
  stickyPermission,
  commands,
}: Props) {
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // renaming the active session from the header: pencil (desktop) or
  // tapping the title (mobile, no room for another button)
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  const renameRef = useRef<HTMLInputElement>(null);
  const startRename = () => {
    if (!session) return;
    setDraft(session.name);
    setRenaming(true);
    requestAnimationFrame(() => {
      renameRef.current?.focus();
      renameRef.current?.select();
    });
  };
  const commitRename = () => {
    setRenaming(false);
    const next = draft.trim();
    if (session && next && next !== session.name) onRename?.(session.id, next);
  };
  // refs to the bottom area (decision cards + composer + status-bar) for
  // el ResizeObserver del "keep at bottom"
  const bottomRef = useRef<HTMLDivElement>(null);
  const permWrapRef = useRef<HTMLDivElement>(null);
  const helperWrapRef = useRef<HTMLDivElement>(null);
  // the user is "pinned to the bottom" if the view is within 100px of the
  // end: layout growth must not cover the last line
  const pinnedRef = useRef(true);
  const markPinned = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
  };
  // estado de trabajo (cwd + rama git + modelo declarado) para el status-bar
  const [wstatus, setWstatus] = useState<{
    cwd?: string;
    branch?: string | null;
    model?: string | null;
  } | null>(null);

  // per-session draft in the browser: switching sessions restores what
  // was typed (not CLI data, just local UI state, like the language)
  useEffect(() => {
    let d: Record<string, string> = {};
    try { d = JSON.parse(localStorage.getItem(DRAFTS_KEY) || "{}"); } catch {}
    setInput((session?.id && d[session.id]) || "");
  }, [session?.id]);
  const saveDraft = (id: string | null | undefined, text: string) => {
    if (!id) return;
    let d: Record<string, string> = {};
    try { d = JSON.parse(localStorage.getItem(DRAFTS_KEY) || "{}"); } catch {}
    if (text) d[id] = text;
    else delete d[id];
    try { localStorage.setItem(DRAFTS_KEY, JSON.stringify(d)); } catch {}
  };

  useEffect(() => {
    let live = true;
    setWstatus(null);
    const load = async () => {
      if (!session?.id) return;
      try {
        const r = await authFetch(apiUrl(`/api/status/${session.id}`));
        if (r.ok) {
          const d = await r.json();
          if (live) setWstatus(d);
        }
      } catch {
        /* no state: the bar renders empty */
      }
    };
    // la rama puede cambiar sin que la web se entere: sondeo + refresco al foco
    load();
    const iv = setInterval(load, 15000);
    window.addEventListener("focus", load);
    return () => {
      live = false;
      clearInterval(iv);
      window.removeEventListener("focus", load);
    };
  }, [session?.id]);

  // paleta de slash: activa mientras se teclea el primer token "/cmd" (sin
  // espacio). Esc la oculta hasta que cambie el token.
  const [slashSel, setSlashSel] = useState(0);
  const [slashHidden, setSlashHidden] = useState<string | null>(null);
  const isCmdToken = input.startsWith("/") && !input.includes(" ");
  // cards de permiso en vivo (turno en curso) o "sticky" (permiso de un turno
  // earlier turn whose stream died: never self-authorized, it is re-shown).
  // In the zombie-turn polling (running with no live permissions) the
  // sticky also shows: the permission is still pending in the daemon.
  const permCards: PermissionReq[] = running
    ? liveTurn?.permissions?.length
      ? liveTurn.permissions
      : stickyPermission
        ? [stickyPermission]
        : []
    : stickyPermission
      ? [stickyPermission]
      : [];
  // MCP helper questions (tool ask_user): shown while the session has a
  // turn in progress (v0, design in docs/mcp-helper.md)
  const [helperAsks, setHelperAsks] = useState<PendingAsk[]>([]);
  // a decision is pending (permissions / ask_user): the cards take the
  // composer width and the composer stays hidden until resolved
  const cardsActive = permCards.length > 0 || helperAsks.length > 0;
  useEffect(() => {
    if (!running) {
      setHelperAsks([]);
      return;
    }
    let live = true;
    const load = async () => {
      try {
        const r = await authFetch(apiUrl("/api/helper/ask"));
        if (r.ok) {
          const d = await r.json();
          if (live) setHelperAsks(d.asks ?? []);
        }
      } catch {
        /* silencio */
      }
    };
    load();
    const iv = setInterval(load, 1500);
    return () => {
      live = false;
      clearInterval(iv);
    };
  }, [running]);
  const answerHelper = async (id: string, answer: string) => {
    setHelperAsks((as) => as.filter((a) => a.id !== id));
    try {
      await authFetch(apiUrl(`/api/helper/answer/${id}`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer }),
      });
    } catch {
      /* the card was already removed; the helper expires on its own */
    }
  };
  const slashMatches = isCmdToken
    ? (commands ?? []).filter((c) =>
c.name.toLowerCase().startsWith(input.slice(1).toLowerCase())
      )
    : [];
  const slashOpen =
    isCmdToken &&
    !running &&
    !!session &&
    input !== slashHidden &&
    slashMatches.length > 0;

  useEffect(() => setSlashSel(0), [input]);

  // al rehabilitarse el textarea (fin del turno) recupera el foco
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running && session) inputRef.current?.focus();
    wasRunning.current = running;
  }, [running, session]);

  // new session: composer ready to type right away
  useEffect(() => {
    if (focusNonce) inputRef.current?.focus();
  }, [focusNonce]);

  function completeCommand(c: AvailableCommand) {
    setInput(`/${c.name} `);
    saveDraft(session?.id, `/${c.name} `);
    inputRef.current?.focus();
  }

  const msgs = session?.messages ?? [];
  const lastLen = msgs[msgs.length - 1]?.content.length ?? 0;
  const liveLen = liveTurn
    ? liveTurn.reasoning.length +
      liveTurn.parts.reduce(
        (n, p) =>
          n + (p.kind === "text" || p.kind === "reasoning" ? p.content.length : 0),
        0
      )
    : 0;

  const activeId = session?.id ?? null;
  const hasMsgs = msgs.length > 0;

  // render window: only the last N messages; "load older" grows it
  const [visibleCount, setVisibleCount] = useState(CHAT_CHUNK);
  const start = Math.max(0, msgs.length - visibleCount);
  const visibleMsgs = msgs.slice(start);
  const hiddenCount = start;

  // keeps the visual position when older messages are inserted above
  const pendingAdjustRef = useRef(0);

  // resets the window when the session changes
  useEffect(() => {
    setVisibleCount(CHAT_CHUNK);
    pendingAdjustRef.current = 0;
  }, [activeId]);

  // anti-flash: pins the scroll to the bottom BEFORE the first paint when
  // opening or hydrating a session; smooth scrolling only while streaming
  useLayoutEffect(() => {
    if (!activeId || !hasMsgs) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    pinnedRef.current = true;
  }, [activeId, hasMsgs]);

  // adjusts scrollTop by the height delta after inserting older ones (pre-paint)
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !pendingAdjustRef.current) return;
    el.scrollTop += el.scrollHeight - pendingAdjustRef.current;
    pendingAdjustRef.current = 0;
  }, [msgs.length, visibleCount]);

  function loadOlder() {
    const el = scrollRef.current;
    if (el) pendingAdjustRef.current = el.scrollHeight;
    setVisibleCount((c) => Math.min(msgs.length, c + CHAT_CHUNK));
  }

  useEffect(() => {
    if (!pinnedRef.current) return;
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [msgs.length, running, lastLen, liveLen]);

  // keep-at-bottom: if the user was at the bottom, any layout growth
  // (permission/ask_user cards, composer reappearing, viewport shrinking)
  // re-pins the scroll so the bottom stays visible
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const pin = () => {
      if (pinnedRef.current) el.scrollTo({ top: el.scrollHeight });
    };
    const ro = new ResizeObserver(pin);
    ro.observe(el);
    for (const node of [bottomRef.current, permWrapRef.current, helperWrapRef.current])
      if (node) ro.observe(node);
    return () => ro.disconnect();
  }, [cardsActive, permCards.length, helperAsks.length]);

  // back on the tab (notification click, or alt-tab): the smooth scroll may
  // have been cut in the background; if pinned to the bottom, re-affirm
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible" && pinnedRef.current) {
        const el = scrollRef.current;
        if (el) el.scrollTo({ top: el.scrollHeight });
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  async function submit() {
    const text = input.trim();
    if (!text || running || !session) return;
    const attachments =
      files.length ? await Promise.all(files.map(fileToAttachment)) : [];
    onSend(text, attachments.length ? attachments : undefined);
    setInput("");
    saveDraft(session.id, "");
    setFiles([]);
  }

  async function stop() {
    if (!session?.id) return;
    try {
      await authFetch(apiUrl("/api/cancel"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id }),
      });
    } catch {
      /* the abort on stream closure also cancels */
    }
    // si el agente no llega a responder al cancel, cortamos el stream: el
    // finally del send libera el UI (converge al re-hidratar)
    setTimeout(() => onAbort?.(), 1500);
  }

  const t = useT();
  return (
    <main className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-4 md:px-6 md:py-3.5">
        {/* mobile (sidebar hidden): app logo on the left
            (same size as the sidebar one so it does not jump on open) */}
        <div className="flex shrink-0 items-center md:hidden">
          <Logo className="h-8 w-8 text-emerald" />
        </div>
        <div className="min-w-0 flex-1">
          {renaming ? (
            <input
              ref={renameRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") setRenaming(false);
              }}
              className="w-full rounded-md border border-input bg-background px-1.5 py-0.5 text-sm font-semibold outline-none"
            />
          ) : (
            <>
              <div className="flex min-w-0 items-center gap-0.5">
                <h1
                  onClick={() => startRename()}
                  className={`min-w-0 truncate text-sm font-semibold leading-tight ${
                    session ? "cursor-text select-none" : ""
                  }`}
                >
                  {session?.name ?? t("chat.noSession")}
                </h1>
                {session && (
                  <button
                    onClick={startRename}
                    className="hidden h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-foreground/60 transition-colors hover:bg-muted hover:text-foreground focus-visible:text-foreground md:flex"
                    title={t("sidebar.rename")}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <p className="font-mono text-[10px] leading-tight text-muted-foreground">
                {session ? `#${session.id.slice(0, 8)}` : "—"}
              </p>
            </>
          )}
        </div>
        {running && (
          <span className="ml-auto flex shrink-0 items-center gap-2 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
            <span className="h-1.5 w-1.5 animate-ping rounded-full bg-emerald" />
            {t("chat.running")}
          </span>
        )}
        {/* sessions menu: on the right on mobile (h-8 = logo box,
            ambos iconos quedan a la misma altura y centrados) */}
        {onMenu && (
          <button
            onClick={onMenu}
            className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground md:hidden"
            title={t("chat.sessions")}
          >
            <Menu className="h-4 w-4" />
          </button>
        )}
      </header>

      <div
        ref={scrollRef}
        onScroll={markPinned}
        className="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6"
      >
        {loading && msgs.length === 0 ? (
          <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 pt-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-xs">{t("chat.loadingSession")}</span>
          </div>
        ) : !session || msgs.length === 0 ? (
          <MemoEmptyState running={running} cwd={wstatus?.cwd} onPick={onSend} />
        ) : (
          <div className="mx-auto max-w-3xl space-y-6">
            {hiddenCount > 0 && (
              <div className="flex flex-col items-center gap-1">
                <button
                  onClick={loadOlder}
                  className="rounded-full border border-border bg-card px-4 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {t("chat.loadOlder", { n: Math.min(hiddenCount, CHAT_CHUNK) })}
                </button>
                <span className="text-[10px] text-muted-foreground">
                  {t("chat.messagesCount", { a: visibleMsgs.length, b: msgs.length })}
                </span>
              </div>
            )}
            {(() => {
              // respuestas plegadas dentro del bloque del comando (no se
              // renderizan como burbuja propia)
              const folded = new Set<string>();
              for (let i = 0; i < visibleMsgs.length - 1; i++) {
                const m = visibleMsgs[i];
                const n = visibleMsgs[i + 1];
                if (
                  m.role === "user" &&
                  m.content.startsWith("/") &&
                  n.role === "assistant" &&
                  !n.parts?.some((p) => p.kind === "tool")
                )
                  folded.add(n.id);
              }
              return visibleMsgs.map((m, i) => {
                // la respuesta del comando ya vive dentro de su CommandBlock
                if (folded.has(m.id)) return null;
                if (m.role === "user") {
                  if (!m.content.startsWith("/"))
                    return <MemoUserBubble key={m.id} msg={m} />;
                  const next = visibleMsgs[i + 1];
                  const out =
                    next &&
                    next.role === "assistant" &&
                    folded.has(next.id)
                      ? next
                      : undefined;
                  return <MemoCommandBlock key={m.id} msg={m} out={out} />;
                }
                return <MemoAssistantMessage key={m.id} msg={m} />;
              });
            })()}
            {running && liveTurn && <MemoLiveBlock turn={liveTurn} />}
            {running && !liveTurn && (
              <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                <Avatar>
                  <Bot className="h-3.5 w-3.5" />
                </Avatar>
                <div className="flex gap-1 rounded-xl border border-border bg-secondary px-4 py-2.5">
                  <Dot delay="0ms" />
                  <Dot delay="150ms" />
                  <Dot delay="300ms" />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="mx-auto mb-2 max-w-3xl rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {permCards.length ? (
        <div ref={permWrapRef} className="mb-2 px-4 md:px-6">
          <div className="mx-auto max-w-3xl space-y-2">
          {permCards.map((p) => (
            <div
              key={p.reqId}
              className={
                p.options?.length
                  ? // con opciones del agente: frase arriba y botones debajo en
                    // one line (reject on the left, allow on the right)
                    "flex flex-col gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3"
                  : "flex flex-col gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              }
            >
              <div className="min-w-0">
                <p className="text-xs font-medium text-foreground">
                  {t("chat.permissionTitle")}
                </p>
                <p className="truncate font-mono text-[11px] text-muted-foreground">
                  {p.title}
                </p>
                <p className="text-[10px] text-muted-foreground/80">
                  {t("chat.permissionHint")}
                </p>
              </div>
              {p.options?.length ? (
                // opciones reales del agente: rechazar a la izquierda,
                // allow on the right, single full-width line
                <div className="flex w-full flex-wrap items-center gap-2">
                  <div className="flex flex-wrap gap-2">
                    {p.options
                      .filter((o) => o.kind?.startsWith("reject"))
                      .map((o) => (
                        <button
                          key={o.optionId}
                          onClick={() =>
                            onPermission?.(
                              p.reqId,
                              o.kind?.startsWith("allow"),
                              o.optionId
                            )
                          }
                          className="rounded-lg bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground transition-opacity hover:opacity-90"
                        >
                          {permOptionLabel(o, t)}
                        </button>
                      ))}
                  </div>
                  <div className="ml-auto flex flex-wrap gap-2">
                    {p.options
                      .filter((o) => o.kind?.startsWith("allow"))
                      .map((o) => (
                        <button
                          key={o.optionId}
                          onClick={() =>
                            onPermission?.(
                              p.reqId,
                              o.kind?.startsWith("allow"),
                              o.optionId
                            )
                          }
                          className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
                        >
                          {permOptionLabel(o, t)}
                        </button>
                      ))}
                  </div>
                </div>
              ) : (
                // fallback: options arrived empty/unknown → plain deny/allow
                <div className="flex shrink-0 gap-2">
                <button
                  onClick={() => onPermission?.(p.reqId, false)}
                  className="rounded-lg bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground transition-opacity hover:opacity-90"
                >
                  {t("chat.deny")}
                </button>
                <button
                  onClick={() => onPermission?.(p.reqId, true)}
                  className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
                >
                  {t("chat.allow")}
                </button>
                </div>
              )}
            </div>
          ))}
          </div>
        </div>
      ) : null}

      {helperAsks.length > 0 && (
        <div ref={helperWrapRef} className="mb-2 px-4 md:px-6">
          <div className="mx-auto max-w-3xl space-y-2">
            {helperAsks.map((a) => (
              <HelperAskCard key={a.id} ask={a} onAnswer={answerHelper} />
            ))}
          </div>
        </div>
      )}

      <div ref={bottomRef} className="px-4 pb-4 md:px-6 md:pb-6">
        <div className="mx-auto max-w-3xl">
          {!cardsActive && (
          <>
          {files.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {files.map((f, i) => (
                <span
                  key={`${f.name}-${i}`}
                  className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-[11px] text-muted-foreground"
                >
                  <Paperclip className="h-3 w-3" />
                  {f.name}
                  {!running && (
                    <button
                      onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                      className="hover:text-foreground"
                      title={t("chat.remove")}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}
          <div className="relative">
          {slashOpen && (
            <div className="absolute bottom-full left-0 right-0 z-20 mb-2 max-h-72 overflow-auto rounded-xl border border-border bg-popover p-1 shadow-lg">
              {slashMatches.map((c, i) => (
                <button
                  key={c.name}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    completeCommand(c);
                  }}
                  onMouseEnter={() => setSlashSel(i)}
                  className={`flex w-full items-baseline gap-2 rounded-lg px-3 py-1.5 text-left ${
                    i === slashSel ? "bg-muted" : ""
                  }`}
                >
                  <span className="font-mono text-[13px] text-foreground">
                    /{c.name}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                    {c.description ?? ""}
                    {c.input?.hint ? ` · ${c.input.hint}` : ""}
                  </span>
                </button>
              ))}
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!running) submit();
            }}
            className="flex items-end gap-2 rounded-2xl border border-input bg-card p-2 shadow-sm focus-within:ring-1 focus-within:ring-ring"
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []);
                setFiles((prev) =>
                  [...prev, ...picked.filter((f) => f.size <= MAX_FILE_BYTES)].slice(0, MAX_FILES)
                );
                e.target.value = "";
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={running || !session}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30"
              title={t("chat.attach")}
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                saveDraft(session?.id, e.target.value);
              }}
              onKeyDown={(e) => {
                if (slashOpen) {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setSlashSel((s) => (s + 1) % slashMatches.length);
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setSlashSel(
                      (s) => (s - 1 + slashMatches.length) % slashMatches.length
                    );
                    return;
                  }
                  if (e.key === "Tab") {
                    e.preventDefault();
                    completeCommand(slashMatches[Math.min(slashSel, slashMatches.length - 1)]);
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setSlashHidden(input);
                    return;
                  }
                }
                if (e.key === "Enter" && !e.shiftKey && !e.altKey) {
                  e.preventDefault();
                  // con paleta abierta, Enter completa el comando (enviar solo
                  // si ya hay comando exacto escrito)
                  if (
                    slashOpen &&
                    input !== `/${slashMatches[slashSel]?.name}`
                  ) {
                    completeCommand(slashMatches[slashSel]);
                    return;
                  }
                  submit();
                }
              }}
              rows={1}
              placeholder={
                running
                  ? t("chat.thinkingPlaceholder")
                  : t("chat.inputPlaceholder")
              }
              disabled={running || !session}
              className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-3 py-2 text-[0.9rem] outline-none placeholder:text-muted-foreground md:text-sm"
            />
            <button
              onClick={running ? stop : submit}
              disabled={!running && (!input.trim() || !session)}
              className={
                running
                  ? "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-destructive text-destructive-foreground transition-opacity hover:opacity-90"
                  : "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-30"
              }
              title={running ? t("chat.stop") : t("chat.send")}
            >
              {running ? (
                <Square className="h-3.5 w-3.5 fill-current" />
              ) : (
                <SendHorizontal className="h-4 w-4" />
              )}
            </button>
          </form>
          </div>
          </>
          )}
          <div className="mt-2 flex items-center justify-between gap-3 px-1 text-[11px] text-muted-foreground">
            <span className="min-w-0 truncate">
              {wstatus?.cwd ? (
                <>
                  {/* mobile: path only (no "Working directory:" label) */}
                  <span className="hidden sm:inline">{t("chat.workDir")}: </span>
                  <span className="font-mono">{wstatus.cwd}</span>
                  {wstatus.branch ? (
                    <span className="ml-1 font-mono shrink-0">
                      [⎇{wstatus.branch}]
                    </span>
                  ) : null}
                </>
              ) : ""}
            </span>
            {wstatus?.model ? (
              <span className="shrink-0 font-mono">
                {t("chat.model")}: {wstatus.model}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}

function Avatar({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald text-primary-foreground">
      {children}
    </span>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground"
      style={{ animationDelay: delay }}
    />
  );
}

/** Parses "[Resource link: file://…]" (CLI annotation for attachments): text + chip 📎 */
const URL_RE = /(https?:\/\/[^\s<>"']+)/g;

/** Converts bare URLs in a plain-text user message into real links
 * (both the resource attachments and the plain message can mix them). */
function linkify(text: string, key: string): ReactNode {
  const nodes: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(text))) {
    if (m.index > last)
      nodes.push(<span key={`${key}t${nodes.length}`}>{text.slice(last, m.index)}</span>);
    const href = m[1];
    nodes.push(
      <a
        key={`${key}a${nodes.length}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="break-all text-emerald underline underline-offset-2 hover:opacity-80"
      >
        {href}
      </a>
    );
    last = m.index + href.length;
  }
  if (last < text.length || nodes.length === 0)
    nodes.push(<span key={`${key}t${nodes.length}`}>{text.slice(last)}</span>);
  return nodes;
}

/** Renders a user message body: resource attachments become chips and any
 * bare URL becomes a real link. */
function userContentNodes(content: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /\s*\[Resource link:\s*file:\/\/([^\]]+)\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const text = content.slice(last, m.index).trimEnd();
    if (text) nodes.push(<span key={`t${nodes.length}`}>{linkify(text, `r${nodes.length}`)}</span>);
    const name = m[1].split("/").pop() || "adjunto";
    nodes.push(
      <span
        key={`a${nodes.length}`}
        className="mt-1.5 flex items-center gap-1.5 rounded-md bg-foreground/10 px-2 py-1 font-mono text-[11px]"
      >
        <Paperclip className="h-3 w-3 shrink-0" /> {name}
      </span>
    );
    last = re.lastIndex;
  }
  const rest = content.slice(last).trim();
  if (rest || nodes.length === 0)
    nodes.push(<span key={`t${nodes.length}`}>{linkify(rest, `e${nodes.length}`)}</span>);
  return nodes;
}

function UserBubble({ msg }: { msg: ChatMessage }) {
  const lang = useLang();
  const locale = localeOf(lang);
  const isCommand = msg.content.startsWith("/");
  const hasResource = /\[Resource link:/.test(msg.content);
  return (
    <div className="flex flex-col items-end">
      {isCommand ? (
        <div className="max-w-[80%] rounded-lg border border-border bg-muted/40 px-3 py-1.5 font-mono text-[11.5px] leading-relaxed text-foreground/90">
          <span className="text-emerald">❯</span> {msg.content}
        </div>
      ) : (
        <div
          className={`rounded-2xl rounded-br-md bg-user-bubble px-4 py-2.5 text-sm leading-relaxed text-foreground ${
            hasResource
              ? "flex max-w-[90%] flex-col items-stretch"
              : "max-w-[90%] whitespace-pre-wrap"
          }`}
        >
          {hasResource
            ? userContentNodes(msg.content)
            : linkify(msg.content, "m")}
        </div>
      )}
      {msg.ts && (
        <span className={`text-[10px] text-muted-foreground ${isCommand ? "mt-1 pr-3" : "mt-1 pr-1"}`}>
          {formatTs(msg.ts, locale)}
        </span>
      )}
    </div>
  );
}

/** CLI meta line (catch-all drawer): compactations, system notices… */
function SystemLine({ content }: { content: string }) {
  return (
    <div className="flex items-center gap-1.5 overflow-hidden rounded-md border border-border/60 bg-muted/20 px-2 py-0.5 font-mono text-[10.5px] text-muted-foreground">
      <span className="min-w-0 break-all">{content}</span>
    </div>
  );
}

/** Slash command block: terminal-style accordion (like the tool chips). */
function CommandBlock({ msg, out }: { msg: ChatMessage; out?: ChatMessage }) {
  const locale = localeOf(useLang());
  const text = out
    ? out.parts?.some((p) => p.kind === "text")
      ? out.parts
          .filter((p): p is Extract<MessagePart, { kind: "text" }> => p.kind === "text")
          .map((p) => p.content)
          .join("")
      : out.content
    : "";
  const metaLines = (out?.parts ?? [])
    .filter((p): p is Extract<MessagePart, { kind: "system" }> => p.kind === "system")
    .map((p) => `⚙ ${p.content}`);
  const outText = [text, ...metaLines].filter(Boolean).join("\n");
  return (
    <div className="flex flex-col items-end">
      <details className="group/chip max-w-[92%] overflow-hidden rounded-lg border border-border bg-muted/40">
        <summary className="flex min-h-[28px] cursor-pointer list-none items-center gap-2 px-2.5 py-1 font-mono text-[11px] text-foreground/90 [&::-webkit-details-marker]:hidden hover:bg-muted">
          <span className="shrink-0 text-emerald">❯</span>
          <span className="min-w-0 truncate">{msg.content}</span>
          {outText && (
            <ChevronDown className="ml-auto h-3 w-3 shrink-0 text-muted-foreground transition-transform group-open/chip:rotate-180" />
          )}
        </summary>
        {outText && (
          <pre className="max-h-44 overflow-auto whitespace-pre-wrap border-t border-border bg-background/40 px-2.5 py-1.5 font-mono text-[10.5px] leading-relaxed text-muted-foreground">
            {outText}
          </pre>
        )}
      </details>
      {msg.ts && (
        <span className="mt-1 pr-1 text-[10px] text-muted-foreground">
          {formatTs(msg.ts, locale)}
        </span>
      )}
    </div>
  );
}

const PROSE =
  "prose prose-sm prose-neutral dark:prose-invert max-w-none prose-pre:rounded-xl prose-pre:bg-muted prose-pre:border prose-pre:border-border prose-code:before:hidden prose-code:after:hidden";

/** Code fence: adds a subtle copy button that appears on hover. */
function CopyCodeBlock({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div className="group/code relative">
      <pre {...props}>{children}</pre>
      <button
        onClick={() => {
          const text = extractText(children);
          if (text) navigator.clipboard.writeText(text).catch(() => {});
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="absolute right-2 top-2 flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border border-border bg-background/80 text-muted-foreground opacity-0 transition-opacity group-hover/code:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100"
        title={copied ? t("chat.copied") : t("chat.codeCopyTitle")}
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      </button>
    </div>
  );
}

/** Flattens react-markdown children into plain text (for copying). */
function extractText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (node && typeof node === "object" && "props" in node) {
    return extractText((node as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}

function Reasoning({ text, open = false }: { text: string; open?: boolean }) {
  const t = useT();
  const innerRef = useRef<HTMLParagraphElement>(null);
  // sigue el final del texto mientras llega reasoning en streaming (solo abierto)
  useLayoutEffect(() => {
    const el = innerRef.current;
    if (el && open) el.scrollTop = el.scrollHeight;
  }, [text, open]);
  return (
    <details
      className="group/chip overflow-hidden rounded-lg border border-border bg-muted/40"
      open={open || undefined}
    >
      <summary className="flex min-h-[28px] cursor-pointer list-none items-center gap-2 px-2.5 py-1 font-mono text-[11px] text-foreground/90 [&::-webkit-details-marker]:hidden hover:bg-muted">
        <span className="shrink-0">🧠</span>
        <span className="min-w-0 truncate">{t("chat.reasoning")}</span>
        <ChevronDown className="ml-auto h-3 w-3 shrink-0 text-muted-foreground transition-transform group-open/chip:rotate-180" />
      </summary>
      <p
        ref={innerRef}
        className="max-h-64 overflow-y-auto whitespace-pre-wrap border-t border-border bg-background/40 px-2.5 py-1.5 font-mono text-[10.5px] leading-relaxed text-muted-foreground"
      >
        {text}
      </p>
    </details>
  );
}

function Content({ text }: { text: string }) {
  return (
    <div className={PROSE}>
      {text ? (
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkBreaks]}
          components={{
            pre: (props) => <CopyCodeBlock {...props} />,
          }}
        >
          {text}
        </ReactMarkdown>
      ) : (
        <span className="inline-block h-4 w-2 animate-pulse rounded-sm bg-muted-foreground/70 align-middle" />
      )}
    </div>
  );
}

/** Mensaje assistant: partes (texto↔tools) en orden, o fallback legacy */
function AssistantMessage({ msg }: { msg: ChatMessage }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const locale = localeOf(useLang());
  const hasParts = !!msg.parts && msg.parts.length > 0;
  const parts: MessagePart[] = hasParts
    ? msg.parts!
    : [{ kind: "text", content: msg.content }];
  return (
    <div className="flex flex-col items-start gap-1.5 sm:flex-row sm:items-start sm:gap-3">
      <Avatar>
        <Bot className="h-3.5 w-3.5" />
      </Avatar>
      <div className="min-w-0 max-w-[90%] space-y-1.5">
        {msg.reasoning && <Reasoning text={msg.reasoning} open={hasParts} />}
        {parts.map((p, i) =>
          p.kind === "tool" ? (
            <ToolChips
              key={`t${i}`}
              tools={[{ id: p.toolCallId, title: p.title, status: p.status, detail: p.detail }]}
            />
          ) : p.kind === "reasoning" ? (
            // tramos de razonamiento intercalados (turno caliente); plegados
            // por defecto, como el CLI al terminar
            <Reasoning key={`r${i}`} text={p.content} />
          ) : p.kind === "system" ? (
            <SystemLine key={`s${i}`} content={p.content} />
          ) : (
            <Content key={`x${i}`} text={p.content} />
          )
        )}
        {!hasParts && msg.tools && <ToolChips tools={msg.tools} />}
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <button
            onClick={() => {
              navigator.clipboard.writeText(msg.content);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:bg-muted hover:text-foreground"
            title={t("chat.copyTitle")}
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? t("chat.copied") : t("chat.copy")}
          </button>
          {msg.ts && <span>· {formatTs(msg.ts, locale)}</span>}
        </div>
      </div>
    </div>
  );
}

/** Turno en vivo: razonamiento abierto + tramos de texto y chips intercalados */
function LiveBlock({ turn }: { turn: LiveTurn }) {
  const t = useT();
  const empty = !turn.reasoning && turn.parts.length === 0;
  // respuesta de un comando slash: el streaming se plega al bloque ❯ que ya
  // rendered by MessageList (plain text, no agent tools)
  const isCommandOut =
    turn.userPrompt?.startsWith("/") === true &&
    !turn.parts.some((p) => p.kind === "tool");
  if (isCommandOut)
    return (
      <div className="flex flex-col items-end">
        <div className="max-w-[92%] overflow-hidden rounded-lg border border-border bg-muted/40">
          <pre className="max-h-44 overflow-auto whitespace-pre-wrap border-t border-border bg-background/40 px-3 py-1.5 font-mono text-[10.5px] leading-relaxed text-muted-foreground">
            {turn.parts
              .filter((p): p is Extract<MessagePart, { kind: "text" }> => p.kind === "text")
              .map((p) => p.content)
              .join("") || t("chat.executing")}
          </pre>
        </div>
      </div>
    );
  return (
    <div className="flex flex-col items-start gap-1.5 sm:flex-row sm:items-start sm:gap-3">
      <Avatar>
        <Bot className="h-3.5 w-3.5" />
      </Avatar>
      <div className="min-w-0 max-w-[90%] space-y-1.5">
        {empty && (
          <div className="flex gap-1 rounded-xl border border-border bg-secondary px-4 py-2.5">
            <Dot delay="0ms" />
            <Dot delay="150ms" />
            <Dot delay="300ms" />
          </div>
        )}
        {turn.parts.map((p, i) =>
          p.kind === "tool" ? (
            <ToolChips
              key={`t${i}`}
              tools={[{ id: p.toolCallId, title: p.title, status: p.status, detail: p.detail }]}
            />
          ) : p.kind === "system" ? (
            <SystemLine key={`s${i}`} content={p.content} />
          ) : p.kind === "reasoning" ? (
            // reasoning spans interleaved at their actual position; sealed
            // segments (done) collapse one by one as the turn progresses
            <Reasoning key={`r${i}`} text={p.content} open={!p.done} />
          ) : (
            <Content key={`x${i}`} text={p.content} />
          )
        )}
      </div>
    </div>
  );
}

function EmptyState({
  running,
  cwd,
  onPick,
}: {
  running: boolean;
  cwd?: string;
  onPick: (t: string) => void;
}) {
  const t = useT();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald text-white shadow-lg">
          <Logo className="h-9 w-9" />
        </span>
        <h2 className="text-lg font-semibold">{t("chat.emptyTitle")}</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          {cwd ? t("chat.emptyText", { cwd }) : t("chat.emptyTextPlain")}
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-1">
        {SUGGESTION_KEYS.map((k) => (
          <button
            key={k}
            disabled={running}
            onClick={() => onPick(t(k))}
            className="rounded-xl border border-border bg-card px-4 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            {t(k)}
          </button>
        ))}
      </div>
    </div>
  );
}
// re-render barato: memo evita re-parsear TODO el markdown en cada tecla
// del textarea (las props de mensaje son estables mientras se escribe)
export const MemoUserBubble = memo(UserBubble);
export const MemoCommandBlock = memo(CommandBlock);
export const MemoAssistantMessage = memo(AssistantMessage);
export const MemoLiveBlock = memo(LiveBlock);
export const MemoEmptyState = memo(EmptyState);
