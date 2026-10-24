import { beforeEach, describe, expect, it } from "vitest";
import { create, get, listZeroTurn, remove, rename, sortByActivity, touch } from "./store";
import type { SessionSummary } from "./types";

beforeEach(() => {
  // clear the SAME map the module captured at import (do not replace it)
  const g = globalThis as { __webZeroTurn?: Map<string, SessionSummary> };
  g.__webZeroTurn?.clear();
});

describe("zero-turn overlay store", () => {
  it("creates with a default name when none given", () => {
    const s = create(undefined, "id-1", "/workspace");
    expect(get("id-1")).toMatchObject({
      id: "id-1",
      cwd: "/workspace",
    });
    // default name: "Session N" with the overlay count — English UI string
    expect(s.name).toMatch(/^Session \d+$/);
  });

  it("keeps the provided name, trimmed", () => {
    const s = create("  my chat  ", "id-2");
    expect(s.name).toBe("my chat");
  });

  it("renames only overlay sessions and trims the value", () => {
    create("old", "id-3");
    const r = rename("id-3", "  new name ");
    expect(r?.name).toBe("new name");
    expect(rename("nope", "x")).toBeUndefined();
    expect(rename("id-3", "   ")?.name).toBe("new name");
  });

  it("touch bumps updatedAt", () => {
    create("old", "id-4");
    const before = get("id-4")!.updatedAt as string;
    touch("id-4");
    const after = get("id-4")!.updatedAt as string;
    expect(Date.parse(after) >= Date.parse(before)).toBe(true);
  });

  it("removes and lists", () => {
    create(undefined, "id-5");
    create(undefined, "id-6", "/w");
    expect(listZeroTurn()).toHaveLength(2);
    expect(remove("id-5")).toBe(true);
    expect(remove("id-5")).toBe(false);
    expect(listZeroTurn()).toHaveLength(1);
  });

  it("sortByActivity puts the most recently updated first", () => {
    const a: SessionSummary = { id: "a", name: "a", createdAt: "2026-01-01" };
    const b: SessionSummary = { id: "b", name: "b", createdAt: "2026-01-02", updatedAt: "2026-01-05" };
    const c: SessionSummary = { id: "c", name: "c", createdAt: "2026-01-03", updatedAt: "2026-01-09" };
    expect(sortByActivity([a, b, c]).map((s) => s.id)).toEqual(["c", "b", "a"]);
  });
});