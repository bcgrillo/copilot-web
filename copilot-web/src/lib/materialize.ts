/**
 * Materializes a session history from the ACP update log (sessionLog in
 * lib/acp.ts: session/load replay + live updates + synthetic permission
 * events). Replaces parsing the CLI's internal events.jsonl: the ACP channel
 * only — no CLI internals are ever read from disk.
 *
 * Semantics verified against the daemon (CLI 1.0.80):
 * - user_message_chunk composes the user bubble (attachments arrive annotated
 *   as "[Resource link: file://…]", which the client renders as a chip).
 * - agent_message_chunk / agent_thought_chunk compose the reply.
 * - tool_call / tool_call_update compose chips keyed by toolCallId; output
 *   arrives in rawOutput.content (or rawOutput.output, or nested content[]).
 * - permission_request / permission_resolved (synthetic web events) become
 *   chip metadata or their own "permission ·" chip, like the live turn.
 * - available_commands_update and other UI-less kinds are ignored.
 */
import { DAEMON_INFO_RE, type AcpUpdate } from "./acp";
import { cleanToolOutput, textContentOf, toolInputDetail } from "./content";
import type { ChatMessage, MessagePart } from "./types";

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** Annotates resource_link blocks in the format the client already renders. */
function userBlockText(c: unknown): string {
  const single = (block: Record<string, unknown>): string => {
    if (block.type === "resource_link") {
      const uri = String(block.uri ?? "").replace(/^file:\/\//, "");
      return uri ? `[Resource link: file://${uri}]` : "";
    }
    return typeof block.text === "string" ? block.text : "";
  };
  if (isObj(c)) return single(c);
  if (Array.isArray(c)) return c.map((b) => (isObj(b) ? single(b) : "")).join("");
  return "";
}

type OpenAssistant = { deniable: Set<string> };

/**
 * ACP updates → messages. Log order is the real order (replay arrives before
 * session/load resolves; live updates stream while the turn runs).
 */
export function materialize(updates: AcpUpdate[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  let openMsg: ChatMessage | null = null;
  let openState: OpenAssistant | null = null;

  const flushAssistant = () => {
    if (!openMsg || !openState) return;
    const msg = openMsg;
    openMsg = null;
    openState = null;
    msg.content = (msg.parts ?? [])
      .flatMap((p) => (p.kind === "text" ? [p.content] : []))
      .join("");
    // reasoning already lives in parts (interleaved segments); checking text
    // plus non-empty parts is enough
    const has = msg.content.trim() || (msg.parts?.length ?? 0) > 0;
    if (!has) {
      const i = out.indexOf(msg);
      if (i >= 0) out.splice(i, 1);
    }
  };

  const tsOf = (u: AcpUpdate): string | undefined =>
    typeof u.ts === "string" && u.ts ? u.ts : undefined;

  const ensureAssistant = (ts?: string): { msg: ChatMessage; state: OpenAssistant } => {
    if (openMsg && openState) return { msg: openMsg, state: openState };
    const msg: ChatMessage = {
      id: `mat-${out.length}`,
      role: "assistant",
      content: "",
    };
    if (ts) msg.ts = ts;
    out.push(msg);
    openMsg = msg;
    const state: OpenAssistant = { deniable: new Set() };
    openState = state;
    return { msg, state };
  };

  const pushTool = (
    msg: ChatMessage,
    id: string | undefined,
    title: string,
    status: string,
    detail?: string
  ) => {
    msg.parts = msg.parts ?? [];
    msg.parts.push({ kind: "tool", toolCallId: id, title, status, detail });
  };

  /** Finds the last chip with that toolCallId (scans history backwards). */
  const findTool = (
    id: string
  ): { msg: ChatMessage; part: MessagePart } | undefined => {
    for (let m = out.length - 1; m >= 0; m--) {
      const parts = out[m].parts ?? [];
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        if (p.kind === "tool" && p.toolCallId === id) return { msg: out[m], part: p };
      }
    }
    return undefined;
  };

  for (const u of updates) {
    const kind = u.sessionUpdate;

    if (kind === "user_message_chunk") {
      flushAssistant();
      const chunk = userBlockText(u.content);
      const last = out[out.length - 1];
      if (last && last.role === "user") last.content += chunk;
      else {
        const mu: ChatMessage = { id: `mat-${out.length}`, role: "user", content: chunk };
        const uts = tsOf(u);
        if (uts) mu.ts = uts;
        out.push(mu);
      }
      continue;
    }

    if (kind === "agent_message_chunk" || kind === "agent_thought_chunk") {
      const { msg } = ensureAssistant(tsOf(u));
      const text = textContentOf(u.content);
      if (!text) continue;
      msg.parts = msg.parts ?? [];
      const last = msg.parts[msg.parts.length - 1];
      if (kind === "agent_thought_chunk") {
        // deltas concatenate into the last contiguous reasoning segment; a
        // jump to text/tool opens a new one (like the CLI: alternating
        // thought, sentence, tool…). NOTE: the cold replay of session/load
        // does not include thought chunks (ACP does not replay them), so this
        // only fills hot sessions (sessionLog kept in RAM)
        if (last && last.kind === "reasoning") last.content += text;
        else msg.parts.push({ kind: "reasoning", content: text });
      } else {
        // daemon "Info: <file>" noise after create/edit: the chip already
        // shows it, so the duplicate is dropped
        if (
          !(last && last.kind === "text") &&
          DAEMON_INFO_RE.test(text) &&
          msg.parts.some((p) => p.kind === "tool")
        )
          continue;
        if (last && last.kind === "text") last.content += text;
        else msg.parts.push({ kind: "text", content: text });
      }
      continue;
    }

    if (kind === "tool_call") {
      const { msg } = ensureAssistant(tsOf(u));
      const id = typeof u.toolCallId === "string" ? u.toolCallId : undefined;
      const detail = toolInputDetail(u.rawInput, u.content);
      pushTool(
        msg, id,
        String(u.title ?? "tool"),
        String(u.status ?? "pending"), detail
      );
      continue;
    }

    if (kind === "tool_call_update") {
      const id = typeof u.toolCallId === "string" ? u.toolCallId : "";
      if (!id) continue;
      ensureAssistant(tsOf(u));
      const st = typeof u.status === "string" ? u.status : undefined;
      const rawOut = isObj(u.rawOutput)
        ? (u.rawOutput as { content?: string; output?: string })
        : undefined;
      const rawDetail = rawOut
        ? rawOut.content ?? rawOut.output ?? ""
        : textContentOf(u.content);
      const detail = rawDetail ? cleanToolOutput(rawDetail) : "";
      const hit = findTool(id);
      if (hit && hit.part.kind === "tool") {
        const p = hit.part;
        const eff = st === "failed" ? "error" : st;
        if (eff && (eff === "error" || p.status !== "error")) p.status = eff;
        if (detail)
          p.detail =
            p.detail?.startsWith("$ ") && !detail.startsWith("$ ")
              ? `${p.detail}\n\n${detail}`
              : detail;
      } else if (detail || st) {
        // update with no preceding tool_call (partial replay): new chip
        const { msg } = ensureAssistant(tsOf(u));
        pushTool(
          msg, id,
          String(u.title ?? "tool"), st ?? "completed", detail || undefined
        );
      }
      continue;
    }

    if (kind === "permission_request") {
      const { msg, state } = ensureAssistant(tsOf(u));
      const reqId = typeof u.reqId === "number" ? u.reqId : null;
      const tcId = typeof u.toolCallId === "string" ? u.toolCallId : undefined;
      if (tcId) state.deniable.add(tcId);
      if (!tcId)
        pushTool(
          msg,
          reqId === null ? undefined : `perm-${reqId}`,
          `permission · ${String(u.title ?? "tool")}`,
          "pending"
        );
      continue;
    }

    if (kind === "permission_resolved") {
      const reqId = typeof u.reqId === "number" ? u.reqId : null;
      const tcId = typeof u.toolCallId === "string" ? u.toolCallId : undefined;
      const denied = /deny|reject/i.test(String(u.choice ?? ""));
      const { msg, state } = ensureAssistant(tsOf(u));
      if (tcId) state.deniable.delete(tcId);
      const marker = reqId === null ? null : `perm-${reqId}`;
      const parts = msg.parts ?? [];
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        if (p.kind === "tool" && marker !== null && p.toolCallId === marker) {
          parts[i] = {
            ...p,
            title: `${denied ? "permission denied" : "permission granted"} · ${p.title.replace(/^permission · /, "")}`,
            status: denied ? "error" : "completed",
          };
          break;
        }
      }
      if (denied && tcId) {
        const hit = findTool(tcId);
        if (hit && hit.part.kind === "tool") {
          const parts = hit.msg.parts ?? [];
          const i = parts.indexOf(hit.part);
          if (i >= 0)
            parts[i] = { ...hit.part, title: `${hit.part.title} (denied)`, status: "error" };
        }
      }
      continue;
    }

    // available_commands_update and any other kind: no UI
  }

  flushAssistant();
  return out;
}
