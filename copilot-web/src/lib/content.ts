/**
 * Shared extraction helpers for ACP content blocks and timeline parts.
 * Used by the SSE turn server (api/chat/route.ts) and by the history
 * materializer (lib/materialize.ts) so both stay byte-identical per event.
 */
import type { MessagePart } from "./types";

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** Plain text of an ACP content field: a string, a single block, or a flat/nested list. */
export function textContentOf(c: unknown): string {
  if (typeof c === "string") return c;
  if (isObj(c)) return typeof c.text === "string" ? c.text : "";
  if (Array.isArray(c))
    return c
      .map((b) => {
        if (typeof b === "string") return b;
        if (!isObj(b)) return "";
        if (typeof b.text === "string") return b.text;
        // tool_call_update nests { type: "content", content: { type: "text" } }
        const inner = b.content;
        if (isObj(inner) && typeof inner.text === "string") return inner.text;
        return "";
      })
      .join("");
  return "";
}

/** Chip detail for a tool_call: shell commands verbatim, other input as JSON. */
export function toolInputDetail(
  rawInput: unknown,
  content: unknown
): string | undefined {
  const raw = isObj(rawInput) ? (rawInput as { command?: string }) : undefined;
  if (raw?.command) return `$ ${raw.command}`;
  if (raw) return JSON.stringify(raw).slice(0, 400);
  return textContentOf(content) || undefined;
}

/** Trailing marker the CLI appends to bash output captures; hidden in chips. */
export function cleanToolOutput(s: string): string {
  return s.replace(/\n?<shellId: [^>]*>\s*$/, "");
}

/** Plain text of a timeline: concatenation of its text parts. */
export function textOfParts(parts: MessagePart[]): string {
  return parts.flatMap((p) => (p.kind === "text" ? [p.content] : [])).join("");
}