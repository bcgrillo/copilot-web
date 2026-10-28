import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "./route";
import { addUser, ensureAuthFile, login, verifyToken } from "@/lib/auth";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "cw-refresh-route-"));
  process.env.COPILOT_WEB_AUTH_FILE = path.join(dir, "auth.json");
  delete process.env.NO_AUTH;
});

afterEach(() => {
  delete process.env.COPILOT_WEB_AUTH_FILE;
  delete process.env.NO_AUTH;
  rmSync(dir, { recursive: true, force: true });
});

/** send `Authorization: Bearer <token>` (the handler parses the bearer scheme) */
const call = (token?: string) =>
  POST(
    new Request("https://x/api/auth/refresh/", {
      method: "POST",
      headers: token ? { authorization: `BEARER ${token}` } : {},
    }),
  );

const tok = (user: string, pw: string) => {
  const p = login(user, pw)!;
  return p;
};

describe("POST /api/auth/refresh (route)", () => {
  it("rotates a valid refresh into a fresh pair", async () => {
    addUser("admin", "pw-password1");
    const p = tok("admin", "pw-password1");
    const res = await call(p.refresh);
    expect(res.status).toBe(200);
    const next = (await res.json()) as { access: string; refresh: string };
    expect(next.refresh).not.toBe(p.refresh);
    // the fresh access must be a well-formed token of the same chain (it can
    // equal the previous one within the same second: payloads are stateless)
    const secret = ensureAuthFile().secret;
    const payload = verifyToken(next.access, secret);
    expect(payload?.t).toBe("access");
    expect(payload?.u).toBe("admin");
  });

  it("401 missing-token without Authorization; 401 invalid for an access token", async () => {
    addUser("admin", "pw-password1");
    expect((await call()).status).toBe(401);
    const p = tok("admin", "pw-password1");
    const res = await call(p.access); // wrong token type
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized", reason: "invalid" });
  });

  it("401 reused once the jti falls out of the rotation window; chain revoked", async () => {
    addUser("admin", "pw-password1");
    const p1 = tok("admin", "pw-password1");
    const r1 = await call(p1.refresh);
    const p2 = (await r1.json()) as { access: string; refresh: string };
    // second rotation with a STALE refresh (multi-tab grace) still works…
    const r2 = await call(p1.refresh);
    expect(r2.status).toBe(200);
    // …but a third use of that same token is outside the window → reuse
    const r3 = await call(p1.refresh);
    expect(r3.status).toBe(401);
    expect(await r3.json()).toEqual({ error: "unauthorized", reason: "reused" });
    // and the chain is dead: the last issued refresh no longer rotates
    const r4 = await call(p2.refresh);
    expect(r4.status).toBe(401);
    expect(await r4.json()).toEqual({ error: "unauthorized", reason: "revoked" });
  });

  it("400 auth-disabled when NO_AUTH is set", async () => {
    addUser("admin", "pw-password1");
    const p = tok("admin", "pw-password1");
    process.env.NO_AUTH = "1";
    const res = await call(p.refresh);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "auth-disabled" });
  });
});