"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import pkg from "../../package.json";
import { syncThemeAndFavicon } from "@/lib/cw";
import { CircleHelp, LogOut, Moon, Settings2, Sun, SunMoon } from "lucide-react";
import Sidebar from "@/components/Sidebar";
import Chat from "@/components/Chat";
import AboutModal from "@/components/AboutModal";
import SettingsModal from "@/components/SettingsModal";
import { apiUrl, authFetch, clearTokens, getAccessToken, getRefreshToken } from "@/lib/api";
import Login from "@/components/Login";
import { LangProvider, useT } from "@/lib/i18n";
import type {
  Attachment,
  AvailableCommand,
  ChatMessage,
  LiveTurn,
  MessagePart,
  PermissionOption,
  PermissionReq,
  SessionSummary,
} from "@/lib/types";

export default function Page() {
  return (
    <LangProvider>
      <Shell />
    </LangProvider>
  );
}

function Shell() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [runningIds, setRunningIds] = useState<Record<string, boolean>>({});
  const [liveTurns, setLiveTurns] = useState<Record<string, LiveTurn | null>>({});
  const [error, setError] = useState<string | null>(null);
  // rises on each new session: Chat uses the change to focus the composer
  const [focusNonce, setFocusNonce] = useState(0);
  // unseen count per session (finished turn / permission): sidebar badge,
  // title counter, favicon dot and system notification. Persisted in
  // localStorage; cleared when the session is opened with the tab visible.
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [loaded, setLoaded] = useState(false);
  // session hydration in flight (spinner instead of landing on open)
  const [loadingIds, setLoadingIds] = useState<Record<string, boolean>>({});
  // "sticky" permission: card of a pending permission whose stream died
  // (reload/navigation). NEVER self-authorized: re-shown until
  // el usuario responde.
  const [stickyPerms, setStickyPerms] = useState<
    Record<string, PermissionReq | null>
  >({});
  const retryRef = useRef<{
    sessionId: string;
    text: string;
    attachments?: Attachment[];
    attempts?: number;
  } | null>(null);
  // zombie-turn sessions this page is polling (one per session)
  const pollRef = useRef<Set<string>>(new Set());
  // queued messages (429 by permission) to re-send when the session is idle
  const retryAfterPollRef = useRef<
    Map<string, { sessionId: string; text: string; attachments?: Attachment[] }>
  >(new Map());
  // latest-ref de send: startPoll se declara antes que send pero necesita
  // reenviar la cola cuando el turno zombi termina
  const sendRef = useRef<
    (text: string, attachments?: Attachment[], targetId?: string) => unknown
  >(() => {});
  // tema tri-estado: auto (sistema), light o dark; lo aplica el script
  // themeInit in the layout BEFORE hydration; the cycle is persisted here
  const [theme, setTheme] = useState<"auto" | "light" | "dark">("auto");
  const [menuOpen, setMenuOpen] = useState(false); // drawer de sesiones (mobile)
  const [aboutOpen, setAboutOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // authentication gate: "unknown" (checking), "off" (NO_AUTH), "ok" (auth
  // on and tokens present — a stale pair self-heals via refresh; the
  // "cw-unauth" event demotes it to "on" and shows the login overlay) or
  // "on" (auth required, login screen).
  const [authGate, setAuthGate] = useState<"unknown" | "off" | "ok" | "on">("unknown");
  // slash commands cached per session (composer palette)
  const [commands, setCommands] = useState<Record<string, AvailableCommand[]>>({});
  const abortRef = useRef<AbortController | null>(null);

  const t = useT();
  const loadSessions = useCallback(async (): Promise<SessionSummary[]> => {
    const res = await authFetch(apiUrl("/api/sessions"));
    const data = await res.json();
    // the server returns the list sorted by last activity
    return data.sessions as SessionSummary[];
  }, []);

  // auth state probe (public endpoint) + single sign-out listener
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(apiUrl("/api/auth/state"), { credentials: "include" });
        const d = await r.json();
        if (!d?.auth) setAuthGate("off");
        else if (getAccessToken() || getRefreshToken()) setAuthGate("ok");
        else setAuthGate("on");
      } catch {
        // backend unreachable: let the normal error path handle it once up
        setAuthGate("ok");
      }
    })();
    const unauth = () => setAuthGate((g) => (g === "off" ? "off" : "on"));
    window.addEventListener("cw-unauth", unauth);
    return () => window.removeEventListener("cw-unauth", unauth);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      const v = localStorage.getItem("theme");
      if (v === "light" || v === "dark") setTheme(v);
    } catch {}
  }, []);

  useEffect(() => {
    const dark =
      theme === "dark" ||
      (theme === "auto" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
    try {
      localStorage.setItem("theme", theme);
    } catch {}
    // favicon and (in case the UI changed the accent) accent re-sync
    syncThemeAndFavicon();
  }, [theme]);

  useEffect(() => {
    (async () => {
      try {
        let data = await loadSessions();
        if (data.length === 0) {
          const res = await authFetch(apiUrl("/api/sessions"), { method: "POST" });
          data = [(await res.json()).session];
        }
        setSessions(data);
        // open the last active one: URL ?s=<id> (deep-link) wins, then the
        // last one we viewed, otherwise the most recent
        let last: string | null = null;
        try {
          last = localStorage.getItem("lastSession");
        } catch {}
        const wanted =
          new URLSearchParams(window.location.search).get("s") ?? last;
        const pick =
          data.find((s) => s.id === wanted)?.id ?? data[0]?.id ?? null;
        setActiveId((prev) => prev ?? pick);
      } catch {
        setError(t("err.loadSessions"));
      } finally {
        setLoaded(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authGate === "off" || authGate === "ok"]);

  // (session bootstrap runs once the auth gate is resolved; a login reload
  // restarts the whole shell)

  // the URL always reflects the open session (?s=<id>) for shareability
  useEffect(() => {
    if (!activeId) return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("s", activeId);
      window.history.replaceState(null, "", url);
    } catch {}
  }, [activeId]);

  const refresh = useCallback(async () => {
    const data = await loadSessions();
    // conserva los mensajes ya hidratados: la lista solo trae metadatos
    setSessions((prev) =>
      data.map((n) => ({
        ...n,
        messages: prev.find((p) => p.id === n.id)?.messages ?? n.messages,
      }))
    );
  }, [loadSessions]);

  /** snapshot de comandos slash para la paleta del composer (best-effort). */
  const loadCommands = useCallback(async (id: string) => {
    try {
      const res = await authFetch(apiUrl(`/api/commands/${id}`));
      const { commands: cmds } = (await res.json()) as {
        commands?: AvailableCommand[];
      };
      if (Array.isArray(cmds) && cmds.length)
        setCommands((prev) => ({ ...prev, [id]: cmds }));
    } catch {
      /* the session without a snapshot will use the server cache last */
    }
  }, []);

  /**
   * Sondeo del turno zombi: el daemon sigue procesando aunque el stream
   * SSE of this tab has died (reload, navigation). Refreshes messages
   * y permiso sticky cada 1.5 s hasta que el server reporta idle.
   */
  const startPoll = useCallback(
    (id: string) => {
      if (pollRef.current.has(id)) return;
      pollRef.current.add(id);
      setRunningIds((prev) => ({ ...prev, [id]: true }));
      const tick = async () => {
        try {
          const res = await authFetch(apiUrl(`/api/sessions/${id}`));
          const { session } = res.ok
            ? ((await res.json()) as {
                session: SessionSummary & {
                  running?: boolean;
                  pending?: PermissionReq | null;
                };
              })
            : { session: null };
          if (!session) {
            pollRef.current.delete(id);
            setRunningIds((prev) => ({ ...prev, [id]: false }));
            return;
          }
          setSessions((prev) =>
            prev.map((s) => (s.id === id ? { ...s, ...session } : s))
          );
          setStickyPerms((prev) => ({ ...prev, [id]: session.pending ?? null }));
          if (session.running) {
            setTimeout(tick, 1500);
            return;
          }
        } catch {
          // red falla: seguimos sondeando (el turno puede seguir vivo)
          setTimeout(tick, 2500);
          return;
        }
        pollRef.current.delete(id);
        setRunningIds((prev) => ({ ...prev, [id]: false }));
        refresh();
        // is there a queued message waiting for this session to go idle?
        const retry = retryAfterPollRef.current.get(id);
        if (retry) {
          retryAfterPollRef.current.delete(id);
          void sendRef.current(retry.text, retry.attachments, retry.sessionId);
        }
      };
      setTimeout(tick, 1200);
    },
    [refresh]
  );

  /**
   * Hydrates a session's content on demand: metadata is in the list;
   * messages are fetched from the API only when the session is opened or
   * finishes processing (ACP channel materialization on the server).
   */
  const hydrateDetail = useCallback(async (id: string) => {
    setLoadingIds((prev) => ({ ...prev, [id]: true }));
    try {
      const res = await authFetch(apiUrl(`/api/sessions/${id}`));
      if (!res.ok) return null;
      const { session } = await res.json() as {
        session: SessionSummary & {
          pending?: PermissionReq | null;
          running?: boolean;
        };
      };
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, ...session } : s))
      );
      // pending permission without stream: re-show the card (no
      // auto-authorization)
      setStickyPerms((prev) => ({ ...prev, [id]: session.pending ?? null }));
      // turno vivo en el daemon sin stream local (reload): sondear hasta fin
      if (session.running) startPoll(id);
      return session;
    } catch {
      return null;
    } finally {
      setLoadingIds((prev) => ({ ...prev, [id]: false }));
    }
  }, [startPoll]);

  useEffect(() => {
    if (!activeId) return;
    if (runningIds[activeId]) return; // streaming en curso: estado local vivo
    void hydrateDetail(activeId);
  }, [activeId, runningIds, hydrateDetail]);

  // slash palette: loads on ANY session activation (entry with
  // lastSession/deep-link incluida), no solo al hacer click en la sidebar
  useEffect(() => {
    if (activeId) void loadCommands(activeId);
  }, [activeId, loadCommands]);

  useEffect(() => {
    try {
      const v = localStorage.getItem("uiVariant");
      if (v === "kit") localStorage.removeItem("uiVariant");
    } catch {}
  }, []);

  const selectSession = (id: string) => {
    setMenuOpen(false); // cerrar drawer en mobile
    setActiveId(id); // loadCommands corre en el efecto de activeId
    if (typeof document !== "undefined" && document.visibilityState === "visible")
      clearUnread(id);
    try {
      localStorage.setItem("lastSession", id);
    } catch {}
    setError(null);
  };

  const activeSession = sessions.find((s) => s.id === activeId) ?? null;

  const activeIdRef = useRef<string | null>(activeId);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);
  const sessionsRef = useRef<SessionSummary[]>(sessions);
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  /** marks "unseen" + notification when the tab is hidden */
  const markUnread = useCallback(
    (id: string, kind: "done" | "perm") => {
      const viewing =
        typeof document !== "undefined" &&
        document.visibilityState === "visible" &&
        activeIdRef.current === id;
      try {
        if (
          !viewing &&
          typeof Notification !== "undefined" &&
          Notification?.permission === "granted" &&
          document.visibilityState === "hidden" &&
          localStorage.getItem("cwNotify") === "1"
        ) {
          const fav = document.getElementById("cw-fav-dyn") as HTMLLinkElement | null;
          const n = new Notification("Copilot Web", {
            body: t(kind === "perm" ? "notif.perm" : "notif.done"),
            tag: `cw-${id}`,
            icon: fav?.href || undefined,
          });
          n.onclick = () => {
            window.focus();
            n.close();
            // coming back from the notification, lands on the pending session
            if (activeIdRef.current !== id) selectSession(id);
          };
        }
      } catch {}
      if (!viewing) setUnread((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }));
    },
    [t],
  );

  const clearUnread = useCallback((id: string) => {
    setUnread((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  // primera carga: lee el mapa persistido (antes de que persista de nuevo)
  const hydratedRef = useRef(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("cwUnread");
      if (raw) setUnread(JSON.parse(raw) as Record<string, number>);
    } catch {}
    hydratedRef.current = true;
  }, []);

  // unread counter persistence (the sidebar badges read it)
  useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      localStorage.setItem("cwUnread", JSON.stringify(unread));
    } catch {}
  }, [unread]);

  // turn end detected in runningIds (true→false) of any session
  const prevRunningRef = useRef<Record<string, boolean>>({});
  useEffect(() => {
    const prev = prevRunningRef.current;
    for (const id of Object.keys(runningIds))
      if (prev[id] && !runningIds[id]) markUnread(id, "done");
    prevRunningRef.current = runningIds;
  }, [runningIds, markUnread]);

  // permiso pendiente (sticky) nuevo: reqId distinto al ya visto
  const prevPermRef = useRef<Record<string, number>>({});
  useEffect(() => {
    const prev = prevPermRef.current;
    const now: Record<string, number> = {};
    for (const [id, p] of Object.entries(stickyPerms)) {
      if (p) {
        now[id] = p.reqId;
        if (prev[id] !== p.reqId) markUnread(id, "perm");
      }
    }
    prevPermRef.current = now;
  }, [stickyPerms, markUnread]);

  // back on the tab the active session is visible: clears its unseen count
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible" && activeIdRef.current)
        clearUnread(activeIdRef.current);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [clearUnread]);

  // tab title: (unseen) + active session name
  const unreadTotal = Object.values(unread).reduce((a, b) => a + b, 0);
  useEffect(() => {
    const name = activeSession?.name?.split("\n")[0]?.slice(0, 60);
    const prefix = unreadTotal ? `(${unreadTotal}) ` : "";
    document.title = name ? `${prefix}Copilot Web · ${name}` : `${prefix}Copilot Web`;
  }, [unreadTotal, activeSession?.name]);
  const liveTurn = activeId ? (liveTurns[activeId] ?? undefined) : undefined;

  function patchMessages(sessionId: string, updater: (msgs: ChatMessage[]) => ChatMessage[]) {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId ? { ...s, messages: updater(s.messages ?? []) } : s
      )
    );
  }

  const createSession = useCallback(async () => {
    const res = await authFetch(apiUrl("/api/sessions"), { method: "POST" });
    const { session } = await res.json();
    setSessions((prev) => [session, ...prev]);
    setActiveId(session.id);
    setFocusNonce((n) => n + 1); // composer focused for the new session
    // the session was just born in the daemon: it already has the command snapshot
    // (loadCommands corre en el efecto de activeId)
    try {
      localStorage.setItem("lastSession", session.id);
    } catch {}
    setError(null);
  }, []);

  const renameSession = useCallback(async (id: string, name: string) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, name } : s)));
    try {
      const res = await authFetch(apiUrl(`/api/sessions/${id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({}))) as { error?: string };
        setError(error || t("err.rename", { n: res.status }));
      }
    } catch {
      setError(t("err.renameNet"));
    }
    // reconciles with the server: reverses the optimism if the CLI failed
    await refresh();
  }, [refresh]);

  const deleteSession = useCallback(async (id: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== id));
    const wasActive = id === activeId;
    if (wasActive) {
      setActiveId((prev) => {
        const rest = sessions.filter((s) => s.id !== id);
        return rest[0]?.id ?? null;
      });
    }
    let ok = true;
    try {
      const res = await authFetch(apiUrl(`/api/sessions/${id}`), { method: "DELETE" });
      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({}))) as { error?: string };
        setError(error || t("err.delete", { n: res.status }));
        ok = false;
      }
    } catch {
      setError(t("err.deleteNet"));
      ok = false;
    }
    if (!ok) {
      // the session is still alive (the CLI did not delete it): reconcile and reopen it
      await refresh();
      setActiveId(id);
      return;
    }
    refresh();
  }, [activeId, sessions, refresh]);

  const send = useCallback(
    async (text: string, attachments?: Attachment[], targetId?: string) => {
      const sessionId = targetId ?? activeId;
      if (!sessionId || runningIds[sessionId]) return;
      setError(null);
      setMenuOpen(false);
      clearUnread(sessionId); // sending = you are looking at this session

      const now = new Date().toISOString();
      patchMessages(sessionId, (msgs) => [
        ...msgs,
        { id: `local-${now}`, role: "user", content: text, ts: now },
      ]);
      setRunningIds((prev) => ({ ...prev, [sessionId]: true }));

      const ac = new AbortController();
      abortRef.current = ac;

      try {
        const res = await authFetch(apiUrl("/api/chat"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ac.signal,
          body: JSON.stringify({
            sessionId,
            message: text,
            attachments: attachments ?? [],
          }),
        });

        if (!res.ok) {
          const data = await res
            .json()
            .catch(() => ({} as { error?: string; busy?: boolean; pending?: PermissionReq }));
          // 429 busy: the session has an earlier turn pending a permission.
          // No auto-authorization: we re-show the card and leave
          // el texto listo para reintentarlo cuando el usuario responda.
          if (res.status === 429 && data.busy) {
            if (data.pending) {
              // turno anterior pendiente de un permiso: re-mostrar card y
              // dejar el mensaje en cola para reenviar al responder.
              // SIN banner: la card ya lo explica (err.busyPerm era lioso)
              setStickyPerms((prev) => ({ ...prev, [sessionId]: data.pending! }));
              patchMessages(sessionId, (msgs) =>
                msgs.filter((m) => m.id !== `local-${now}`)
              );
              retryRef.current = {
                sessionId,
                text,
                attachments,
                attempts: 0,
              };
              return;
            }
            // busy without permission: the earlier turn is finishing. Retry
            // silencioso (tope 3) para no bloquear al usuario.
            const attempts =
              (retryRef.current?.sessionId === sessionId
                ? (retryRef.current?.attempts ?? 0)
                : 0) + 1;
            patchMessages(sessionId, (msgs) =>
              msgs.filter((m) => m.id !== `local-${now}`)
            );
            retryRef.current = { sessionId, text, attachments, attempts };
            if (attempts <= 3) {
              setTimeout(
                () => void send(text, attachments, sessionId),
                2500
              );
              return;
            }
            setError(t("err.busyTurn"));
            return;
          }
          throw new Error(data.error || `Error ${res.status}`);
        }

        // real success: the message was delivered; cancels any queued retry
        retryRef.current = null;
        retryAfterPollRef.current.delete(sessionId);

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        // turno en vivo: razonamiento acumulado + partes ordenadas
        const turn: LiveTurn = { reasoning: "", parts: [], userPrompt: text.trim() };
        const sync = () =>
          setLiveTurns((prev) => ({
            ...prev,
            [sessionId]: {
              reasoning: turn.reasoning,
              parts: [...turn.parts],
              userPrompt: turn.userPrompt,
              permissions: turn.permissions,
            },
          }));

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() ?? "";
          for (const raw of events) {
            const line = raw.trim();
            if (!line.startsWith("data:")) continue;
            const ev = JSON.parse(line.slice(5).trim());

            if (ev.type === "delta") {
              const c = (ev.data as { content?: string })?.content;
              if (!c) continue;
              const last = turn.parts[turn.parts.length - 1];
              if (last && last.kind === "text") {
                turn.parts[turn.parts.length - 1] = { ...last, content: last.content + c };
              } else {
                if (last && last.kind === "reasoning" && !last.done)
                  turn.parts[turn.parts.length - 1] = { ...last, done: true };
                turn.parts.push({ kind: "text", content: c });
              }
              sync();
            } else if (ev.type === "message") {
              // mensaje final autoritativo: se persiste en el historial
              const m = ev.data as ChatMessage;
              patchMessages(sessionId, (msgs) =>
                msgs.some((x) => x.id === m.id)
                  ? msgs.map((x) => (x.id === m.id ? { ...x, ...m } : x))
                  : [...msgs, { ...m, ts: m.ts ?? new Date().toISOString() }]
              );
              setLiveTurns((prev) => ({ ...prev, [sessionId]: null }));
            } else if (ev.type === "reasoning_delta") {
              const c = (ev.data as { content?: string })?.content;
              if (!c) continue;
              // tramos de razonamiento intercalados (igual que el CLI);
              // turn.reasoning se conserva para el estado "…" inicial
              turn.reasoning += c;
              const lastP = turn.parts[turn.parts.length - 1];
              if (lastP && lastP.kind === "reasoning" && !lastP.done)
                turn.parts[turn.parts.length - 1] = {
                  ...lastP,
                  content: lastP.content + c,
                };
              else turn.parts.push({ kind: "reasoning", content: c });
              sync();
            } else if (ev.type === "reasoning_done") {
              // server sealed the last reasoning segment (a new text/tool
              // part started) → collapse it on screen, one by one
              const idx = (ev.data as { index?: number })?.index ?? -1;
              const last = turn.parts[turn.parts.length - 1];
              if (last && last.kind === "reasoning" && !last.done)
                turn.parts[turn.parts.length - 1] = { ...last, done: true };
              else if (idx >= 0 && turn.parts[idx]?.kind === "reasoning")
                turn.parts[idx] = { ...(turn.parts[idx] as Extract<MessagePart, { kind: "reasoning" }>), done: true };
              sync();
            } else if (ev.type === "tool") {
              const t = ev.data as {
                kind?: string;
                toolCallId?: string;
                title?: string;
                status?: string;
              };
              const lastIdx = (pred: (p: (typeof turn.parts)[number]) => boolean) => {
                for (let i = turn.parts.length - 1; i >= 0; i--)
                  if (pred(turn.parts[i])) return i;
                return -1;
              };
              if (t.kind === "tool_call") {
                turn.parts.push({
                  kind: "tool",
                  toolCallId: t.toolCallId,
                  title: t.title ?? "tool",
                  status: t.status ?? "pending",
                  detail: (t as { detail?: string }).detail,
                });
              } else {
                let target = lastIdx((p) => p.kind === "tool" && p.toolCallId === t.toolCallId);
                if (target < 0 && t.status && t.status !== "pending")
                  target = lastIdx((p) => p.kind === "tool" && p.status === "pending");
                if (target >= 0 && t.status) {
                  const p = turn.parts[target];
                  if (p.kind === "tool")
                    turn.parts[target] = {
                      ...p,
                      status: t.status,
                      detail:
                        (t as { detail?: string }).detail || p.detail,
                    };
                }
              }
              sync();
            } else if (ev.type === "commands") {
              // snapshot oficial de comandos slash (llega tras prompts)
              const cmds = (ev.data as { availableCommands?: AvailableCommand[] })
                .availableCommands;
              if (Array.isArray(cmds) && cmds.length)
                setCommands((prev) => ({ ...prev, [sessionId]: cmds }));
            } else if (ev.type === "permission") {
              // el agente pide permiso: card en la web (espera la respuesta
              // del usuario; sin auto-permiso)
              const d = ev.data as {
                reqId: number;
                title?: string;
                toolCallId?: string;
                options?: PermissionOption[];
              };
              turn.permissions = [
                ...(turn.permissions ?? []),
                {
                  reqId: d.reqId,
                  title: d.title ?? "tool",
                  toolCallId: d.toolCallId,
                  options: d.options,
                },
              ];
              sync();
            } else if (ev.type === "permission_resolved") {
              const d = ev.data as {
                reqId: number;
                choice?: string;
                auto?: boolean;
                toolCallId?: string;
              };
              if (turn.permissions)
                turn.permissions = turn.permissions.filter(
                  (p) => p.reqId !== d.reqId
                );
              const denied = /reject|deny/i.test(d.choice ?? "");
              // marca el chip del permiso y el tool real pendiente (rojo)
              for (let i = turn.parts.length - 1; i >= 0; i--) {
                const p = turn.parts[i];
                if (p.kind !== "tool") continue;
                if (p.toolCallId === `perm-${d.reqId}`) {
                  turn.parts[i] = {
                    ...p,
                    title: denied ? `${p.title} (denied)` : p.title,
                    status: denied ? "error" : "completed",
                  };
                  break;
                }
                // the actual tool the permission applied to, when the id arrived
                if (
                  d.toolCallId &&
                  p.toolCallId === d.toolCallId &&
                  p.status === "pending"
                ) {
                  turn.parts[i] = {
                    ...p,
                    title: denied ? `${p.title} (denied)` : p.title,
                    status: denied ? "error" : "completed",
                  };
                  break;
                }
                if (p.status === "pending" && denied) {
                  turn.parts[i] = { ...p, title: `${p.title} (denied)`, status: "error" };
                  break;
                }
              }
              sync();
            } else if (ev.type === "error") {
              const extra = (ev.data as { stderr?: string })?.stderr;
              throw new Error(
                ((ev.data as { message?: string })?.message ?? "Error") +
                  (extra ? ` · ${extra}` : "")
              );
            }
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg !== "BodyStreamBuffer was aborted" && msg !== "The user aborted a request.")
          setError(msg);
      } finally {
        setRunningIds((prev) => ({ ...prev, [sessionId]: false }));
        setLiveTurns((prev) => ({ ...prev, [sessionId]: null }));
        abortRef.current = null;
        refresh();
      }
    },
    [activeId, runningIds, refresh]
  );
  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  const abortStream = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  /** click on a specific card option (or the boolean shortcut).
   * optionId: when present, the exact choice is sent (allow_always…). */
  const respondPermission = useCallback(
    async (reqId: number, allow: boolean, optionId?: string) => {
      // was the card from the LIVE turn (local SSE, stream carries the resolution)
      // o STICKY (sin stream: reload)? Del sticky se encarga el sondeo.
      let stickySid: string | null = null;
      let isLive = false;
      for (const [sid, lt] of Object.entries(liveTurns)) {
        if (lt?.permissions?.some((p) => p.reqId === reqId)) {
          stickySid = sid;
          isLive = true;
          break;
        }
      }
      if (!isLive) {
        stickySid =
          Object.keys(stickyPerms).find(
            (k) => stickyPerms[k]?.reqId === reqId
          ) ?? null;
      }
      try {
        const res = await authFetch(apiUrl("/api/permission"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            optionId ? { reqId, optionId } : { reqId, allow }
          ),
        });
        // 404: la solicitud ya no existe (daemon reiniciado, resuelta o
        // caducada) — retiramos la card local, avisamos y NO reanudamos turnos
        // 400 (optionId fuera de las opciones vivas): card desincronizada →
        // mismo tratamiento de retirada
        if (res.status === 404 || res.status === 400) {
          if (isLive && stickySid) {
            setLiveTurns((prev) => {
              const lt = prev[stickySid];
              if (!lt) return prev;
              return {
                ...prev,
                [stickySid]: {
                  ...lt,
                  permissions: (lt.permissions ?? []).filter(
                    (p) => p.reqId !== reqId
                  ),
                },
              };
            });
          }
          setStickyPerms((prev) => {
            const next = { ...prev };
            for (const k of Object.keys(next))
              if (next[k]?.reqId === reqId) next[k] = null;
            return next;
          });
          setError(t("err.permStale"));
          return;
        }
        if (!res.ok) return;
        setStickyPerms((prev) => {
          const next = { ...prev };
          for (const k of Object.keys(next))
            if (next[k]?.reqId === reqId) next[k] = null;
          return next;
        });
        if (!isLive && stickySid) startPoll(stickySid);
        const retry = retryRef.current;
        if (retry && retry.sessionId) {
          retryRef.current = null;
          // NO reenviamos a ciegas: el turno bloqueado cierra cuando el
          // daemon finish; the sticky poll triggers the re-send when it
          // sees the session idle (retryAfterPoll, one queue per session).
          retryAfterPollRef.current.set(retry.sessionId, retry);
        }
      } catch {}
    },
    [startPoll, stickyPerms, liveTurns, t]
  );

  // login screen takes over before any session bootstrap
  if (authGate === "unknown") {
    return (
      <div className="flex h-dvh items-center justify-center text-sm text-muted-foreground">
        {t("chat.loading")}
      </div>
    );
  }
  if (authGate === "on") {
    return (
      <Login
        onDone={() => {
          // full reload: the shell re-probes the gate with the fresh tokens
          window.location.reload();
        }}
      />
    );
  }
  if (!loaded) {
    return (
      <div className="flex h-dvh items-center justify-center text-sm text-muted-foreground">
        {t("chat.loading")}
      </div>
    );
  }

  return (
    <div className="flex h-dvh">
      <Sidebar
        // mobile: drawer con backdrop; desktop: columna fija
        className={
          menuOpen
            ? "fixed inset-y-0 left-0 z-40 flex md:static"
            : "hidden md:flex"
        }
        onClose={menuOpen ? () => setMenuOpen(false) : undefined}
        footer={
          <div className="flex items-center justify-between gap-1.5">
            {/* discreet version (8): to the left of the buttons */}
            <span className="pl-1 font-mono text-[10px] text-muted-foreground/70">
              v{pkg.version}
            </span>
            <div className="flex items-center justify-end gap-1.5">
            <button
              onClick={() => setAboutOpen(true)}
              className="flex h-8 cursor-pointer items-center justify-center rounded-lg border border-border px-2.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title={t("footer.helpTitle")}
            >
              <CircleHelp className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              className="flex h-8 cursor-pointer items-center justify-center rounded-lg border border-border px-2.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title={t("config.title")}
            >
              <Settings2 className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() =>
                setTheme((th) =>
                  th === "auto" ? "light" : th === "light" ? "dark" : "auto"
                )
              }
              className="flex h-8 cursor-pointer items-center justify-center rounded-lg border border-border px-2.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title={t("footer.theme" + (theme === "auto" ? "Auto" : theme === "light" ? "Light" : "Dark"))}
            >
              {theme === "auto" ? (
                <SunMoon className="h-3.5 w-3.5" />
              ) : theme === "light" ? (
                <Sun className="h-3.5 w-3.5" />
              ) : (
                <Moon className="h-3.5 w-3.5" />
              )}
            </button>
            {/* log out: only when auth is ON and the user is signed in */}
            {authGate === "ok" && (
              <button
                onClick={() => {
                  clearTokens();
                  setAuthGate("on"); // back to the Login screen
                }}
                className="flex h-8 cursor-pointer items-center justify-center rounded-lg border border-border px-2.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title={t("footer.logout")}
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            )}
            </div>
          </div>
        }
        sessions={sessions}
        activeId={activeId}
        runningIds={runningIds}
        onSelect={selectSession}
        onCreate={createSession}
        unread={unread}
        onRename={renameSession}
        onDelete={deleteSession}
      />
      {menuOpen && (
        <div
          onClick={() => setMenuOpen(false)}
          className="fixed inset-0 z-30 bg-black/50 backdrop-blur-xs md:hidden"
        />
      )}
      <Chat
        session={activeSession}
        running={!!activeId && !!runningIds[activeId]}
        loading={!!activeId && !!loadingIds[activeId]}
        liveTurn={liveTurn}
        error={error}
        commands={activeId ? commands[activeId] : undefined}
        onSend={send}
        onMenu={() => setMenuOpen(true)}
        onAbort={abortStream}
        onPermission={respondPermission}
        focusNonce={focusNonce}
        onRename={renameSession}
        stickyPermission={
          activeId ? (stickyPerms[activeId] ?? undefined) : undefined
        }
      />
      {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}
      {settingsOpen && (
        <SettingsModal
          theme={theme}
          setTheme={setTheme}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}