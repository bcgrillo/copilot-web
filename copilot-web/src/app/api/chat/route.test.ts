import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mockAcp = vi.hoisted(() => {
  const fns = {
    prompt: vi.fn(),
    subscribeUpdates: vi.fn(),
    isLoading: vi.fn((): boolean => false),
    cancelSession: vi.fn(async () => {}),
    pendingPermissionFor: vi.fn(() => undefined),
    runningTurns: new Set<string>(),
  };
  return fns;
});
vi.mock("@/lib/acp", () => ({
  ...mockAcp,
  // same shape the real module exports (route only regex-tests it)
  DAEMON_INFO_RE: /^Info:\s*\S+\s*$/,
}));
vi.mock("@/lib/copilotStore", () => ({
  findSession: vi.fn(async (id: string) =>
    id === "ghost" ? undefined : { id, name: "T", createdAt: "2026-01-01" }
  ),
}));
vi.mock("@/lib/store", () => ({ touch: vi.fn() }));

import { POST } from "@/app/api/chat/route";
const findSessionMock = vi.mocked(
  (await import("@/lib/copilotStore")).findSession
);
const touchMock = vi.mocked((await import("@/lib/store")).touch);

const acp = mockAcp as unknown as {
  prompt: ReturnType<typeof vi.fn>;
  subscribeUpdates: ReturnType<typeof vi.fn>;
  isLoading: ReturnType<typeof vi.fn>;
  cancelSession: ReturnType<typeof vi.fn>;
  pendingPermissionFor: ReturnType<typeof vi.fn>;
  runningTurns: Set<string>;
};

type SSE = { type: string; data: Record<string, unknown> };

