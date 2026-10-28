// Authentication for copilot-web (stateless dual-token, OAuth2-style).
//
// - Passwords: scrypt (random salt) + HMAC-pepper with the install secret.
//   Stored in ~/.copilot-web/auth.json (chmod 600); NEVER in clear text; the
//   CLI can set new ones but never read old ones.
// - Tokens: signed with HMAC-SHA256 (secret from auth.json):
//     access  {t:"access",  u, v, c}   — 15 min TTL, v = user token version
//     refresh {t:"refresh", u, v, c, j} — 90 day TTL, rotated on each use;
//       single-use with reuse detection: each refresh chain keeps a 2-slot
//       window (current + previous jti). A jti outside the window means a
//       reused/stolen token → the whole chain is deleted (family revocation),
//       independent of other chains of the same user.
//     internal {t:"internal", u:"__helper__"} — never-expiring token for the
//       in-container MCP helper (ask-user), injected by the launcher.
// - Revocation: --set-password/--del-user/--revoke/--revoke-all bump the
//   user token version (kills access AND refresh at once).
// - NO_AUTH=1 env (launcher --no-auth) disables the whole guard; if auth is
//   enabled and auth.json has NO users the launcher refuses to start.
// - The file path is overridable with COPILOT_WEB_AUTH_FILE (tests).

import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const ACCESS_TTL = 900; // seconds (15 min)
export const REFRESH_TTL = 7776000; // seconds (90 days)

export const AUTH_EXEMPT_PATHS = [
  "/api/openapi",
  "/api/login",
  "/api/auth/state",
  "/api/auth/refresh",
] as const;

export type TokenType = "access" | "refresh" | "internal";

export type TokenPayload = {
  t: TokenType;
  u: string;
  v: number;
  c?: string; // refresh chain id
  j?: string; // refresh token jti (rotation window)
  exp?: number; // seconds since epoch (only access/refresh)
};

type Chain = { w: string[]; i: string }; // rotation window [cur, prev], chain issued-at

type UserEntry = {
  hash: string; // "<salt-hex>:<hmac-hex>"
  created: string;
  ver: number; // token version (CLI revocation)
  chains: Record<string, Chain>;
};

export type AuthFile = {
  v: number;
  secret: string;
  users: Record<string, UserEntry>;
};

export type TokenPair = { access: string; refresh: string };

export type RefreshResult =
  | { ok: true; pair: TokenPair }
  | { ok: false; reason: "invalid" | "expired" | "revoked" | "reused" };

export function authFilePath(): string {
  const override = process.env.COPILOT_WEB_AUTH_FILE;
  if (override) return override;
  return path.join(homedir(), ".copilot-web", "auth.json");
}

export function authEnabled(): boolean {
  const v = (process.env.NO_AUTH ?? "").trim().toLowerCase();
  return !(v === "1" || v === "true" || v === "yes");
}

/** reads the file; null when missing or corrupt */
export function readAuthFile(): AuthFile | null {
  try {
    const f = JSON.parse(readFileSync(authFilePath(), "utf8")) as AuthFile;
    if (typeof f?.secret !== "string" || typeof f?.users !== "object") return null;
    return f;
  } catch {
    return null;
  }
}

/** creates the file (with its secret) the first time; always fsync-like safe write + 0600 */
export function ensureAuthFile(): AuthFile {
  const p = authFilePath();
  let f = readAuthFile();
  if (f) return f;
  f = { v: 1, secret: randomBytes(32).toString("hex"), users: {} };
  writeAuthFile(f);
  return f;
}

function writeAuthFile(f: AuthFile): void {
  const p = authFilePath();
  try {
    chmodSync(path.dirname(p), 0o700);
  } catch {
    /* pre-existing dir: leave its mode alone */
  }
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(f, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, p);
  try {
    chmodSync(p, 0o600);
  } catch {
    /* chmod on rename is usually already 0600 */
  }
}

/** scrypt(password, salt) + HMAC pepper with the install secret */
export function hashPassword(pw: string, secret: string): string {
  const salt = randomBytes(16);
  const kdf = scryptSync(pw, salt, 64);
  const mac = createHmac("sha256", secret).update(kdf).digest();
  return `${salt.toString("hex")}:${mac.toString("hex")}`;
}

