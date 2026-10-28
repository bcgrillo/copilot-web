import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "./route";
import { addUser, ensureAuthFile, verifyToken } from "@/lib/auth";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "cw-login-route-"));
  process.env.COPILOT_WEB_AUTH_FILE = path.join(dir, "auth.json");
  delete process.env.NO_AUTH;
});

afterEach(() => {
  delete process.env.COPILOT_WEB_AUTH_FILE;
  delete process.env.NO_AUTH;
  rmSync(dir, { recursive: true, force: true });
});

const call = (body: unknown, noAuth = false) => {
  if (noAuth) process.env.NO_AUTH = "1";
  return POST(
    new Request("https://x/api/login/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
};

describe("POST /api/login (route)", () => {
  it("issues a verifiable pair with good credentials", async () => {
    addUser("admin", "correct-horse");
    const res = await call({ user: " admin ", password: "correct-horse" });
    expect(res.status).toBe(200);
    const pair = (await res.json()) as { access: string; refresh: string };
    const f = ensureAuthFile();
    expect(verifyToken(pair.access, f.secret)?.t).toBe("access");
    expect(verifyToken(pair.access, f.secret)?.u).toBe("admin");
    expect(verifyToken(pair.refresh, f.secret)?.t).toBe("refresh");
  });

  it("401 with invalid-credentials on a wrong password", async () => {
    addUser("admin", "correct-horse");
    const res = await call({ user: "admin", password: "wrongpw" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid-credentials" });
  });

  it("400s on missing fields and on unparseable bodies", async () => {
    const res = await call({ user: "admin" });
    expect(res.status).toBe(400);
    const res2 = await call({ password: "pw" });
    expect(res2.status).toBe(400);
    const res3 = await call("{not-json");
    expect(res3.status).toBe(400);
  });

  it("400 auth-disabled when NO_AUTH is set", async () => {
    addUser("admin", "correct-horse");
    const res = await call({ user: "admin", password: "correct-horse" }, true);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "auth-disabled" });
  });
});