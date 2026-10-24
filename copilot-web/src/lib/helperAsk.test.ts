import { beforeEach, afterEach, describe, expect, it } from "vitest";
import {
  answerAsk,
  getAsk,
  newAsk,
  pendingAsks,
} from "./helperAsk";

beforeEach(() => {
  // clear the SAME map the module captured at import (do not replace it)
  const g = globalThis as { __webHelperAsks?: Map<string, unknown> };
  g.__webHelperAsks?.clear();
});

describe("helperAsk", () => {
  it("creates an ask and exposes it as pending", () => {
    const ask = newAsk("Which file?", "choice", ["a.txt", "b.txt"]);
    expect(ask.id).toBeTruthy();
    expect(pendingAsks()).toHaveLength(1);
  });

  it("answers an ask exactly once", () => {
    const ask = newAsk("Name?", "info", []);
    expect(answerAsk(ask.id, "copilot-web")).toBe(true);
    expect(answerAsk(ask.id, "again")).toBe(false);
    const got = getAsk(ask.id);
    expect(got?.pending).toBe(false);
    expect(got?.answer).toBe("copilot-web");
    expect(pendingAsks()).toHaveLength(0);
  });

  it("returns null for unknown ids", () => {
    expect(getAsk("deadbeef")).toBeNull();
  });

  it("drops asks older than 5 minutes", () => {
    const ask = newAsk("Old?", "info", []);
    const g = globalThis as { __webHelperAsks?: Map<string, { createdAt: number }> };
    const e = g.__webHelperAsks?.get(ask.id);
    if (e) e.createdAt = Date.now() - 301_000;
    const ask2 = newAsk("New?", "info", []);
    const pend = pendingAsks();
    expect(pend.map((a) => a.id)).toEqual([ask2.id]);
  });

  it("returns pending state before the answer", () => {
    const ask = newAsk("Q?", "info", []);
    expect(getAsk(ask.id)).toEqual({ pending: true });
  });
});