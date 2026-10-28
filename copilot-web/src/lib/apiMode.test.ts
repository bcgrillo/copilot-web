import { afterEach, describe, expect, it } from "vitest";
import { corsHeadersRuntime, getAppMode, guardApi } from "./apiMode";

const original = {
  mode: process.env.APP_MODE,
  cors: process.env.CORS_ALLOW_ORIGIN,
  noauth: process.env.NO_AUTH,
};

afterEach(() => {
  if (original.mode === undefined) delete process.env.APP_MODE;
  else process.env.APP_MODE = original.mode;
  if (original.cors === undefined) delete process.env.CORS_ALLOW_ORIGIN;
  else process.env.CORS_ALLOW_ORIGIN = original.cors;
  // these tests cover the mode layer only — auth is exercised in auth.test.ts
  delete process.env.NO_AUTH;
});

describe("getAppMode", () => {
  it("defaults to all", () => {
    delete process.env.APP_MODE;
    expect(getAppMode()).toBe("all");
  });

  it("accepts api and front (case-insensitive)", () => {
    process.env.APP_MODE = "api";
    expect(getAppMode()).toBe("api");
    process.env.APP_MODE = "FRONT";
    expect(getAppMode()).toBe("front");
  });

  it("falls back to all for unknown values", () => {
    process.env.APP_MODE = "banana";
    expect(getAppMode()).toBe("all");
  });
});

describe("guardApi", () => {
  it("passes requests through in all/api modes", () => {
    process.env.APP_MODE = "api";
    process.env.NO_AUTH = "1";
    expect(guardApi()).toBeNull();
    delete process.env.APP_MODE;
    expect(guardApi()).toBeNull();
  });

  it("fails closed without a Request when auth is enabled", async () => {
    delete process.env.APP_MODE;
    delete process.env.NO_AUTH;
    const res = guardApi();
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
    expect(await res!.json()).toMatchObject({ error: "unauthorized" });
  });

  it("blocks with 404 api-disabled in front mode", async () => {
    process.env.APP_MODE = "front";
    process.env.NO_AUTH = "1";
    const res = guardApi();
    expect(res).not.toBeNull();
    expect(res!.status).toBe(404);
    expect(await res!.json()).toEqual({ error: "api-disabled" });
  });

  it("adds runtime CORS headers to blocked responses", () => {
    process.env.APP_MODE = "front";
    process.env.CORS_ALLOW_ORIGIN = "https://front.example";
    const res = guardApi(new Request("https://back/api/x", {
      headers: { origin: "https://front.example" },
    }));
    expect(res!.headers.get("access-control-allow-origin")).toBe("https://front.example");
  });
});

describe("corsHeadersRuntime", () => {
  it("returns no CORS headers when unset", () => {
    delete process.env.CORS_ALLOW_ORIGIN;
    expect(corsHeadersRuntime("https://x").get("access-control-allow-origin")).toBeNull();
  });

  it("supports *, exact origins and rejects mismatches", () => {
    process.env.CORS_ALLOW_ORIGIN = "https://front.example, https://other.example";
    expect(corsHeadersRuntime("https://front.example").get("access-control-allow-origin"))
      .toBe("https://front.example");
    expect(corsHeadersRuntime("https://other.example").get("vary")).toBe("Origin");
    expect(corsHeadersRuntime("https://evil.example").get("access-control-allow-origin")).toBeNull();

    process.env.CORS_ALLOW_ORIGIN = "*";
    const h = corsHeadersRuntime(null);
    expect(h.get("access-control-allow-origin")).toBe("*");
    expect(h.get("access-control-allow-methods")).toContain("PATCH");
  });
});