"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CircleHelp, Moon, Sun, SunMoon } from "lucide-react";
import Sidebar from "@/components/Sidebar";
import Chat from "@/components/Chat";
import { apiUrl } from "@/lib/api";
import { LangProvider, useT } from "@/lib/i18n";
import type {
  Attachment,
  AvailableCommand,
  ChatMessage,
  LiveTurn,
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
  const [loaded, setLoaded] = useState(false);
  // hidratación de sesión en vuelo (spinner en vez de landing al abrir)
  const [loadingIds, setLoadingIds] = useState<Record<string, boolean>>({});
  // permiso "sticky": card de un permiso pendiente cuyo stream murió
  // (reload/navegación). NUNCA se autoriza solo: se re-muestra hasta que
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
  // sesiones con turno zombi que esta página está sondeando (1 por sesión)
  const pollRef = useRef<Set<string>>(new Set());
  // mensajes en cola (429 por permiso) a reenviar cuando su sesión quede idle
  const retryAfterPollRef = useRef<
    Map<string, { sessionId: string; text: string; attachments?: Attachment[] }>
  >(new Map());
  // latest-ref de send: startPoll se declara antes que send pero necesita
  // reenviar la cola cuando el turno zombi termina
  const sendRef = useRef<
    (text: string, attachments?: Attachment[], targetId?: string) => unknown
  >(() => {});
  // tema tri-estado: auto (sistema), light o dark; lo aplica el script
  // themeInit del layout ANTES de hidratar; aquí se persiste el ciclo
  const [theme, setTheme] = useState<"auto" | "light" | "dark">("auto");
  const [menuOpen, setMenuOpen] = useState(false); // drawer de sesiones (mobile)
  // comandos slash cacheados por sesión (paleta del composer)
  const [commands, setCommands] = useState<Record<string, AvailableCommand[]>>({});
  const abortRef = useRef<AbortController | null>(null);

  const t = useT();
  const loadSessions = useCallback(async (): Promise<SessionSummary[]> => {
    const res = await fetch(apiUrl("/api/sessions"));
    const data = await res.json();
    // el servidor devuelve la lista ordenada por última actividad
    return data.sessions as SessionSummary[];
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
  }, [theme]);

  useEffect(() => {
    (async () => {
      try {
        let data = await loadSessions();
        if (data.length === 0) {
          const res = await fetch(apiUrl("/api/sessions"), { method: "POST" });
          data = [(await res.json()).session];
        }
        setSessions(data);
        // abrir la última activa: prioridad ?s=<id> en la URL (deep-link),
        // luego la que vimos por última vez, si no la más reciente
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
  }, []);

  // la URL siempre refleja la sesión abierta (?s=<id>) para poder compartir
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
      const res = await fetch(apiUrl(`/api/commands/${id}`));
      const { commands: cmds } = (await res.json()) as {
        commands?: AvailableCommand[];
      };
      if (Array.isArray(cmds) && cmds.length)
        setCommands((prev) => ({ ...prev, [id]: cmds }));
    } catch {
      /* la sesión sin snapshot usará el último del cache del servidor */
    }
  }, []);

  /**
   * Sondeo del turno zombi: el daemon sigue procesando aunque el stream
   * SSE de esta pestaña haya muerto (reload, navegación). Refresca mensajes
   * y permiso sticky cada 1.5 s hasta que el server reporta idle.
   */
  const startPoll = useCallback(
    (id: string) => {
      if (pollRef.current.has(id)) return;
      pollRef.current.add(id);
      setRunningIds((prev) => ({ ...prev, [id]: true }));
      const tick = async () => {
        try {
          const res = await fetch(apiUrl(`/api/sessions/${id}`));
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
        // ¿había un mensaje en cola esperando a que esta sesión quedara idle?
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
   * Hidrata el contenido de una sesión bajo demanda: los metadatos están en
   * la lista; los mensajes solo se traen de la API cuando la sesión se abre
   * o termina de procesar (materialización por canal ACP en el server).
   */
  const hydrateDetail = useCallback(async (id: string) => {
    setLoadingIds((prev) => ({ ...prev, [id]: true }));
    try {
      const res = await fetch(apiUrl(`/api/sessions/${id}`));
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
      // permiso pendiente sin stream: re-mostrar card (sin auto-autorización)
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

  // paleta slash: carga en CUALQUIER activación de sesión (entrada con
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
    try {
      localStorage.setItem("lastSession", id);
    } catch {}
    setError(null);
  };

  const activeSession = sessions.find((s) => s.id === activeId) ?? null;
  const liveTurn = activeId ? (liveTurns[activeId] ?? undefined) : undefined;

  function patchMessages(sessionId: string, updater: (msgs: ChatMessage[]) => ChatMessage[]) {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId ? { ...s, messages: updater(s.messages ?? []) } : s
      )
    );
  }

  const createSession = useCallback(async () => {
    const res = await fetch(apiUrl("/api/sessions"), { method: "POST" });
    const { session } = await res.json();
    setSessions((prev) => [session, ...prev]);
    setActiveId(session.id);
    // la sesión acaba de nacer en el daemon: ya tiene snapshot de comandos
    // (loadCommands corre en el efecto de activeId)
    try {
      localStorage.setItem("lastSession", session.id);
    } catch {}
    setError(null);
  }, []);

  const renameSession = useCallback(async (id: string, name: string) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, name } : s)));
    try {
      const res = await fetch(apiUrl(`/api/sessions/${id}`), {
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
    // concilia con el servidor: reverte el optimismo si el CLI falló
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
      const res = await fetch(apiUrl(`/api/sessions/${id}`), { method: "DELETE" });
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
      // la sesión sigue viva (el CLI no la borró): conciliar y volver a ella
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

      const now = new Date().toISOString();
      patchMessages(sessionId, (msgs) => [
        ...msgs,
        { id: `local-${now}`, role: "user", content: text, ts: now },
      ]);
      setRunningIds((prev) => ({ ...prev, [sessionId]: true }));

      const ac = new AbortController();
      abortRef.current = ac;

      try {
        const res = await fetch(apiUrl("/api/chat"), {
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
          // 429 busy: la sesión tiene un turno anterior pendiente de un
          // permiso. Sin auto-autorización: re-mostramos la card y dejamos
          // el texto listo para reintentarlo cuando el usuario responda.
          if (res.status === 429 && data.busy) {
            if (data.pending) {
              // turno anterior pendiente de un permiso: re-mostrar card y
              // dejar el mensaje en cola para reenviar al responder
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
              setError(t("err.busyPerm"));
              return;
            }
            // busy sin permiso: el turno anterior está terminando. Reintento
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

        // éxito real: el mensaje se entregó; anula cualquier reintento en cola
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
              if (lastP && lastP.kind === "reasoning") lastP.content += c;
              else turn.parts.push({ kind: "reasoning", content: c });
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
                    title: denied ? `${p.title} (denegado)` : p.title,
                    status: denied ? "error" : "completed",
                  };
                  break;
                }
                // el tool real al que aplicaba el permiso, si llegó el id
                if (
                  d.toolCallId &&
                  p.toolCallId === d.toolCallId &&
                  p.status === "pending"
                ) {
                  turn.parts[i] = {
                    ...p,
                    title: denied ? `${p.title} (denegado)` : p.title,
                    status: denied ? "error" : "completed",
                  };
                  break;
                }
                if (p.status === "pending" && denied) {
                  turn.parts[i] = { ...p, title: `${p.title} (denegado)`, status: "error" };
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

  /** click en una opción concreta de la card de permiso (o atajo booleano).
   * optionId: si viene, enviamos la elección exacta (allow_always...). */
  const respondPermission = useCallback(
    async (reqId: number, allow: boolean, optionId?: string) => {
      // ¿la card era del turno LIVE (SSE local, el stream trae la resolución)
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
        const res = await fetch(apiUrl("/api/permission"), {
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
          // daemon termine; el sondeo del sticky dispara el reenvío al ver
          // la sesión idle (retryAfterPoll, una cola por sesión).
          retryAfterPollRef.current.set(retry.sessionId, retry);
        }
      } catch {}
    },
    [startPoll, stickyPerms, liveTurns, t]
  );

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
          <div className="flex items-center justify-end gap-1.5">
            <Link
              href="/about"
              className="flex h-8 cursor-pointer items-center justify-center rounded-lg border border-border px-2.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title={t("footer.helpTitle")}
            >
              <CircleHelp className="h-3.5 w-3.5" />
            </Link>
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
          </div>
        }
        sessions={sessions}
        activeId={activeId}
        runningIds={runningIds}
        onSelect={selectSession}
        onCreate={createSession}
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
        stickyPermission={
          activeId ? (stickyPerms[activeId] ?? undefined) : undefined
        }
      />

    </div>
  );
}