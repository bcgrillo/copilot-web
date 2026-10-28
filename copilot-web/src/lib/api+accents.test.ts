import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCENTS, accentColor } from "./accents";

describe("accents", () => {
  it("picks light and dark variants of the same palette", () => {
    expect(accentColor("blue", false)).toBe("#3b82f6");
    expect(accentColor("blue", true)).toBe("#60a5fa");
  });

  it("falls back to the default emerald for unknown ids", () => {
    expect(accentColor("nope", false)).toBe("#10b981");
    expect(accentColor("nope", true)).toBe("#34d399");
  });

  it("every palette entry has unique ids and hex colors", () => {
    const ids = ACCENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    const hex = /^#[0-9a-f]{6}$/i;
    for (const a of ACCENTS) {
      expect(hex.test(a.light)).toBe(true);
      expect(hex.test(a.dark)).toBe(true);
    }
  });
});

describe("apiUrl", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_BASE_PATH;
  });

  it("prefixes the trailing slash to routes (BASE empty by default)", async () => {
    delete process.env.NEXT_PUBLIC_BASE_PATH;
    vi.resetModules();
    const { BASE, apiUrl } = await import("./api");
    expect(BASE).toBe("");
    expect(apiUrl("/api/sessions")).toBe("/api/sessions/");
  });

  it("honors NEXT_PUBLIC_BASE_PATH", async () => {
    process.env.NEXT_PUBLIC_BASE_PATH = "/cw";
    vi.resetModules();
    const { BASE, apiUrl } = await import("./api");
    expect(BASE).toBe("/cw");
    expect(apiUrl("/api/sessions")).toBe("/cw/api/sessions/");
  });

  it("NEXT_PUBLIC_API_URL wins over BASE_PATH (split deployment)", async () => {
    process.env.NEXT_PUBLIC_API_URL = "http://back:3100/";
    process.env.NEXT_PUBLIC_BASE_PATH = "/cw";
    vi.resetModules();
    const { BASE, apiUrl } = await import("./api");
    expect(BASE).toBe("http://back:3100");
    expect(apiUrl("/api/sessions")).toBe("http://back:3100/api/sessions/");
    delete process.env.NEXT_PUBLIC_API_URL;
  });
});