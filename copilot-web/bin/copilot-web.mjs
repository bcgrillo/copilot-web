#!/usr/bin/env node
/**
 * copilot-web launcher
 *
 * Starts, in a single command, the Copilot CLI ACP daemon and the Next
 * web server. The web is not a standalone service: if the daemon is
 * already up it reuses it; otherwise it spawns it.
 */
import { execFileSync, spawn, execSync } from "node:child_process";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { writeFileSync, readFileSync, readdirSync } from "node:fs";
import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const opts = {
  port: process.env.PORT || 3100,
  acpPort: process.env.ACP_PORT || 3222,
  cwd: process.env.CHAT_CWD || process.cwd(),
  copilotArgs: process.env.COPILOT_ACP_ARGS || "",
  build: false,
  daemon: true,
  helper: process.env.COPILOT_WEB_HELPER !== "0",
  noAuth: false,
  userMgmt: null,
  lang: process.env.COPILOT_WEB_LANG || "",
  model: process.env.COPILOT_MODEL || "",
};

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "-h" || a === "--help") {
    console.log(
      "copilot-web — web adapter for Copilot CLI (ACP)\n\n" +
        "  --port <n>          web server port (default 3100)\n" +
        "  --acp-port <n>      ACP daemon port (default 3222)\n" +
        "  --cwd <dir>         sessions working directory (default: cwd)\n" +
        "  --copilot-args <s>  extra args for the copilot ACP daemon\n" +
        "                      (e.g. \"--allow-all-tools --allow-all-paths --allow-all-urls\")\n" +
        "  --lang <en|es>      UI language (default: browser language)\n" +
        "  --model <id>        model for the copilot ACP daemon (copilot --model);\n" +
        "                      shown in the status bar. Only applies when the\n" +
        "                      daemon is spawned fresh (not when reused)\n" +
        "  --build             run next build before starting\n" +
        "  --no-daemon         expect a running daemon, do not spawn it\n" +
        "  --no-helper         do not register the web ask-user MCP helper\n" +
        "                      with the daemon (on by default; needs a freshly\n" +
        "                      spawned daemon)\n" +
        "  --no-auth           disable the built-in bearer authentication for\n" +
        "                      this server instance (default: auth ON — the\n" +
        "                      server refuses to start with zero users)\n" +
        "  --add-user <u> [--password <pw>]\n" +
        "                      create a UI user (password prompted if omitted)\n" +
        "  --set-password <u> [--password <pw>]\n" +
        "                      change a user's password (revokes its sessions)\n" +
        "  --del-user <u>      remove a user and revoke its sessions\n" +
        "  --list-users        list usernames\n" +
        "  --revoke <u>        revoke a user's passwords/tokens\n" +
        "  --revoke-all        revoke every user's sessions\n" +
        "  --helper-token      print the MCP helper token\n" +
        "  -h, --help"
    );
    process.exit(0);
  } else if (a === "--port") opts.port = argv[++i];
  else if (a === "--acp-port") opts.acpPort = argv[++i];
  else if (a === "--cwd") opts.cwd = argv[++i];
  else if (a === "--copilot-args") opts.copilotArgs = argv[++i] ?? "";
  else if (a === "--lang") opts.lang = argv[++i] ?? "";
  else if (a === "--model") opts.model = argv[++i] ?? "";
  else if (a === "--build") opts.build = true;
  else if (a === "--no-daemon") opts.daemon = false;
  else if (a === "--no-helper") opts.helper = false;
  else if (a === "--no-auth") opts.noAuth = true;
  else if (a === "--add-user") opts.userMgmt = { kind: "add", user: argv[++i] };
  else if (a === "--set-password") opts.userMgmt = { kind: "set-password", user: argv[++i] };
  else if (a === "--del-user") opts.userMgmt = { kind: "del-user", user: argv[++i] };
  else if (a === "--revoke") opts.userMgmt = { kind: "revoke", user: argv[++i] };
  else if (a === "--revoke-all") opts.userMgmt = { kind: "revoke-all" };
  else if (a === "--list-users") opts.userMgmt = { kind: "list-users" };
  else if (a === "--helper-token") opts.userMgmt = { kind: "helper-token" };
  else if (a === "--password") opts.userPassword = argv[++i];
  else {
    console.error(`unknown arg: ${a}`);
    process.exit(1);
  }
}

/** internal (never-expiring) MCP helper token from the auth store, if any */
function helperTokenFromStore() {
  try {
    const storePath =
      process.env.COPILOT_WEB_AUTH_FILE || path.join(os.homedir(), ".copilot-web", "auth.json");
    const secret = JSON.parse(readFileSync(storePath, "utf8")).secret;
    if (typeof secret !== "string" || secret.length < 16) return null;
    const body = Buffer.from(
      JSON.stringify({ t: "internal", u: "__helper__", v: 0 })
    ).toString("base64url");
    const mac = createHmac("sha256", secret).update(body).digest("base64url");
    return `${body}.${mac}`;
  } catch {
    return null;
  }
}

