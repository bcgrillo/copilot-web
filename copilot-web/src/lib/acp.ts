/**
 * Cliente ACP (Agent Client Protocol) para el agente `copilot --acp --port`.
 *
 * `copilot --acp --port N` sirve JSON-RPC 2.0 NDJSON sobre TCP crudo
 * (protocolo idéntico a modo stdio; verificado en copilot 1.0.80 aunque
 * --help no liste el flag). Este módulo mantiene UN socket persistente a
 * un proceso agente independiente (detached): al reiniciar la app Next, el
 * agente y sus sesiones ACP siguen vivos y se retoman con session/load.
 */
import net from "net";
import { spawn } from "child_process";

export const CHAT_CWD = process.env.CHAT_CWD || "/workspace";
const ACP_PORT = Number(process.env.ACP_PORT || 3222);
/** argumentos extra/override para el spawn del daemon (por el launcher CLI);
 * "" = sin flags (el CLI pregunta permisos por ACP y la web los resuelve con
 * las cards allow/deny); "allow-all" se conserva como compat del POC antiguo. */
const RAW_ARGS = process.env.COPILOT_ACP_ARGS || "";
const COPILOT_ARGS =
  RAW_ARGS.trim() === "allow-all"
    ? ["--allow-all-tools", "--allow-all-paths", "--allow-all-urls"]
    : RAW_ARGS.split(" ").map((s) => s.trim()).filter(Boolean);