function post(body: unknown, signal?: AbortSignal): Promise<Response> {
  return POST(
    new Request("http://localhost/api/chat/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    })
  );
}

async function events(res: Response): Promise<SSE[]> {
  const text = await res.text();
  return text
    .split("\n\n")
    .filter((c) => c.startsWith("data: "))
    .map((c) => JSON.parse(c.slice(6)) as SSE);
}

/** Fake SSE headers (route overrides them on the Response). */
function expectSSEHeaders(res: Response) {
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
}

describe("POST /api/chat/ — validation", () => {
  it("404 for an unknown session", async () => {
    const res = await post({ sessionId: "ghost", message: "hi" });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Session not found");
  });

  it("400 for an empty message", async () => {
    const res = await post({ sessionId: "s1", message: "   " });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Empty message");
  });

  it("429 when the session is already running, with the pending permission", async () => {
    acp.runningTurns.add("busy-1");
    acp.pendingPermissionFor.mockReturnValueOnce({
      reqId: 3,
      title: "terminal",
      options: [],
    });
    const res = await post({ sessionId: "busy-1", message: "hi" });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.busy).toBe(true);
    expect(body.pending.reqId).toBe(3);
    acp.runningTurns.delete("busy-1");
  });

  it("400 for an attachment over the size limit", async () => {
    const big = "A".repeat(8 * 1024 * 1024); // ~6 MB decoded (> 5 MB limit)
    const res = await post({
      sessionId: "s1",
      message: "hi",
      attachments: [{ name: "big.bin", content: big }],
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Invalid attachment/);
  });

  it("skips empty attachments instead of failing", async () => {
    let resolvePrompt!: (v: unknown) => void;
    acp.prompt.mockImplementationOnce(
      () => new Promise((r) => (resolvePrompt = r))
    );
    acp.subscribeUpdates.mockImplementationOnce(() => () => {});
    const res = await post({
      sessionId: "s1",
      message: "hi",
      attachments: [{ name: "empty.bin", content: "" }],
    });
    expect(res.status).toBe(200);
    resolvePrompt({ result: { stopReason: "end_turn" } });
    const evs = await events(res);
    expect(evs.at(-1)?.type).toBe("done");
  });
});

describe("POST /api/chat/ — SSE turn", () => {
  beforeEach(() => {
    acp.prompt.mockReset();
    acp.subscribeUpdates.mockReset();
    acp.isLoading.mockReturnValue(false);
    acp.cancelSession.mockClear();
    acp.pendingPermissionFor.mockReset();
    touchMock.mockClear();
  });

  it("happy path: message_start, deltas, tool chips, message, done", async () => {
    const subs: ((u: unknown) => void)[] = [];
    let resolvePrompt!: (v: unknown) => void;
    acp.subscribeUpdates.mockImplementation(
      (_sid: string, cb: (u: unknown) => void) => {
        subs.push(cb);
        return () => {
          subs.length = 0;
        };
      }
    );
    acp.prompt.mockImplementation(
      () => new Promise((r) => (resolvePrompt = r))
    );

    const res = await post({ sessionId: "s1", message: "  hi  " });
    expectSSEHeaders(res);

    // prompt was called with the trimmed message and the text block
    expect(acp.prompt).toHaveBeenCalledWith(
      "s1",
      [{ type: "text", text: "hi" }],
      "hi"
    );

    // daemon is replaying nothing (isLoading false): updates flow
    const cb = subs[0];
    cb({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hel" } });
    cb({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "lo" } });
    cb({
      sessionUpdate: "tool_call",
      toolCallId: "t1",
      title: "terminal",
      rawInput: { command: "ls" },
    });
    cb({
      sessionUpdate: "tool_call_update",
      toolCallId: "t1",
      status: "completed",
      rawOutput: { content: "a.txt\n<shellId: s>" },
    });

    resolvePrompt({
      result: { stopReason: "end_of_turn", usage: { inputTokens: 1, outputTokens: 2 } },
    });

    const evs = await events(res);
    expect(evs.map((e) => e.type)).toEqual([
      "message_start",
      "delta",
      "delta",
      "tool",
      "tool",
      "message",
      "done",
    ]);
    expect(evs[0].data.id).toBeTruthy();
    expect(evs[1].data).toEqual({ id: evs[0].data.id, content: "Hel" });
    const toolCall = evs[3].data;
    expect(toolCall).toMatchObject({
      kind: "tool_call",
      toolCallId: "t1",
      title: "terminal",
      detail: "$ ls",
    });
    const toolUpdate = evs[4].data;
    expect(toolUpdate.detail).toBe("a.txt"); // shellId tail stripped
    const final = evs[5].data;
    expect(final.content).toBe("Hello");
    expect(final.usage).toEqual({ inputTokens: 1, outputTokens: 2 });
    expect(final.tools).toEqual([
      { id: "t1", title: "terminal", status: "completed", detail: "$ ls\n\na.txt" },
    ]);
    // end of turn: metadata stamp + busy slot released
    expect(touchMock).toHaveBeenCalledWith("s1");
    expect(acp.runningTurns.has("s1")).toBe(false);
  });

  it("filters session/load replay updates and daemon Info noise", async () => {
    const subs: ((u: unknown) => void)[] = [];
    let resolvePrompt!: (v: unknown) => void;
    acp.subscribeUpdates.mockImplementation(
      (_sid: string, cb: (u: unknown) => void) => {
        subs.push(cb);
        return () => {};
      }
    );
    acp.prompt.mockImplementation(
      () => new Promise((r) => (resolvePrompt = r))
    );
    const res = await post({ sessionId: "s1", message: "hi" });
    const cb = subs[0];

    // replay (isLoading true): ignored entirely
    acp.isLoading.mockReturnValue(true);
    cb({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "replay" } });
    acp.isLoading.mockReturnValue(false);

    // live daemon info noise right after a tool chip: dropped
    cb({ sessionUpdate: "tool_call", toolCallId: "t1", title: "terminal", status: "completed" });
    cb({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Info: /w/file.txt" } });

    resolvePrompt({ result: { stopReason: "end_of_turn" } });
    const evs = await events(res);
    const types = evs.map((e) => e.type);
    expect(types).not.toContain("delta"); // replay + Info dropped
    // final message carries only the Info-less empty content → system meta
    const final = evs.find((e) => e.type === "message")!.data as {
      parts?: { kind: string; content: string }[];
    };
    expect(String(final.parts!.at(-1)!.content)).toMatch(/no response from the agent/);
  });

  it("sends permission cards and their resolution as SSE events", async () => {
    const subs: ((u: unknown) => void)[] = [];
    let resolvePrompt!: (v: unknown) => void;
    acp.subscribeUpdates.mockImplementation(
      (_sid: string, cb: (u: unknown) => void) => {
        subs.push(cb);
        return () => {};
      }
    );
    acp.prompt.mockImplementation(
      () => new Promise((r) => (resolvePrompt = r))
    );
    const res = await post({ sessionId: "s1", message: "hi" });
    const cb = subs[0];

    cb({
      sessionUpdate: "permission_request",
      reqId: 9,
      title: "terminal",
      options: [{ kind: "allow_once", name: "Allow" }],
    });
    cb({
      sessionUpdate: "permission_resolved",
      reqId: 9,
      choice: "allow_once",
      toolCallId: "t9",
    });

    resolvePrompt({ result: { stopReason: "end_of_turn" } });
    const evs = await events(res);
    expect(evs.map((e) => e.type)).toEqual([
      "permission",
      "permission_resolved",
      "message",
      "done",
    ]);
    expect(evs[0].data).toMatchObject({ reqId: 9, title: "terminal" });
    expect(evs[0].data.options).toHaveLength(1);
    expect(evs[1].data).toMatchObject({ reqId: 9, choice: "allow_once", toolCallId: "t9" });
  });

  it("reports prompt failures as an error event followed by done", async () => {
    acp.subscribeUpdates.mockImplementation(() => () => {});
    acp.prompt.mockRejectedValueOnce(new Error("session/prompt: daemon died"));
    const res = await post({ sessionId: "s1", message: "hi" });
    const evs = await events(res);
    expect(evs.map((e) => e.type)).toEqual(["error", "done"]);
    expect(evs[0].data.message).toMatch(/daemon died/);
    expect(touchMock).toHaveBeenCalledWith("s1");
  });

  it("guard: no first update in 20s → visible warning + cancel + done", async () => {
    vi.useFakeTimers();
    acp.subscribeUpdates.mockImplementation(() => () => {});
    acp.prompt.mockImplementation(() => new Promise(() => {})); // hangs (other driver)
    const res = await post({ sessionId: "guard-1", message: "hi" });
    await vi.advanceTimersByTimeAsync(20_000);
    const evs = await events(res);
    expect(evs.map((e) => e.type)).toEqual(["error", "done"]);
    expect(evs[0].data.message).toMatch(/IN USE by another driver/);
    expect(acp.cancelSession).toHaveBeenCalledWith("guard-1");
    vi.useRealTimers();
  });
});

afterEach(() => {
  acp.runningTurns.clear();
  vi.unstubAllEnvs();
});

// these tests exercise validation/SSE only — the bearer guard (auth.test.ts)
// is bypassed here
beforeEach(() => {
  vi.stubEnv("NO_AUTH", "1");
});