import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "./route";

beforeEach(() => {
  delete process.env.NO_AUTH;
  process.env.COPILOT_WEB_AUTH_FILE = path.join(mkdtempSync(path.join(tmpdir(), "cw-state-")), "auth.json");
});

afterEach(() => {
  const dir = process.env.COPILOT_WEB_AUTH_FILE;
  delete process.env.COPILOT_WEB_AUTH_FILE;
  delete process.env.NO_AUTH;
  rmSync(dir ?? "/nonexistent", { recursive: true, force: true });
});

describe("GET /api/auth/state (route)", () => {
  it("reports auth:true by default", async () => {
    const res = await GET(new Request("https://x/api/auth/state/"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ auth: true });
  });

  it("reports auth:false when NO_AUTH is set", async () => {
    process.env.NO_AUTH = "1";
    const res = await GET(new Request("https://x/api/auth/state/"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ auth: false });
  });
});