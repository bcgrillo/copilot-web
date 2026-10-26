import { describe, expect, it } from "vitest";
import type { MessagePart } from "./types";
import { sealLastOpenReasoning } from "./live";

const r = (done?: boolean): MessagePart => ({ kind: "reasoning", content: "x", ...(done ? { done } : {}) });
const text = (): MessagePart => ({ kind: "text", content: "hi" });
const tool = (): MessagePart => ({ kind: "tool", title: "bash", status: "pending" });

describe("sealLastOpenReasoning", () => {
  it("leaves arrays without a trailing open reasoning segment untouched", () => {
    const parts = [text(), r(true)];
    expect(sealLastOpenReasoning(parts)).toBe(parts);
  });

  it("sets done on the last reasoning segment when it is still open", () => {
    const parts = [text(), r()];
    const sealed = sealLastOpenReasoning(parts);
    expect(sealed).not.toBe(parts);
    expect(sealed[1]).toEqual({ kind: "reasoning", content: "x", done: true });
  });

  it("does not seal reasoning segments that are not the last part", () => {
    const parts = [r(), text()];
    expect(sealLastOpenReasoning(parts)).toBe(parts);
  });

  it("does not double-seal", () => {
    const parts = [r(true)];
    expect(sealLastOpenReasoning(parts)).toBe(parts);
    const [first] = sealLastOpenReasoning([r()]);
    expect(first).toEqual({ kind: "reasoning", content: "x", done: true });
    expect(sealLastOpenReasoning([first])[0]).toEqual(first);
  });

  it("works right after a tool part (thought → tool → thought)", () => {
    const parts = [r(true), tool(), r()];
    const sealed = sealLastOpenReasoning(parts);
    expect(sealed[2]).toEqual({ kind: "reasoning", content: "x", done: true });
  });
});