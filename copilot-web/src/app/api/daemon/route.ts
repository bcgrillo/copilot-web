/** Estado y reinicio del daemon ACP (Copilot CLI) — beta.
 * GET: ¿vive? pid/puerto/modelo leyendo /proc.
 * POST {action:"restart"}: mata el proceso y lo repite con argv/env EXACTOS del
 * /proc viejo (incluye helper MCP y flags del launcher) y espera a que responda. */
import net from "node:net";
import { spawn } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACP_PORT = Number(process.env.ACP_PORT || 3222);

function probe(port: number, timeout = 700): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1");
    let done = false;
    const end = (ok: boolean) => {
      if (done) return;
      done = true;
      try { s.destroy(); } catch {}
      resolve(ok);
    };
    const timer = setTimeout(() => end(false), timeout);
    s.once("connect", () => { clearTimeout(timer); end(true); });
    s.once("error", () => { clearTimeout(timer); end(false); });
  });
}

type DaemonInfo = { pid: number; model: string; args: string[]; env: string };

/** busca en /proc procesos con "copilot" + --acp + este puerto; devuelve el
 * MÁS EXTERNO (el launcher de node que engendra el binario real) con su
 * cmdline y environ ya saneados por el propio launcher. */
function findDaemon(): { pid: number; model: string; args: string[]; env: string } | null {
  try {
    const cands: { pid: number; exeIsNode: boolean; model: string; args: string[]; env: string }[] = [];
    for (const f of readdirSync("/proc")) {
      if (!/^\d+$/.test(f)) continue;
      let cmd = "";
      try {
        cmd = readFileSync(`/proc/${f}/cmdline`, "utf8");
      } catch { continue; }
      const parts = cmd.split("\0").filter(Boolean);
      if (!parts.length) continue;
      const exe = parts[0].split("/").pop() ?? "";
      const looksCopilot =
        exe.includes("copilot") ||
        parts[0].endsWith("copilot") ||
        (exe === "node" && parts[1]?.includes("copilot"));
      if (!looksCopilot) continue;
      const joined = parts.join(" ");
      if (!joined.includes("--acp") || !joined.includes(`--port ${ACP_PORT}`)) continue;
      // wrapper node <script> → args después del script; el binario real arranca directo
      const start = exe === "node" ? 2 : 1;
      const args = parts.slice(start);
      let env = "";
      try { env = readFileSync(`/proc/${f}/environ`, "utf8"); } catch {}
      let model = "";
      const m = env.match(/COPILOT_MODEL=([^\0]*)/);
      if (m) model = m[1];
      cands.push({ pid: Number(f), exeIsNode: exe === "node", model, args, env });
    }
    // el más externo (wrapper del launcher) es nuestro candidato: engendra al real
    const wrapper = cands.find((c) => c.exeIsNode);
    const best = wrapper ?? cands[0];
    if (!best) return null;
    return { pid: best.pid, model: best.model, args: best.args, env: best.env };
  } catch {
    return null;
  }
}

async function waitProbe(target: boolean, ms: number): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if ((await probe(ACP_PORT, 400)) === target) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

/** misma whitelist del launcher (bin/copilot-web.mjs): el CLI es sensible a
 * basura del entorno (COPILOT_LOADER_PID etc. rompen session/new). */
const DAEMON_ENV = [
  "PATH", "HOME", "SHELL", "LANG", "LC_ALL", "TERM", "TERM_PROGRAM", "TERM_PROGRAM_VERSION",
  "HOSTNAME", "TMPDIR",
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy",
  "COPILOT_MODEL",
];

