/**
 * ACP (Agent Client Protocol) client for the `copilot --acp --port` agent.
 *
 * `copilot --acp --port N` serves JSON-RPC 2.0 NDJSON over raw TCP
 * (protocol identical to the stdio mode; verified against copilot 1.0.80
 * even though --help does not list the flag). This module keeps ONE
 * persistent socket to a standalone agent process (detached): when the Next
 * app restarts, the agent and its ACP sessions stay alive and resume via
 * session/load.
 */
import net from "net";
import { spawn } from "child_process";
import type { AvailableCommand } from "@/lib/types";

export const CHAT_CWD = process.env.CHAT_CWD || "/workspace";
const ACP_PORT = Number(process.env.ACP_PORT || 3222);
/** Extra/override args for the daemon daemon spawn (from the launcher CLI);
 * "" = no flags (the CLI asks permissions over ACP and the web resolves them
 * with allow/deny cards); "allow-all" is kept as legacy POC compatibility. */
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
  known: Set<string>; // sessions created/loaded in THIS connection
  loading: Set<string>; // session/load in flight (history replay)
  idSeq: number;
  connecting: Promise<void> | null;
  initDone: boolean;
};

// globalThis makes these singletons survive Next module reloads
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

// Slash-command cache per session (available_commands_update snapshot):
// survives Next module reloads via globalThis
type CmdCache = {
  bySession: Map<string, AvailableCommand[]>;
  last: AvailableCommand[];
};
const gc = globalThis as unknown as { __acpCmdCache?: CmdCache };
const cmdCache: CmdCache =
  gc.__acpCmdCache ??
  (gc.__acpCmdCache = { bySession: new Map(), last: [] });

// Interactive permissions: the web shows a card and the turn waits for the
// user's answer. No auto-grant timers and no auto-approval when the stream
// dies: a permission never resolves itself (product security decision).
type PendingPerm = {
  sessionId: string;
  allowId: string;
  denyId: string;
  toolCallId?: string;
  title?: string;
  /** raw options offered by the agent (e.g. allow_once/always, reject_once) */
  options: { optionId: string; kind: string; name?: string }[];
  respond: (optionId: string) => void;
};
const gPerms = globalThis as unknown as { __acpPerms?: Map<number, PendingPerm> };
const pendingPerms = gPerms.__acpPerms ?? (gPerms.__acpPerms = new Map());

/**
 * Pending permission of a session (to re-show the card after a
 * reload/stream cut, via the chat 429 "busy"). Never resolves anything.
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
  // the session log also receives the synthetic permission events: that way
  // materialization keeps the metadata (denied…) even when the CLI replay
  // does not include it
  logUpdate(sid, u as AcpUpdate);
  for (const cb of updateListeners.get(sid) ?? []) cb(u);
}

/**
 * Turn in flight per session (server memory, never persisted). Single source
 * for the chat 429 "busy" and for the session GET to expose `running` (live
 * turn in the daemon even when the client stream died).
 */
const gRunning = globalThis as unknown as {
  __acpRunning?: Set<string>;
};
export const runningTurns: Set<string> =
  gRunning.__acpRunning ?? (gRunning.__acpRunning = new Set());

/**
 * Per-session log of ACP updates (session/load replay + live updates +
 * synthetic permission events), in RAM. Single source for history
 * materialization: the lightweight equivalent of the CLI's events.jsonl, but
 * ACP channel ONLY (no CLI files are ever read).
 */
const gLog = globalThis as unknown as {
  __acpSessionLog?: Map<string, AcpUpdate[]>;
};
/** "Info: <path>" chunk the ACP daemon injects as text after creating or
 * editing a file: duplicates what the tool chip already shows, so it is
 * hidden at presentation layer (live and materialize) without touching the
 * stream. */
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
 * Makes sure a session has a log: if not, loads it (session/load, which
 * replays the whole history as updates and gets captured here).
 */
export async function materializeSession(sessionId: string): Promise<void> {
  if (sessionLog.has(sessionId)) return;
  if (agent.known.has(sessionId)) {
    sessionLog.set(sessionId, sessionLog.get(sessionId) ?? []);
    return;
  }
  await loadSession(sessionId);
}


