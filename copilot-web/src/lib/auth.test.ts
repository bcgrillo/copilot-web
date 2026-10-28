import { createHmac, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ACCESS_TTL,
  REFRESH_TTL,
  addUser,
  authEnabled,
  bearerToken,
  ensureAuthFile,
  guardAuth,
  hashPassword,
  helperToken,
  isAuthExempt,
  issuePair,
  listUsers,
  login,
  readAuthFile,
  refreshAuth,
  revokeAllUsers,
  revokeUser,
  deleteUser,
  setPassword,
  verifyPassword,
  verifyToken,
  weakPassword,
} from "./auth";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "cw-auth-"));
  process.env.COPILOT_WEB_AUTH_FILE = path.join(dir, "auth.json");
  delete process.env.NO_AUTH;
});

afterEach(() => {
  delete process.env.COPILOT_WEB_AUTH_FILE;
  delete process.env.NO_AUTH;
  rmSync(dir, { recursive: true, force: true });
});

const req = (url: string, headers: Record<string, string> = {}) =>
  new Request(url, { headers });

const guarded = (token?: string) =>
  req("https://back/api/sessions/", token ? { authorization: `Bearer ${token}` } : {});

describe("auth file bootstrap", () => {
  it("creates the file with a secret on first use (0600)", () => {
    const f = ensureAuthFile();
    expect(f.v).toBe(1);
    expect(f.secret).toMatch(/^[0-9a-f]{64}$/);
    const st = statSync(process.env.COPILOT_WEB_AUTH_FILE!);
    expect(st.mode & 0o777).toBe(0o600);
  });

  it("is idempotent and remembers users", () => {
    addUser("admin", "correct-horse");
    const f2 = ensureAuthFile();
    expect(Object.keys(f2.users)).toEqual(["admin"]);
    const read = JSON.parse(readFileSync(process.env.COPILOT_WEB_AUTH_FILE!, "utf8"));
    expect(read.users.admin.hash).toContain(":");
    expect(read.users.admin.hash).not.toContain("correct-horse");
  });
});

describe("passwords", () => {
  it("hash+verify roundtrip and wrong-password rejection", () => {
    const secret = randomUUID().replace(/-/g, "");
    const h = hashPassword("s3cret!", secret);
    expect(verifyPassword(h, "s3cret!", secret)).toBe(true);
    expect(verifyPassword(h, "s3cret?", secret)).toBe(false);
  });

  it("flags weak passwords (warning only, not a block)", () => {
    expect(weakPassword("admin")).toBe(true);
    expect(weakPassword("longenough1")).toBe(false);
    addUser("weak", "admin"); // weak: accepted with warning
    expect(login("weak", "admin")).not.toBeNull();
  });
});

describe("login + tokens", () => {
  it("issues a verifiable pair and rejects bad credentials", () => {
    addUser("admin", "correct-horse");
    expect(login("admin", "wrong")).toBeNull();
    const pair = login("admin", "correct-horse")!;
    const f = ensureAuthFile();
    const a = verifyToken(pair.access, f.secret)!;
    expect(a.t).toBe("access");
    expect(a.u).toBe("admin");
    expect(a.exp).toBeGreaterThan(Math.floor(Date.now() / 1000) + ACCESS_TTL - 30);
    const r = verifyToken(pair.refresh, f.secret)!;
    expect(r.t).toBe("refresh");
    expect(r.exp).toBeGreaterThan(Math.floor(Date.now() / 1000) + REFRESH_TTL - 30);
    // tampering breaks the signature
    expect(verifyToken(pair.access + "x", f.secret)).toBeNull();
    expect(verifyToken(pair.access, randomUUID())).toBeNull();
  });

  it("creates an independent chain per login", () => {
    addUser("admin", "pw-12345678");
    const p1 = login("admin", "pw-12345678")!;
    const p2 = login("admin", "pw-12345678")!;
    const f = ensureAuthFile();
    expect(Object.keys(f.users.admin.chains)).toHaveLength(2);
    // both chains work (rotation)
    expect(refreshAuth(p2.refresh).ok).toBe(true);
    expect(refreshAuth(p1.refresh).ok).toBe(true);
    expect(Object.keys(f.users.admin.chains)).toHaveLength(2);
  });
});

describe("refresh rotation (single-use, reuse detection)", () => {
  it("rotates access+refresh; the previous jti keeps one-grace use", () => {
    addUser("admin", "pw-12345678");
    const p1 = login("admin", "pw-12345678")!;
    const r1 = refreshAuth(p1.refresh);
    if (!r1.ok) throw new Error("rotation failed");
    const f = ensureAuthFile();
    const cid = verifyToken(p1.refresh, f.secret)!.c!;
    expect(f.users.admin.chains[cid].w).toHaveLength(2); // [new, old]
    // multi-tab race: the tab still holding the OLD refresh (now prev) works
    const r2 = refreshAuth(p1.refresh);
    expect(r2.ok).toBe(true);
    // and a third use of that same jti is now outside the window → reuse
    const r3 = refreshAuth(p1.refresh);
    expect(r3.ok).toBe(false);
    if (!r3.ok) expect(r3.reason).toBe("reused");
  });

  it("reuse of a token 2+ generations old revokes ITS chain, not others", () => {
    addUser("admin", "pw-12345678");
    const pA = login("admin", "pw-12345678")!; // chain A (device A)
    const pB = login("admin", "pw-12345678")!; // chain B (device B)
    // chain A moves 2 generations: stolen pA.refresh is now outside the window
    const rA1 = refreshAuth(pA.refresh);
    if (!rA1.ok) throw new Error("fail");
    const rA2 = refreshAuth(rA1.pair.refresh);
    if (!rA2.ok) throw new Error("fail");
    // the OLD chain-A refresh (stolen copy) is used → family A dies
    expect(refreshAuth(pA.refresh).ok).toBe(false);
    // …and chain A itself is dead (the access from rA2 lives 15 min but its
    // next refresh fails); chain B (other device) must keep working
    const f = ensureAuthFile();
    const cidA = verifyToken(rA2.pair.refresh, f.secret)!.c!;
    expect(f.users.admin.chains[cidA]).toBeUndefined();
    expect(refreshAuth(pB.refresh).ok).toBe(true);
  });

  it("rejects refresh tokens that are expired or revoked", () => {
    addUser("admin", "pw-12345678");
    // expired refresh: rebuild one with a valid signature but exp in the past
    const p2 = login("admin", "pw-12345678")!;
    const f2 = ensureAuthFile();
    const raw = verifyToken(p2.refresh, f2.secret)!;
    const body = Buffer.from(JSON.stringify({ ...raw, exp: 1 })).toString("base64url");
    const mac = createHmac("sha256", f2.secret).update(body).digest("base64url");
    const res = refreshAuth(`${body}.${mac}`);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("expired");
  });
});