type JsonRpcMsg = {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

type Agent = {
  sock: net.Socket | null;
  pending: Map<number, (m: JsonRpcMsg) => void>;
  known: Set<string>; // sesiones creadas/cargadas en ESTA conexión
  loading: Set<string>; // session/load en vuelo (replay del histórico)
  idSeq: number;
  connecting: Promise<void> | null;
  initDone: boolean;
};

// Con globalThis sobrevive a la recarga de módulos de Next
const g = globalThis as unknown as { __acpAgent?: Agent };
const agent: Agent =
  g.__acpAgent ?? (g.__acpAgent = {
    sock: null,
    pending: new Map(),
    known: new Set(),
    loading: new Set(),
    idSeq: 1,
    connecting: null,
    initDone: false,
  });

const updateListeners = new Map<string, Set<(update: AcpUpdate) => void>>();

// Cache de comandos slash por sesión (snapshot available_commands_update):
// sobrevive a la recarga de módulos de Next vía globalThis
type CmdCache = {
  bySession: Map<string, AvailableCommand[]>;
  last: AvailableCommand[];
};
const gc = globalThis as unknown as { __acpCmdCache?: CmdCache };
const cmdCache: CmdCache =
  gc.__acpCmdCache ??
  (gc.__acpCmdCache = { bySession: new Map(), last: [] });

// Permisos interactivos: la web muestra una card y el turno espera la
// respuesta del usuario. Sin auto-concesión por timer NI fallback de
// aprobación al morir el stream: un permiso nunca se resuelve solo
// (decisión de seguridad del producto).
type PendingPerm = {
  sessionId: string;
  allowId: string;
  denyId: string;
  toolCallId?: string;
  title?: string;
  /** opciones crudas que ofreció el agente (p.ej. allow_once/always, reject_once) */
  options: { optionId: string; kind: string; name?: string }[];
  timer?: ReturnType<typeof setTimeout>;
  respond: (optionId: string) => void;
};
const gPerms = globalThis as unknown as { __acpPerms?: Map<number, PendingPerm> };
const pendingPerms = gPerms.__acpPerms ?? (gPerms.__acpPerms = new Map());

/**
 * Permiso pendiente de una sesión (para volver a mostrar la card tras un
 * reload/corte del stream, vía el 429 "busy" del chat). Nunca resuelve nada.
 */
export function pendingPermissionFor(
  sessionId: string
): {
  reqId: number;
  title: string;
  toolCallId?: string;
  options?: { optionId: string; kind: string; name?: string }[];
} | null {
  for (const [reqId, p] of pendingPerms) {
    if (p.sessionId !== sessionId) continue;
    return {
      reqId,
      title: p.title ?? "tool",
      toolCallId: p.toolCallId,
      options: p.options,
    };
  }
  return null;
}

function emitPermission(sid: string, u: AcpUpdate & { reqId?: number }) {
  // el log de sesión también recibe los eventos sintéticos de permiso:
  // así la materialización conserva la meta (denegado...) aunque el
  // replay del CLI no la incluya
  logUpdate(sid, u as AcpUpdate);
  for (const cb of updateListeners.get(sid) ?? []) cb(u);
}

/**
 * Turno en vuelo por sesión (memoria del server, no persiste). Fuente única
 * para el 429 "busy" del chat y para que el GET de sesión exponga `running`
 * (turno vivo en el daemon aunque el stream del cliente haya muerto).
 */
const gRunning = globalThis as unknown as {
  __acpRunning?: Set<string>;
};
export const runningTurns: Set<string> =
  gRunning.__acpRunning ?? (gRunning.__acpRunning = new Set());

/**
 * Log por sesión de updates ACP (replay de session/load + updates en vivo
 * + eventos sintéticos de permiso), en RAM. Fuente única de materialización
 * del histórico: el equivalente ligero del events.jsonl del CLI, pero SOLO
 * por canal ACP (no se lee ningún fichero del CLI).
 */
const gLog = globalThis as unknown as {
  __acpSessionLog?: Map<string, AcpUpdate[]>;
};
/** Chunk "Info: <ruta>" que el daemon ACP inyecta como texto tras crear o
 * editar un fichero: duplica lo que ya enseña el chip de la tool, así que se
 * oculta en presentación (vivo y materialize) sin alterar el stream. */
export const DAEMON_INFO_RE = /^Info:\s*\S+\s*$/;

export const sessionLog: Map<string, AcpUpdate[]> =
  gLog.__acpSessionLog ?? (gLog.__acpSessionLog = new Map());

const LOG_MAX_UPDATES = 5000;
const LOG_MAX_SESSIONS = 100;

function logUpdate(sid: string, u: AcpUpdate, stampTs = false) {
  if (!sid) return;
  let arr = sessionLog.get(sid);
  if (!arr) {
    if (sessionLog.size >= LOG_MAX_SESSIONS) {
      const oldest = sessionLog.keys().next().value;
      if (oldest) sessionLog.delete(oldest);
    }
    sessionLog.set(sid, (arr = []));
  }
  arr.push(stampTs ? { ...u, ts: new Date().toISOString() } : u);
  if (arr.length > LOG_MAX_UPDATES)
    sessionLog.set(sid, (arr = arr.slice(-LOG_MAX_UPDATES)));
}

export function getSessionLog(sessionId: string): AcpUpdate[] | undefined {
  return sessionLog.get(sessionId);
}

export function resetSessionLog(sessionId: string) {
  sessionLog.delete(sessionId);
}

/**
 * Garantiza el log de una sesión: si no existe, la carga (session/load,
 * que replaya el histórico completo como updates y se captura aquí).
 */
export async function materializeSession(sessionId: string): Promise<void> {
  if (sessionLog.has(sessionId)) return;
  if (agent.known.has(sessionId)) {
    sessionLog.set(sessionId, sessionLog.get(sessionId) ?? []);
    return;
  }
  await loadSession(sessionId);
}

import type { AvailableCommand } from "@/lib/types";

export type AcpUpdate = {
  sessionUpdate: string;
  /** sellado de hora de llegada SOLO en updates en vivo (cache RAM);
   * el replay de session/load no lo trae (ACP no da timestamps) */
  ts?: string;
  [k: string]: unknown;
};

function dial(): Promise<net.Socket> {
  return new Promise((ok, no) => {
    const s = net.connect(ACP_PORT, "127.0.0.1");
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        try { s.destroy(); } catch {}
        no(new Error("econnrefused"));
      }
    }, 900);
    s.once("connect", () => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        ok(s);
      }
    });
    s.once("error", () => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        try { s.destroy(); } catch {}
        no(new Error("econnrefused"));
      }
    });
  });
}

