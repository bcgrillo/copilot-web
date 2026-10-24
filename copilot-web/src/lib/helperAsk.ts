import { randomUUID } from "node:crypto";

/** ask_user questions from the MCP helper, in RAM. Nothing on disk —
 * Principle 0. The helper (copilot-web/mcp/ask-user.mjs) POSTs here and the
 * UI shows the card on the session(s) with a turn in progress; the answer
 * (user text) is returned via polling. */
export type PendingAsk = {
  id: string;
  question: string;
  kind: "info" | "choice";
  options: string[];
  createdAt: number;
};

type AskEntry = PendingAsk & { answer?: string; answeredAt?: number };

const g = globalThis as { __webHelperAsks?: Map<string, AskEntry> };
const asks: Map<string, AskEntry> = (g.__webHelperAsks ??= new Map());

export function newAsk(question: string, kind: "info" | "choice", options: string[]): PendingAsk {
  const a: AskEntry = { id: randomUUID(), question, kind, options, createdAt: Date.now() };
  asks.set(a.id, a);
  return { id: a.id, question, kind, options, createdAt: a.createdAt };
}

/** pending answers (for the UI card); those older than 5 min disappear —
 * the helper would already have timed out */
export function pendingAsks(): PendingAsk[] {
  const now = Date.now();
  return [...asks.values()]
    .filter((a) => a.answer === undefined && now - a.createdAt < 300_000)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(({ id, question, kind, options, createdAt }) => ({ id, question, kind, options, createdAt }));
}

export function answerAsk(id: string, answer: string): boolean {
  const a = asks.get(id);
  if (!a || a.answer !== undefined) return false;
  a.answer = answer;
  a.answeredAt = Date.now();
  return true;
}

/** resolved, pending, or null when the id does not exist */
export function getAsk(id: string): { pending: boolean; answer?: string } | null {
  const a = asks.get(id);
  if (!a) return null;
  return a.answer === undefined ? { pending: true } : { pending: false, answer: a.answer };
}