export type AcpUpdate = {
  sessionUpdate: string;
  /** arrival timestamp, stamped ONLY on live updates (RAM cache);
   * the session/load replay does not include it (ACP has no timestamps) */
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
        // per-session log for materialization: replay (at load) and live
        // updates of sessions we already know
        if (agent.loading.has(sid)) logUpdate(sid, u); // replay: no timestamp
        else if (agent.known.has(sid)) logUpdate(sid, u, true); // live: stamped
        // slash-command snapshot: cached per session (and globally as a seed
        // for loaded sessions whose replay lacks a snapshot)
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
        // options as offered by the agent (allow_once/allow_always/
        // reject_once/reject_always…): the web renders each one and sends
        // back the chosen optionId
        const options: { optionId: string; kind: string; name?: string }[] =
          (p.options ?? [])
            .filter((o) => o && o.optionId && o.kind)
            .map((o) => ({ optionId: o.optionId!, kind: o.kind!, name: o.name }));
        // ids of the boolean shortcuts the agent sends (allow / reject), for
        // the legacy allow/deny shortcut (and fallback when no options list)
        const allowId =
          p.options?.find((o) => o.kind === "allow_once" || o.kind === "allow_always")
            ?.optionId ?? "allow_once";
        const denyId =
          p.options?.find((o) => o.kind?.startsWith("reject"))?.optionId ??
          "reject_once";
        // ACP ResultPermission: { outcome: { outcome: "selected", optionId } }
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
        // no request id (rare): there is no way to answer → the permission
        // stays pending in the daemon. It is NEVER auto-authorized
        if (reqId < 0) {
          // deliberate noop: safety first (product decision)
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

/** Connects (and spawns if needed) the agent process. */
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

/** Official list of the agent's sessions (sessionCapabilities.list, ACP). */
export async function listAgentSessions(): Promise<AgentSessionInfo[]> {
  await ensureAgent();
  const r = await acpRequest("session/list", {});
  if (r.error) throw new Error(r.error.message || "session/list error");
  const res = r.result as { sessions?: AgentSessionInfo[] } | undefined;
  return res?.sessions ?? [];
}

/** Slash commands available for the session (fallback: last global snapshot). */
export function listAvailableCommands(sessionId?: string): AvailableCommand[] {
  return (sessionId && cmdCache.bySession.get(sessionId)) || cmdCache.last;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let probeInFlight: Promise<void> | null = null;

/**
 * Bootstraps the command snapshot after a web server restart: the cache is
 * in-memory and the daemon only sends it on session/new → a throwaway
 * session repopulates cmdCache (zero-turn sessions do not show up in
 * session/list, so the sidebar stays clean).
 */
export async function ensureCommands(): Promise<AvailableCommand[]> {
  if (cmdCache.last.length) return cmdCache.last;
  if (!probeInFlight)
    probeInFlight = (async () => {
      try {
        await createAgentSession();
        for (let i = 0; i < 20 && !cmdCache.last.length; i++) await sleep(100);
      } catch {
        /* daemon unavailable: empty palette until the next live turn */
      }
    })();
  await probeInFlight;
  probeInFlight = null;
  return cmdCache.last;
}

/** Creates an ACP session and returns its id (the same one the agent uses). */
export async function createAgentSession(): Promise<string> {
  await ensureAgent();
  const r = await acpRequest("session/new", { cwd: CHAT_CWD, mcpServers: [] });
  if (r.error) throw new Error("session/new: " + (r.error.message || JSON.stringify(r.error)));
  const sessionId = (r.result as { sessionId?: string })?.sessionId;
  if (!sessionId) throw new Error("session/new: response without sessionId");
  agent.known.add(sessionId);
  sessionLog.set(sessionId, sessionLog.get(sessionId) ?? []);
  return sessionId;
}

/**
 * Loads an existing session into the agent (context). If the session is
 * already materialized the agent answers "already loaded": success. The
 * response replays the history as updates → whoever subscribes must filter
 * by loadingIds (see subscribe). The replay is captured into sessionLog
 * (the previous log is discarded: the replay replaces any partial
 * materialization).
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

/** session/prompt with lazy context reload if needed.
 * userText: the real user (chat) text — the daemon does not echo
 * user_message_chunk live (only in the session/load replay), so we register
 * it synthetically in the sessionLog to materialize the hot bubble.
 * loadSession clears the log before the replay, so it never duplicates.
 * Slash injections (rename/delete) do NOT pass it. */
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

/** Dedicated ops session for slash management commands (delete/rename…). */
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
 * Admin prompt on the ops session, serialized (one command in flight at a
 * time). Zero-turn sessions do not show up in session/list (the CLI does
 * not list them), so the ops session never pollutes the sidebar.
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

/** Answers a pending permission request from the web.
 * decision: boolean (allow/deny shortcut, legacy) or the exact optionId
 * offered by the agent (allow_always, reject_once, …). */
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