/** does the auth store exist with at least one user? */
function authUserCount() {
  try {
    const storePath =
      process.env.COPILOT_WEB_AUTH_FILE || path.join(os.homedir(), ".copilot-web", "auth.json");
    const users = JSON.parse(readFileSync(storePath, "utf8")).users || {};
    return Object.keys(users).length;
  } catch {
    return 0;
  }
}

/** user-management mode: run the CLI once and exit with its status */
function runUserMgmt() {
  const f = opts.userMgmt;
  const args = [`--${f.kind}`, ...(f.user ? [f.user] : [])];
  if ((f.kind === "add" || f.kind === "set-password") && opts.userPassword)
    args.push("--password", opts.userPassword);
  const script = path.join(root, "bin", "users.ts");
  try {
    console.log(`[copilot-web] user management (${f.kind})…`);
    execFileSync(
      process.execPath,
      ["--experimental-strip-types", script, ...args],
      { stdio: "inherit" }
    );
    return 0;
  } catch (e) {
    return e.status ?? 1;
  }
}

/** Is anything listening on port? */
function probe(port) {
  return new Promise((ok) => {
    const s = net.connect(port, "127.0.0.1");
    s.once("connect", () => {
      s.destroy();
      ok(true);
    });
    s.once("error", () => ok(false));
  });
}

async function waitProbe(port, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await probe(port)) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

/** env local opcional (no versionado): .env.local como fuente del provider/
 * modelo para el daemon (claves COPILOT_*). Permite arrancar en cold sin
 * heredar el entorno completo del operador. */
