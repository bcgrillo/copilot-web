import { beforeEach, describe, expect, it, vi } from "vitest";
import { findSession, reconcile } from "./copilotStore";
import { listAgentSessions } from "./acp";
import type { AgentSessionInfo } from "./acp";
import { create } from "./store";
import type { SessionSummary } from "./types";

vi.mock("./acp", () => ({
  listAgentSessions: vi.fn(async (): Promise<AgentSessionInfo[]> => []),
}));

const mockList = vi.mocked(listAgentSessions);

beforeEach(() => {
  // clear the SAME map the module captured at import (do not replace it)
  const g = globalThis as { __webZeroTurn?: Map<string, SessionSummary> };
  g.__webZeroTurn?.clear();
  mockList.mockReset();
  mockList.mockResolvedValue([]);
});

describe("copilotStore.reconcile", () => {
  it("merges CLI sessions and zero-turn overlay, sorted by activity", async () => {
    mockList.mockResolvedValue([
      { sessionId: "cli-old", title: "CLI old", updatedAt: "2026-01-01" },
      { sessionId: "cli-new", title: "", updatedAt: "2026-01-09" },
    ]);
    create("web only", "web-1", "/w");
    // backdate the overlay entry so the sort is deterministic
    const g = globalThis as { __webZeroTurn?: Map<string, SessionSummary> };
    const meta = g.__webZeroTurn?.get("web-1");
    if (meta) meta.updatedAt = meta.createdAt = "2026-01-05";

    const list = await reconcile();
    // cli-new first (most recent), then web-1 (backdated overlay),
    // then cli-old
    expect(list.map((s) => s.id)).toEqual(["cli-new", "web-1", "cli-old"]);
    expect(list.find((s) => s.id === "web-1")?.name).toBe("web only");
  });

  it("falls back to the overlay when the CLI is down", async () => {
    mockList.mockRejectedValue(new Error("daemon down"));
    create("only web", "web-2");
    const list = await reconcile();
    expect(list.map((s) => s.id)).toEqual(["web-2"]);
  });

  it("defaults the CLI title to 'Session <prefix>'", async () => {
    mockList.mockResolvedValue([
      { sessionId: "abcdef123456", title: "  " },
    ]);
    const list = await reconcile();
    expect(list[0].name).toBe("Session abcdef12");
  });

  it("findSession returns from the merged list", async () => {
    mockList.mockResolvedValue([{ sessionId: "cli-1", title: "t" }]);
    expect((await findSession("cli-1"))?.name).toBe("t");
    expect(await findSession("ghost")).toBeUndefined();
  });
});