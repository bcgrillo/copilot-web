/**
 * Helpers for the live turn stream.
 *
 * The CLI interleaves thought chunks with tool calls and text. While a
 * reasoning segment is being streamed it stays open; as soon as the next
 * non-reasoning segment starts, that reasoning segment is "finished". We then
 * seal it (done=true) so the UI can collapse it one by one instead of
 * collapsing everything when the turn ends.
 */
import type { MessagePart } from "./types";

/** Marks the last reasoning segment as done unless it already is. */
export function sealLastOpenReasoning(parts: MessagePart[]): MessagePart[] {
  const last = parts[parts.length - 1];
  if (last && last.kind === "reasoning" && !last.done) {
    return [...parts.slice(0, -1), { ...last, done: true }];
  }
  return parts;
}