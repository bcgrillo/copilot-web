import { describe, expect, it } from "vitest";
import { materialize } from "./materialize";
import { DAEMON_INFO_RE } from "./acp";
import type { AcpUpdate } from "./acp";
import type { ChatMessage, MessagePart } from "./types";

type ToolPart = Extract<MessagePart, { kind: "tool" }>;
const at = (m: ChatMessage, i = 0): ToolPart => (m.parts ?? [])[i] as ToolPart;

const u = (sessionUpdate: string, extra: Record<string, unknown> = {}): AcpUpdate =>
  ({ sessionUpdate, ...extra });

describe("materialize", () => {
  it("composes consecutive user chunks into one bubble", () => {
    const msgs = materialize([
      u("user_message_chunk", { content: { type: "text", text: "hel" } }),
      u("user_message_chunk", { content: { type: "text", text: "lo" } }),
    ]);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].content).toBe("hello");
  });

  it("annotates resource_link blocks as client-chip text", () => {
    const msgs = materialize([
      u("user_message_chunk", {
        content: [
          { type: "text", text: "check " },
          { type: "resource_link", uri: "file:///workspace/a.txt" },
        ],
      }),
    ]);
    expect(msgs[0].content).toBe("check [Resource link: file:///workspace/a.txt]");
  });

  it("concatenates message and thought deltas and splits reasoning segments", () => {
    const msgs = materialize([
      u("agent_thought_chunk", { content: { type: "text", text: "thinking " } }),
      u("agent_thought_chunk", { content: { type: "text", text: "hard" } }),
      u("agent_message_chunk", { content: { type: "text", text: "the answer" } }),
    ]);
    expect(msgs[0].content).toBe("the answer");
    const parts = msgs[0].parts ?? [];
    expect(parts).toEqual([
      { kind: "reasoning", content: "thinking hard" },
      { kind: "text", content: "the answer" },
    ]);
  });

  it("stamps ts only when provided", () => {
    const stamped = materialize([
      u("agent_message_chunk", {
        ts: "2026-01-01T00:00:00Z",
        content: { type: "text", text: "x" },
      }),
    ]);
    expect(stamped[0].ts).toBe("2026-01-01T00:00:00Z");
    const unstamped = materialize([
      u("agent_message_chunk", { content: { type: "text", text: "x" } }),
    ]);
    expect(unstamped[0].ts).toBeUndefined();
  });

  describe("tools", () => {
    it("creates a pending chip and updates status/detail on tool_call_update", () => {
      const msgs = materialize([
        u("tool_call", {
          toolCallId: "t1",
          title: "terminal",
          status: "pending",
          rawInput: { command: "echo hi" },
        }),
        u("tool_call_update", {
          toolCallId: "t1",
          status: "completed",
          rawOutput: { content: "hi\n<shellId: 9>" },
        }),
      ]);
      const chips = (msgs[0].parts ?? []).filter((p) => p.kind === "tool");
      expect(chips).toHaveLength(1);
      expect(chips[0]).toEqual({
        kind: "tool",
        toolCallId: "t1",
        title: "terminal",
        status: "completed",
        detail: "$ echo hi\n\nhi",
      });
    });

    it("maps failed to error and never downgrades an errored chip", () => {
      const msgs = materialize([
        u("tool_call", { toolCallId: "t2", title: "terminal", status: "pending" }),
        u("tool_call_update", { toolCallId: "t2", status: "failed", rawOutput: { output: "boom" } }),
        u("tool_call_update", { toolCallId: "t2", status: "pending" }),
      ]);
      const chip = at(msgs[0]);
      expect(chip.status).toBe("error");
      expect(chip.detail).toBe("boom");
    });

    it("synthesizes a chip for updates without a preceding tool_call", () => {
      const msgs = materialize([
        u("tool_call_update", {
          toolCallId: "ghost",
          title: "terminal",
          status: "completed",
          rawOutput: { content: "late" },
        }),
      ]);
      expect(at(msgs[0]).title).toBe("terminal");
      expect(at(msgs[0]).detail).toBe("late");
    });

    it("appends output below a shell command detail without replacing it", () => {
      const msgs = materialize([
        u("tool_call", {
          toolCallId: "t3",
          title: "terminal",
          rawInput: { command: "whoami" },
        }),
        u("tool_call_update", {
          toolCallId: "t3",
          rawOutput: { content: "agent" },
        }),
      ]);
      expect(at(msgs[0]).detail).toBe("$ whoami\n\nagent");
    });
  });

  describe("permissions", () => {
    it("keeps granted permission chips and resolves them", () => {
      const msgs = materialize([
        u("user_message_chunk", { content: { type: "text", text: "open file?" } }),
        u("permission_request", { reqId: 7, title: "file_read", toolCallId: "tA" }),
        u("permission_resolved", { reqId: 7, choice: "allow_once", toolCallId: "tA" }),
        u("agent_message_chunk", { content: { type: "text", text: "done" } }),
      ]);
      const assistant = msgs[1];
      expect(assistant.role).toBe("assistant");
      // the request had a toolCallId → the chip is deniable on the real tool,
      // no standalone permission chip
      const parts = assistant.parts ?? [];
      expect(parts.some((p) => p.kind === "tool" && p.title.startsWith("permission ·"))).toBe(false);
      expect(parts.some((p) => p.kind === "text" && p.content === "done")).toBe(true);
    });

    it("renders a standalone chip for requests without toolCallId and titles denial", () => {
      const msgs = materialize([
        u("permission_request", { reqId: 3, title: "file_write" }),
        u("permission_resolved", { reqId: 3, choice: "reject_once" }),
      ]);
      expect(at(msgs[0]).title).toBe("permission denied · file_write");
      expect(at(msgs[0]).status).toBe("error");
      expect(at(msgs[0]).toolCallId).toBe("perm-3");
    });

    it("marks the real tool as denied when the request carried a toolCallId", () => {
      const msgs = materialize([
        u("tool_call", { toolCallId: "tB", title: "terminal", status: "pending" }),
        u("permission_request", { reqId: 5, title: "terminal", toolCallId: "tB" }),
        u("permission_resolved", { reqId: 5, choice: "reject_once", toolCallId: "tB" }),
      ]);
      expect(at(msgs[0])).toMatchObject({
        toolCallId: "tB",
        title: "terminal (denied)",
        status: "error",
      });
    });
  });

  describe("noise filtering", () => {
    it("matches the Info chunk shape", () => {
      expect(DAEMON_INFO_RE.test("Info: /workspace/a.txt")).toBe(true);
      expect(DAEMON_INFO_RE.test("Info:")).toBe(false);
    });

    it('drops "Info: <path>" text when a tool chip already showed it', () => {
      const msgs = materialize([
        u("tool_call", { toolCallId: "t1", title: "write", status: "completed" }),
        u("agent_message_chunk", { content: { type: "text", text: "Info: /workspace/b.txt" } }),
      ]);
      expect(
        ((msgs[0].parts ?? []).filter((p) => p.kind === "text"))
      ).toHaveLength(0);
    });

    it("keeps Info-looking text mid-sentence (not after a tool)", () => {
      const msgs = materialize([
        u("agent_message_chunk", {
          content: { type: "text", text: "prefix Info: /x.txt suffix" },
        }),
      ]);
      expect(msgs[0].content).toBe("prefix Info: /x.txt suffix");
    });
  });

  it("drops assistant placeholders with no content", () => {
    const msgs = materialize([
      u("user_message_chunk", { content: { type: "text", text: "q" } }),
    ]);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("user");
  });

  it("interleaves user and assistant turns preserving order", () => {
    const msgs = materialize([
      u("user_message_chunk", { content: { type: "text", text: "1" } }),
      u("agent_message_chunk", { content: { type: "text", text: "2" } }),
      u("user_message_chunk", { content: { type: "text", text: "3" } }),
      u("agent_message_chunk", { content: { type: "text", text: "4" } }),
    ]);
    expect(msgs.map((m) => `${m.role}:${m.content}`)).toEqual([
      "user:1",
      "assistant:2",
      "user:3",
      "assistant:4",
    ]);
  });
});