export function verifyPassword(stored: string, pw: string, secret: string): boolean {
  const [saltHex, macHex] = stored.split(":");
  if (!saltHex || !macHex) return false;
  try {
    const kdf = scryptSync(pw, Buffer.from(saltHex, "hex"), 64);
    const mac = createHmac("sha256", secret).update(kdf).digest();
    return timingSafeEqual(mac, Buffer.from(macHex, "hex"));
  } catch {
    return false;
  }
}

/** passwords < 8 chars trigger a warning, never a block */
export function weakPassword(pw: string): boolean {
  return pw.length < 8;
}

// ------------------------------------------------------------------ tokens

const b64u = (b: Buffer) => b.toString("base64url");
const sign = (data: string, secret: string) => createHmac("sha256", secret).update(data).digest();

export function signToken(p: TokenPayload, secret: string): string {
  const body = b64u(Buffer.from(JSON.stringify(p)));
  const mac = b64u(sign(body, secret));
  return `${body}.${mac}`;
}

export function verifyToken(token: string, secret: string): TokenPayload | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = b64u(sign(body, secret));
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as TokenPayload;
    if (p.t !== "access" && p.t !== "refresh" && p.t !== "internal") return null;
    if (typeof p.u !== "string" || typeof p.v !== "number") return null;
    return p;
  } catch {
    return null;
  }
}

/** never-expiring token for the in-container MCP helper */
export function helperToken(secret?: string): string {
  const s = secret ?? readAuthFile()?.secret ?? "";
  if (!s) return "";
  return signToken({ t: "internal", u: "__helper__", v: 0 }, s);
}

export function bearerToken(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = /^bearer\s+(\S+)$/i.exec(h);
  return m ? m[1] : null;
}

// ------------------------------------------------------------------- guard

export function isAuthExempt(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, "") || "/";
  return (AUTH_EXEMPT_PATHS as readonly string[]).includes(p);
}

const UNAUTHORIZED = { error: "unauthorized" } as const;

/** 401 response builder — CORS headers are added by the caller (apiMode) */
export function unauthorized(reason: string): { json: unknown; status: 401; reason: string } {
  return { json: { ...UNAUTHORIZED, reason }, status: 401, reason };
}

/**
 * The whole /api guard. Returns a 401 Response when auth is enabled
 * (NO_AUTH unset) and the request has no valid access or internal token,
 * or null to pass through. Exempts the public paths (openapi, login,
 * auth/state, auth/refresh). Fail-safe: calls without a Request object
 * are rejected when auth is on.
 */
export function guardAuth(req?: Request): Response | null {
  const cors = req?.headers.get("origin") ?? null;
  const deny = (reason: string): Response => {
    const { json, status } = unauthorized(reason);
    return Response.json(json, {
      status,
      headers: { "www-authenticate": `Bearer realm="copilot-web", error="${reason}"` },
    });
  };
  void cors;
  if (!authEnabled()) return null;
  if (!req) return deny("guard-without-request");
  const path = new URL(req.url).pathname;
  if (isAuthExempt(path)) return null;

  const tok = bearerToken(req);
  if (!tok) return deny("missing-token");
  const f = readAuthFile();
  if (!f) return deny("no-auth-file");
  const p = verifyToken(tok, f.secret);
  if (!p) return deny("invalid-token");

  if (p.t === "internal") {
    return p.u === "__helper__" ? null : deny("invalid-token");
  }
  if (p.t !== "access") return deny("wrong-token-type");
  const u = f.users[p.u];
  if (!u) return deny("revoked");
  if (u.ver !== p.v) return deny("revoked");
  if (!p.exp || p.exp <= Math.floor(Date.now() / 1000)) return deny("expired");
  return null;
}

// ------------------------------------------------------------ login/refresh

const now = () => Math.floor(Date.now() / 1000);
const newJti = () => randomBytes(16).toString("hex");

export function issuePair(f: AuthFile, user: string, chainId: string): TokenPair {
  const v = f.users[user].ver;
  return {
    access: signToken({ t: "access", u: user, v, c: chainId, exp: now() + ACCESS_TTL }, f.secret),
    refresh: signToken(
      { t: "refresh", u: user, v, c: chainId, j: chainId, exp: now() + REFRESH_TTL },
      f.secret,
    ),
  };
}

/** POST /api/login — verifies the password and issues {access, refresh},
 * creating a NEW independent refresh chain (multiple devices supported). */