function wireSocket(s: net.Socket) {
  let buf = "";
  s.on("data", (c: Buffer) => {
    buf += c.toString("utf-8");
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let m: JsonRpcMsg;
      try {
        m = JSON.parse(line) as JsonRpcMsg;
      } catch {
        continue;
      }
      if (m.id && agent.pending.has(m.id)) {
        const cb = agent.pending.get(m.id);
        agent.pending.delete(m.id);
        cb?.(m);
      } else if (m.method === "session/update") {
        const params = (m.params ?? {}) as { sessionId?: string; update?: AcpUpdate };
        const sid = params.sessionId ?? "";
        const u = params.update ?? { sessionUpdate: "unknown" };
        // log por sesión para materialización: replay (en carga) y updates
        // en vivo de sesiones que ya conocemos
        if (agent.loading.has(sid)) logUpdate(sid, u); // replay: sin hora
        else if (agent.known.has(sid)) logUpdate(sid, u, true); // vivo: sella llegada
        // snapshot de comandos slash: cacheamos por sesión (y global como
        // semilla para sesiones cargadas cuyo replay no incluya snapshot)
        if (u.sessionUpdate === "available_commands_update") {
          const cmds = (u.availableCommands ?? []) as AvailableCommand[];
          if (cmds.length && sid) {
            cmdCache.bySession.set(sid, cmds);
            cmdCache.last = cmds;
          }
        }
        for (const cb of updateListeners.get(sid) ?? []) cb(u);
      } else if (m.method === "session/request_permission") {
        const p = (m.params ?? {}) as {
          sessionId?: string;
          kind?: string;
          toolCall?: { title?: string; toolCallId?: string };
          options?: { optionId?: string; kind?: string; name?: string }[];
        };
        const reqId = typeof m.id === "number" ? m.id : -1;
        const title = p.toolCall?.title || p.kind || "tool";
        // opciones tal y como las ofrece el agente (allow_once/allow_always/
        // reject_once/reject_always...): la web pinta cada una y devuelve el
        // optionId elegido
        const options: { optionId: string; kind: string; name?: string }[] =
          (p.options ?? [])
            .filter((o) => o && o.optionId && o.kind)
            .map((o) => ({ optionId: o.optionId!, kind: o.kind!, name: o.name }));
        // IDs de las opciones que envía el agente (allow / reject), para el
        // atajo booleano (compat y fallback si el agente no lista opciones)
        const allowId =
          p.options?.find((o) => o.kind === "allow_once" || o.kind === "allow_always")
            ?.optionId ?? "allow_once";
        const denyId =
          p.options?.find((o) => o.kind?.startsWith("reject"))?.optionId ??
          "reject_once";
        // ResultPermission ACP: { outcome: { outcome: "selected", optionId } }
        const respond = (optionId: string) => {
          try {
            s.write(
              JSON.stringify({
                jsonrpc: "2.0",
                id: m.id,
                result: {
                  outcome: { outcome: "selected", optionId, choice: optionId },
                },
              }) + "\n"
            );
          } catch {}
        };
        // sin id de petición (caso raro): no hay forma de responder → el
        // permiso queda pendiente en el daemon; NUNCA se autoriza solo
        if (reqId < 0) {
          // noop deliberado: seguridad primero (decisión de producto)
        } else {
          pendingPerms.set(reqId, {
            sessionId: p.sessionId ?? "",
            allowId,
            denyId,
            options,
            toolCallId: p.toolCall?.toolCallId,
            title,
            respond,
          });
          emitPermission(p.sessionId ?? "", {
            sessionUpdate: "permission_request",
            reqId,
            title,
            toolCallId: p.toolCall?.toolCallId,
            options,
          });
        }
      } else if (m.id && m.method) {
        try {
          s.write(
            JSON.stringify({
              jsonrpc: "2.0",
              id: m.id,
              error: { code: -32601, message: "method not supported: " + m.method },
            }) + "\n"
          );
        } catch {}
      }
    }
  });
  s.on("close", () => {
    if (agent.sock === s) agent.sock = null;
    agent.initDone = false;
    for (const [, cb] of agent.pending) cb({ jsonrpc: "2.0", error: { code: -32000, message: "ACP agent gone" } });
    agent.pending.clear();
    agent.known.clear();
    agent.loading.clear();
  });
  s.on("error", () => {});
}

