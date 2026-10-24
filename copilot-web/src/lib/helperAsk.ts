import { randomUUID } from "node:crypto";

/** Preguntas del MCP helper (tool ask_user) en RAM. Nada en disco —
 * Principio 0. El helper (copilot-web/mcp/ask-user.mjs) POSTea aquí y la UI
 * muestra la card en la(s) sesión(es) con turno en curso; la respuesta (texto
 * del usuario) se devuelve por polling. */
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

/** respuestas pendientes (para la card de la UI); las de más de 5 min
 * desaparecen — el helper ya habría recibido timeout */
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

/** resolved, pending, o null si el id no existe */
export function getAsk(id: string): { pending: boolean; answer?: string } | null {
  const a = asks.get(id);
  if (!a) return null;
  return a.answer === undefined ? { pending: true } : { pending: false, answer: a.answer };
}