function loadLocalEnv() {
  try {
    const out = {};
    for (const line of readFileSync(path.join(root, ".env.local"), "utf8").split("\n")) {
      const m = line.match(/^\s*(COPILOT_[A-Z_]+)\s*=\s*(.*?)\s*$/);
      if (m) out[m[1]] = m[2];
    }
    return out;
  } catch {
    return {};
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const localEnv = loadLocalEnv();

// ---- user management mode: run and exit (no server) ----------------------
if (opts.userMgmt) {
  const code = runUserMgmt();
  process.exit(code);
}

/** modelo que le fue pasado al daemon YA en marcha (leo su /proc/<pid>/environ):
 * al reutilizar daemon, el status-bar debe mostrar el modelo real, no perderlo. */
function readDaemonModel(acpPort) {
  try {
    for (const pid of readdirSync("/proc").filter((d) => /^\d+$/.test(d))) {
      try {
        const cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0");
        if (!(cmd[0] || "").includes("copilot")) continue;
        if (!cmd.includes("--acp") || !cmd.includes(String(acpPort))) continue;
        const env = readFileSync(`/proc/${pid}/environ`, "utf8").split("\0");
        const m = env.find((kv) => kv.startsWith("COPILOT_MODEL="));
        return m ? m.slice("COPILOT_MODEL=".length) : "";
      } catch {
        /* ephemeral pid or no permission: continue */
      }
    }
  } catch {
    /* no /proc (not Linux) */
  }
  return "";
}

// ---- auth startup check (server mode) ------------------------------------
// default: authentication ON. Refuse to start with zero configured users
// unless --no-auth was passed (or an explicit set is empty → same check).
const disabled = opts.noAuth || process.env.NO_AUTH === "1";
if (!disabled && authUserCount() === 0) {
  console.error(
    "[copilot-web] authentication is enabled by default but no users are configured.\n" +
      "  Create one first, e.g.:  copilot-web --add-user admin --password <pw>\n" +
      "  (or start with --no-auth to run this instance without authentication)"
  );
  process.exit(1);
}
if (disabled) console.log("[copilot-web] authentication disabled (--no-auth)");

if (await probe(opts.acpPort)) {
  console.log(`[copilot-web] reusing ACP daemon on :${opts.acpPort}`);
  // the live daemon keeps its boot env: we recover the model passed back
  // then (the --model flag of THIS run does not apply to an already
  // running daemon, but the status-bar must keep showing the real model)
  const liveModel = readDaemonModel(opts.acpPort);
  if (opts.model && opts.model !== liveModel)
    console.warn(
      `[copilot-web] --model only applies to a freshly spawned daemon (one is already running on :${opts.acpPort}, started with --model ${liveModel || "auto"}); keeping the live one for the status bar`
    );
  if (opts.helper)
    console.warn(
      `[copilot-web] --helper ignored: only applies to a freshly spawned daemon (one is already running on :${opts.acpPort})`
    );
  opts.model = liveModel;
} else if (opts.daemon) {
  if (!opts.copilotArgs) {
    // NO allow-all by default: the CLI asks permissions over ACP and the
    // web resolves them with allow/deny cards. To allow everything explicitly:
    // --copilot-args "--allow-all-tools --allow-all-paths --allow-all-urls"
    opts.copilotArgs = "";
  }
  const args = [
    "--acp",
    "--port",
    String(opts.acpPort),
    ...opts.copilotArgs
      .split(" ")
      .map((s) => s.trim())
      .filter(Boolean),
    ...(opts.model ? ["--model", opts.model] : []),
  ];
  console.log(`[copilot-web] daemon: copilot ${args.join(" ")}`);
  /* SANITIZED env (allowlist): the CLI is sensitive to operator
   * environment noise (e.g. COPILOT_LOADER_PID/COPILOT_AGENT_SESSION_ID
   * from the CodePods environment block session/new with "Authentication
   * required"); the minimum is passed plus the own provider/model. */
  const DAEMON_ENV = [
    "PATH","HOME","SHELL","LANG","LC_ALL","TERM","TERM_PROGRAM","TERM_PROGRAM_VERSION",
    "HOSTNAME","TMPDIR",
    "HTTP_PROXY","HTTPS_PROXY","NO_PROXY","http_proxy","https_proxy","no_proxy",
    "COPILOT_MODEL",
  ];
  const denvSrc = { ...localEnv, ...process.env, ...(opts.model ? { COPILOT_MODEL: opts.model } : {}) };
  const denv = {};
  for (const k of DAEMON_ENV) if (denvSrc[k] !== undefined) denv[k] = denvSrc[k];
  for (const k of Object.keys(denvSrc)) {
    if (k.startsWith("COPILOT_PROVIDER_") || k.startsWith("COPILOT_GENERATOR")) denv[k] = denvSrc[k];
  }
  // MCP helper (ask_user): config file + --additional-mcp-config, only on
  // a freshly spawned daemon (reuse + helper = honest warn).
  if (opts.helper) {
    opts.helperFile = `/tmp/copilot-web-helper-${opts.acpPort}.json`;
    writeFileSync(
      opts.helperFile,
      JSON.stringify({
        mcpServers: {
          "copilot-web-helper": {
            type: "local",
            command: "node",
            args: [path.join(root, "mcp", "ask-user.mjs")],
            env: {
              COPILOT_WEB_URL: `http://localhost:${opts.port}`,
              ...(helperTokenFromStore()
                ? { COPILOT_WEB_TOKEN: helperTokenFromStore() }
                : {}),
            },
          },
        },
      })
    );
    args.push("--additional-mcp-config", `@${opts.helperFile}`);
    // the helper ask_user does not ask permission: allowlist the tool of
    // the "copilot-web-helper" MCP server (CLI --allow-tool server(tool) pattern)
    args.push("--allow-tool", "copilot-web-helper(ask_user)");
    console.log(`[copilot-web] helper: MCP config at ${opts.helperFile}`);
  }
  const d = spawn("copilot", args, { detached: true, stdio: "ignore", env: denv });
  d.unref();
  if (!(await waitProbe(opts.acpPort, 30000))) {
    console.error(`[copilot-web] ACP daemon did not answer on :${opts.acpPort}`);
    process.exit(1);
  }
  console.log(`[copilot-web] daemon up on :${opts.acpPort}`);
} else {
  console.error(`[copilot-web] no daemon on :${opts.acpPort} (--no-daemon)`);
  process.exit(1);
}

if (opts.build) {
  console.log("[copilot-web] next build…");
  execSync("npx next build", { cwd: root, stdio: "inherit" });
}

const child = spawn(
  process.execPath,
  [
    path.join(root, "node_modules", "next", "dist", "bin", "next"),
    "start",
    "-p",
    String(opts.port),
  ],
  {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      PORT: String(opts.port),
      ACP_PORT: String(opts.acpPort),
      CHAT_CWD: opts.cwd,
      COPILOT_ACP_ARGS: opts.copilotArgs || "",
      COPILOT_WEB_LANG: opts.lang || "",
      COPILOT_MODEL: opts.model || "",
    NO_AUTH: opts.noAuth || process.env.NO_AUTH === "1" ? "1" : "",
  },
  }
);

if (!(await waitProbe(opts.port, 30000))) {
  console.error(`[copilot-web] web server did not answer on :${opts.port}`);
  process.exit(1);
}
console.log(`\n[copilot-web] ready → http://localhost:${opts.port}`);

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    try { child.kill(sig); } catch {}
    process.exit(0);
  });
}