export function login(user: string, pw: string): TokenPair | null {
  const f = ensureAuthFile();
  const entry = f.users[user];
  if (!entry || !verifyPassword(entry.hash, pw, f.secret)) return null;
  const cid = newJti();
  entry.chains[cid] = { w: [cid], i: new Date().toISOString() };
  pruneChains(entry);
  const pair = issuePair(f, user, cid);
  writeAuthFile(f);
  return pair;
}

/** POST /api/auth/refresh — Bearer <refresh>; rotates BOTH tokens.
 * Window: w[0]=current, w[1]=previous (multi-tab race grace). A jti outside
 * the window means a reused (stolen/old) token → the chain is deleted. */
export function refreshAuth(token: string): RefreshResult {
  const f = ensureAuthFile();
  const p = verifyToken(token, f.secret);
  if (!p || p.t !== "refresh") return { ok: false, reason: "invalid" };
  const entry = f.users[p.u];
  if (!entry) return { ok: false, reason: "revoked" };
  if (entry.ver !== p.v) return { ok: false, reason: "revoked" };
  const c = p.c ?? "";
  const chain = entry.chains[c];
  if (!chain) return { ok: false, reason: "revoked" };
  if (!p.j || !p.exp || p.exp <= now()) {
    // expired or malformed refresh: natural end of a chain, no purge
    return { ok: false, reason: "expired" };
  }

  const cur = chain.w[0];
  if (p.j !== cur && p.j !== chain.w[1]) {
    // REUSE detected: revoke the whole chain (other chains keep working)
    delete entry.chains[c];
    writeAuthFile(f);
    return { ok: false, reason: "reused" };
  }

  const j2 = newJti();
  // always [new, old cur]: when j was the current one, it becomes the grace
  // slot; when j was the previous one (multi-tab race), the live current
  // token of the other tab is kept as the grace slot either way.
  chain.w = [j2, cur];
  pruneChains(entry);
  const access = signToken({ t: "access", u: p.u, v: p.v, c, exp: now() + ACCESS_TTL }, f.secret);
  const refresh = signToken({ t: "refresh", u: p.u, v: p.v, c, j: j2, exp: now() + REFRESH_TTL }, f.secret);
  writeAuthFile(f);
  return { ok: true, pair: { access, refresh } };
}

/** drops chains older than a 2x-refresh margin (natural expiry) */
function pruneChains(entry: UserEntry): void {
  const cutoff = Date.now() - 2 * REFRESH_TTL * 1000;
  for (const [c, chain] of Object.entries(entry.chains)) {
    const issued = Date.parse(chain.i);
    if (Number.isFinite(issued) && issued < cutoff) delete entry.chains[c];
  }
}

// ---------------------------------------------------------------- user CRUD

export function addUser(name: string, pw: string): { weak: boolean } {
  const name2 = name.trim();
  if (!name2) throw new Error("user name is required");
  const f = ensureAuthFile();
  if (f.users[name2]) throw new Error(`user already exists: ${name2}`);
  f.users[name2] = {
    hash: hashPassword(pw, f.secret),
    created: new Date().toISOString(),
    ver: 1,
    chains: {},
  };
  writeAuthFile(f);
  return { weak: weakPassword(pw) };
}

export function setPassword(name: string, pw: string): { weak: boolean } {
  const f = ensureAuthFile();
  const e = f.users[name.trim()];
  if (!e) throw new Error(`no such user: ${name.trim()}`);
  e.hash = hashPassword(pw, f.secret);
  e.ver += 1; // revoke every live token
  e.chains = {};
  writeAuthFile(f);
  return { weak: weakPassword(pw) };
}

export function deleteUser(name: string): void {
  const f = ensureAuthFile();
  const name2 = name.trim();
  if (!f.users[name2]) throw new Error(`no such user: ${name2}`);
  delete f.users[name2];
  writeAuthFile(f);
}

export function revokeUser(name: string): void {
  const f = ensureAuthFile();
  const e = f.users[name.trim()];
  if (!e) throw new Error(`no such user: ${name.trim()}`);
  e.ver += 1;
  e.chains = {};
  writeAuthFile(f);
}

export function revokeAllUsers(): number {
  const f = ensureAuthFile();
  let n = 0;
  for (const e of Object.values(f.users)) {
    e.ver += 1;
    e.chains = {};
    n++;
  }
  writeAuthFile(f);
  return n;
}

/** names + created dates only — hashes are never exposed */
export function listUsers(): { name: string; created: string }[] {
  const f = ensureAuthFile();
  return Object.entries(f.users).map(([name, e]) => ({ name, created: e.created }));
}