/** Conecta (y si hace falta, lanza) el proceso agente. */
export function ensureAgent(): Promise<void> {
  if (agent.sock && !agent.sock.destroyed && agent.initDone) return Promise.resolve();
  if (agent.connecting) return agent.connecting;
  agent.connecting = (async () => {
    let s: net.Socket | null = null;
    try {
      s = await dial();
    } catch {
      try {
        const d = spawn(
          "copilot",
          ["--acp", "--port", String(ACP_PORT), ...COPILOT_ARGS],
          { detached: true, stdio: "ignore" }
        );
        d.unref();
      } catch {}
      const t0 = Date.now();
      while (!s && Date.now() - t0 < 20000) {
        await new Promise((r) => setTimeout(r, 400));
        try {
          s = await dial();
        } catch {}
      }
    }
    if (!s) throw new Error(`could not connect to ACP agent :${ACP_PORT}`);
    agent.sock = s;
    wireSocket(s);
    await acpRequest("initialize", { protocolVersion: 1, clientCapabilities: {} });
    agent.initDone = true;
  })();
  agent.connecting = agent.connecting.finally(() => {
    agent.connecting = null;
  });
  return agent.connecting;
}

export function acpRequest(method: string, params: unknown): Promise<{ error?: JsonRpcMsg["error"]; result?: unknown }> {
  return new Promise((resolve) => {
    if (!agent.sock || agent.sock.destroyed) {
      resolve({ error: { code: -32000, message: "ACP agent not connected" } });
      return;
    }
    const id = agent.idSeq++;
    agent.pending.set(id, (m) => resolve(m.error ? { error: m.error } : { result: m.result }));
    agent.sock.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

export type AgentSessionInfo = {
  sessionId: string;
  title?: string;
  updatedAt?: string;
  cwd?: string;
};

/** Lista oficial de sesiones del agente (sessionCapabilities.list, ACP). */
export async function listAgentSessions(): Promise<AgentSessionInfo[]> {
  await ensureAgent();
  const r = await acpRequest("session/list", {});
  if (r.error) throw new Error(r.error.message || "session/list error");
  const res = r.result as { sessions?: AgentSessionInfo[] } | undefined;
  return res?.sessions ?? [];
}

/** Comandos slash disponibles de la sesión (fallback: último snapshot global). */
export function listAvailableCommands(sessionId?: string): AvailableCommand[] {
  return (sessionId && cmdCache.bySession.get(sessionId)) || cmdCache.last;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let probeInFlight: Promise<void> | null = null;

/**
 * Bootstrap del snapshot de comandos tras un reinicio del servidor web: el
 * cache es in-memory y el daemon solo lo manda en session/new → una sesión
 * desechable repuebla cmdCache (las sesiones sin turnos no salen en
 * session/list, no ensucia la sidebar).
 */
export async function ensureCommands(): Promise<AvailableCommand[]> {
  if (cmdCache.last.length) return cmdCache.last;
  if (!probeInFlight)
    probeInFlight = (async () => {
      try {
        await createAgentSession();
        for (let i = 0; i < 20 && !cmdCache.last.length; i++) await sleep(100);
      } catch {
        /* daemon no disponible: paleta vacía hasta el próximo turno vivo */
      }
    })();
  await probeInFlight;
  probeInFlight = null;
  return cmdCache.last;
}

/** Crea una sesión ACP y devuelve su id (el mismo que usa el agente). */
export async function createAgentSession(): Promise<string> {
  await ensureAgent();
  const r = await acpRequest("session/new", { cwd: CHAT_CWD, mcpServers: [] });
  if (r.error) throw new Error("session/new: " + (r.error.message || JSON.stringify(r.error)));
  const sessionId = (r.result as { sessionId?: string })?.sessionId;
  if (!sessionId) throw new Error("session/new: respuesta sin sessionId");
  agent.known.add(sessionId);
  sessionLog.set(sessionId, sessionLog.get(sessionId) ?? []);
  return sessionId;
}

/**
 * Carga una sesión existente en el agente (contexto). Si la sesión ya está
 * materializada el agente responde "already loaded": éxito. La respuesta
 * replaya el histórico como updates → quien suscriba debe filtrar por
 * loadingIds (ver subscribe). El replay se captura en sessionLog (el log
 * previo se descarta: el replay reemplaza cualquier materialización parcial).
 */
async function loadSession(sessionId: string): Promise<void> {
  sessionLog.delete(sessionId);
  agent.loading.add(sessionId);
  try {
    const r = await acpRequest("session/load", { cwd: CHAT_CWD, sessionId, mcpServers: [] });
    const lerr = r.error && String(r.error.message || "");
    if (r.error && !/already loaded/i.test(lerr ?? "")) {
      throw new Error("session/load: " + (lerr || JSON.stringify(r.error)));
    }
    agent.known.add(sessionId);
  } finally {
    agent.loading.delete(sessionId);
  }
}

export function subscribeUpdates(sessionId: string, cb: (u: AcpUpdate) => void): () => void {
  let set = updateListeners.get(sessionId);
  if (!set) updateListeners.set(sessionId, (set = new Set()));
  set.add(cb);
  return () => {
    set!.delete(cb);
    if (set!.size === 0) updateListeners.delete(sessionId);
  };
}

export function isLoading(sessionId: string): boolean {
  return agent.loading.has(sessionId);
}

/** session/prompt con re-load lazy del contexto si hace falta.
 * userText: texto del usuario real (chat) — el daemon no ecoa
 * user_message_chunk en vivo (solo en el replay de session/load), así que
 * lo registramos sintéticamente en el sessionLog para materializar la
 * burbuja caliente. loadSession limpia el log antes del replay, así que
 * nunca duplica. Las inyecciones slash (rename/delete) NO lo pasan. */
export async function prompt(
  sessionId: string,
  blocks: unknown[],
  userText?: string
) {
  await ensureAgent();
  if (!agent.known.has(sessionId)) await loadSession(sessionId);
  const t = userText?.trim();
  if (t)
    logUpdate(
      sessionId,
      {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: t },
        ts: new Date().toISOString(),
      } as AcpUpdate
    );
  return acpRequest("session/prompt", { sessionId, prompt: blocks });
}

export async function cancelSession(sessionId: string): Promise<void> {
  if (!agent.sock || agent.sock.destroyed) return;
  if (!agent.known.has(sessionId)) return;
  // notification: sin id, sin respuesta
  agent.sock.write(JSON.stringify({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId } }) + "\n");
}

export async function closeAgentSession(sessionId: string): Promise<void> {
  if (!agent.sock || agent.sock.destroyed || !agent.known.has(sessionId)) return;
  await acpRequest("session/close", { sessionId, mcpServers: [] });
  agent.known.delete(sessionId);
}

/** Sesión ops dedicada para comandos slash de gestión (delete/rename...). */
const gOps = globalThis as unknown as {
  __acpOpsSid?: string;
  __acpOpsChain?: Promise<unknown>;
};

async function opsSession(): Promise<string> {
  if (gOps.__acpOpsSid && agent.known.has(gOps.__acpOpsSid))
    return gOps.__acpOpsSid;
  gOps.__acpOpsSid = await createAgentSession();
  return gOps.__acpOpsSid;
}

/**
 * prompt de administración en la sesión ops, serializado (un comando en
 * vuelo a la vez). Las sesiones sin turnos no salen en session/list (el
 * CLI no las lista), así que la sesión ops no contamina la sidebar.
 */
export function adminPrompt(text: string): Promise<{
  error?: { code: number; message: string };
  result?: unknown;
}> {
  const chain = (gOps.__acpOpsChain ?? Promise.resolve()).then(async () => {
    await ensureAgent();
    const sid = await opsSession();
    return prompt(sid, [{ type: "text", text }]);
  });
  gOps.__acpOpsChain = chain.then(
    () => undefined,
    () => undefined
  );
  return chain;
}

/** Responde una solicitud de permiso pendiente desde la web.
 * decision: boolean (atajo allow/deny, compat) o el optionId exacto que
 * ofreció el agente (allow_always, reject_once, ...). */
export function respondPermission(
  reqId: number,
  decision: boolean | string
): { ok: boolean; reason?: "not-found" | "invalid-option" } {
  const p = pendingPerms.get(reqId) as PendingPerm | undefined;
  if (!p) return { ok: false, reason: "not-found" };
  let choice: string;
  if (typeof decision === "string") {
    if (!p.options.some((o) => o.optionId === decision))
      return { ok: false, reason: "invalid-option" };
    choice = decision;
  } else {
    choice = decision ? p.allowId : p.denyId;
  }
  pendingPerms.delete(reqId);
  clearTimeout(p.timer);
  emitPermission(p.sessionId, {
    sessionUpdate: "permission_resolved",
    reqId,
    choice,
    toolCallId: p.toolCallId,
    auto: false,
  });
  p.respond(choice);
  return { ok: true };
}