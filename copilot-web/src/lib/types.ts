export type ChatRole = "user" | "assistant";

export type ToolStep = {
  id?: string;
  title: string;
  status: string;
  /** command/tool output (tool_call_update.content) for the dropdown */
  detail?: string;
};

/** Ordered timeline of a turn: interleaved text spans and tool calls */
export type MessagePart =
  | { kind: "text"; content: string; reasoning?: string }
  | { kind: "reasoning"; content: string }
  | { kind: "tool"; toolCallId?: string; title: string; status: string; detail?: string }
  | { kind: "system"; content: string };

/** Live turn (client only) while the stream arrives */
export type LiveTurn = {
  reasoning: string;
  parts: MessagePart[];
  /** prompt that started the turn (to fold slash command outputs) */
  userPrompt?: string;
  /** pending permission requests (cards above the composer) */
  permissions?: PermissionReq[];
};

/** Permission request from the agent, awaiting an answer from the web */
export type PermissionReq = {
  reqId: number;
  title: string;
  toolCallId?: string;
  /** options offered by the agent (ACP spec): the UI renders each one */
  options?: PermissionOption[];
};

/** One permission option (ACP PermissionOptionKind spec) */
export type PermissionOption = {
  optionId: string;
  kind: string;
  name?: string;
};

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  reasoning?: string;
  tools?: ToolStep[];
  parts?: MessagePart[];
  /** arrival timestamp, stamped in the server RAM cache ONLY for live
   * updates; the cold session/load replay does not have it (ACP does not
   * provide it) */
  ts?: string;
};

/** Agent slash command (ACP available_commands_update snapshot). */
export type AvailableCommand = {
  name: string;
  description?: string;
  input?: { hint?: string } | null;
};

export type SessionSummary = {
  id: string;
  name: string;
  createdAt: string;
  /** session cwd (CLI session/list or web overlay) */
  cwd?: string;
  /** last activity (web overlay or CLI session/list); sort key */
  updatedAt?: string;
  /**
   * content on demand: ONLY filled by GET /api/sessions/:id (ACP channel
   * materialization on the server). The listing is metadata-only.
   */
  messages?: ChatMessage[];
};

export type Attachment = {
  name: string;
  /** base64-encoded content */
  content: string;
};