/** rebuild del helper MCP como el launcher (ruta ask-user + web actual) */
function ensureHelperFile(): string | null {
  try {
    const webPort = Number(process.env.PORT || 3100);
    const helperFile = `/tmp/copilot-web-helper-${ACP_PORT}.json`;
    const mcpScript = `${process.cwd()}/mcp/ask-user.mjs`;
    readFileSync(mcpScript); // sin script no hay helper
    writeFileSync(
      helperFile,
      JSON.stringify({
        mcpServers: {
          "copilot-web-helper": {
            type: "local",
            command: "node",
            args: [mcpScript],
            env: { COPILOT_WEB_URL: `http://localhost:${webPort}` },
          },
        },
      })
    );
    return helperFile;
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const alive = await probe(ACP_PORT);
    const d = alive ? findDaemon() : null;
    return Response.json({
      alive,
      port: ACP_PORT,
      pid: d?.pid,
      model: d?.model || process.env.COPILOT_MODEL || "",
    });
  } catch {
    return Response.json({ alive: false, port: ACP_PORT });
  }
}

export async function POST(req: Request) {
  let action = "";
  try {
    const j = await req.json();
    action = String((j as { action?: string }).action ?? "");
  } catch {}
  if (action !== "restart") {
    return Response.json({ ok: false, error: "unsupported action" }, { status: 400 });
  }
  const old = findDaemon();
  if (!old) {
    return Response.json({ ok: false, error: "daemon not found" }, { status: 409 });
  }
  if (!(await waitProbe(true, 1000))) {
    return Response.json({ ok: false, error: "daemon not responding" }, { status: 409 });
  }
  // pueden ser 2 (wrapper node + binario real) → matar todos los del puerto,
  // incluidos helpers MCP ask-user huérfanos de rondas previas
  const victims: number[] = [];
  const mcpScript = `${process.cwd()}/mcp/ask-user.mjs`;
  try {
    for (const f of readdirSync("/proc")) {
      if (!/^\d+$/.test(f)) continue;
      try {
        const parts = readFileSync(`/proc/${f}/cmdline`, "utf8").split("\0").filter(Boolean);
        const joined = parts.join(" ");
        const isDaemon = joined.includes("--acp") && joined.includes(`--port ${ACP_PORT}`) &&
          parts.some((p) => /copilot/.test(p));
        const isHelper = joined.includes(mcpScript);
        if (isDaemon || isHelper) victims.push(Number(f));
      } catch {}
    }
  } catch {}
  for (const pid of victims) {
    try { process.kill(pid, "SIGTERM"); } catch {}
  }
  // el binario real apaga el listener: si sigue vivo, SIGKILL
  await waitProbe(false, 2000);
  if (await probe(ACP_PORT)) {
    for (const pid of victims) {
      try { process.kill(pid, "SIGKILL"); } catch {}
    }
    await waitProbe(false, 3000);
  }
  // respawn fiel a la intención del launcher: argv del /proc viejo + model y
  // helper MCP si faltan; env saneado con la misma whitelist del launcher
  const args = [...old.args];
  if (old.model && !args.includes("--model")) args.push("--model", old.model);
  const helperFile = ensureHelperFile();
  if (helperFile && !args.includes("--additional-mcp-config")) {
    args.push("--additional-mcp-config", `@${helperFile}`);
    args.push("--allow-tool", "copilot-web-helper(ask_user)");
  }
  const pairs = old.env.split("\0").filter(Boolean);
  const env = { NODE_ENV: "production" } as NodeJS.ProcessEnv;
  const kvMap = new Map(
    pairs.map((kv) => {
      const i = kv.indexOf("=");
      return [kv.slice(0, i), kv.slice(i + 1)] as const;
    })
  );
  for (const k of DAEMON_ENV) {
    const v = kvMap.get(k);
    if (v !== undefined) env[k] = v;
  }
  for (const [k, v] of kvMap) {
    if (k.startsWith("COPILOT_PROVIDER_") || k.startsWith("COPILOT_GENERATOR")) env[k] = v;
  }
  try {
    const child = spawn("copilot", args, {
      env,
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } catch (e) {
    return Response.json({ ok: false, error: `spawn failed: ${e}` }, { status: 500 });
  }
  const up = await waitProbe(true, 20000);
  const d = up ? findDaemon() : null;
  return Response.json({ ok: up, pid: d?.pid }, { status: up ? 200 : 502 });
}