describe("revoke / delete / list", () => {
  it("ver bump kills live access + refresh tokens", () => {
    addUser("admin", "pw-12345678");
    const p = login("admin", "pw-12345678")!;
    revokeUser("admin");
    expect(refreshAuth(p.refresh).ok).toBe(false);
    expect(guardAuth(guarded(p.access))?.status).toBe(401);
    // re-login works after revocation
    const p2 = login("admin", "pw-12345678")!;
    expect(refreshAuth(p2.refresh).ok).toBe(true);
  });

  it("revokeAllUsers bumps every user; deleteUser removes the entry", () => {
    addUser("a", "pw-1234567");
    addUser("b", "pw-1234567");
    const pa = login("a", "pw-1234567")!;
    const pb = login("b", "pw-1234567")!;
    expect(revokeAllUsers()).toBe(2);
    expect(refreshAuth(pa.refresh).ok).toBe(false);
    expect(refreshAuth(pb.refresh).ok).toBe(false);
    deleteUser("b");
    expect(listUsers().map((u) => u.name)).toEqual(["a"]);
  });
});

describe("guardAuth (the /api guard)", () => {
  it("passes when NO_AUTH is set, with or without request", () => {
    process.env.NO_AUTH = "1";
    expect(authEnabled()).toBe(false);
    expect(guardAuth()).toBeNull();
    expect(guardAuth(guarded(undefined))).toBeNull();
  });

  it("fail-safe: call without a Request object is rejected while auth is on", () => {
    addUser("admin", "pw-12345678");
    const g = guardAuth();
    expect(g?.status).toBe(401);
  });

  it("401s missing, malformed, wrong-type signatures", () => {
    addUser("admin", "pw-12345678");
    expect(guardAuth(guarded(undefined))?.status).toBe(401);
    expect(guardAuth(req("https://b/api/sessions/", { authorization: "Bearer garbage" }))?.status).toBe(401);
    const f = ensureAuthFile();
    const pair = login("admin", "pw-12345678")!;
    // a refresh token is NOT valid on guarded endpoints
    expect(guardAuth(guarded(pair.refresh))?.status).toBe(401);
    // valid access passes
    const g = guardAuth(guarded(pair.access));
    expect(g).toBeNull();
    expect(readAuthFile()!.users.admin.chains).toBeTruthy();
    void f;
  });

  it("exempts the public paths and unknown-user tokens are 401", () => {
    addUser("admin", "pw-12345678");
    for (const p of ["/api/openapi/", "/api/login/", "/api/auth/state/", "/api/auth/refresh/"])
      expect(guardAuth(req(`https://b${p}`))).toBeNull();
    expect(isAuthExempt("/api/openapi")).toBe(true);
    expect(isAuthExempt("/api/chat")).toBe(false);
    const f = ensureAuthFile();
    const ghost = Buffer.from(JSON.stringify({ t: "access", u: "ghost", v: 1 })).toString("base64url");
    const { createHmac } = require("node:crypto") as typeof import("node:crypto");
    const tok = `${ghost}.${createHmac("sha256", f.secret).update(ghost).digest("base64url")}`;
    expect(guardAuth(guarded(tok))?.status).toBe(401);
  });

  it("accepts the internal helper token on guarded paths", () => {
    addUser("admin", "pw-12345678");
    const f = ensureAuthFile();
    expect(guardAuth(guarded(helperToken(f.secret)))).toBeNull();
  });

  it("expired access token is rejected", () => {
    addUser("admin", "pw-12345678");
    const f = ensureAuthFile();
    const pair = login("admin", "pw-12345678")!;
    const raw = verifyToken(pair.access, f.secret)!;
    const { createHmac } = require("node:crypto") as typeof import("node:crypto");
    const body = Buffer.from(JSON.stringify({ ...raw, exp: 1 })).toString("base64url");
    const tok = `${body}.${createHmac("sha256", f.secret).update(body).digest("base64url")}`;
    expect(guardAuth(guarded(tok))?.status).toBe(401);
  });
});

describe("helpers", () => {
  it("bearerToken parses the header; issuePair issues for an existing user", () => {
    expect(bearerToken(req("https://b", { authorization: "Bearer abc.def" }))).toBe("abc.def");
    expect(bearerToken(req("https://b", { authorization: "Basic abc" }))).toBeNull();
    addUser("admin", "pw-12345678");
    const f = ensureAuthFile();
    expect(verifyToken(issuePair(f, "admin", "c1").access, f.secret)?.u).toBe("admin");
  });
});