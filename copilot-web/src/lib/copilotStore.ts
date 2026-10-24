/**
 * Puente a las sesiones del agente (ACP `session/list`, sessionCapabilities,
 * copilot >= 1.0.80): devuelve sessionId/title/updatedAt ordenado por última
 * actividad. La lista es AL VUELO (nada persistido): official + overlay 0-turn
 * de la web (lib/store.ts), ordenada por actividad. El título SIEMPRE es el
 * del CLI (adoptamos lo que diga session/list; los renombres web pasan por el
 * CLI, y si fallan → error visible, no caché).
 */
import {
  listAgentSessions,
  type AgentSessionInfo,
} from "./acp";
import { listZeroTurn, sortByActivity } from "./store";
import type { SessionSummary } from "./types";

const MAX_SESSIONS = 300;

function toSummary(r: AgentSessionInfo): SessionSummary {
  const name = (r.title?.trim() || `Sesión ${r.sessionId.slice(0, 8)}`).slice(0, 80);
  return {
    id: r.sessionId,
    name,
    createdAt: r.updatedAt ?? new Date().toISOString(),
    updatedAt: r.updatedAt,
    cwd: r.cwd,
  };
}

/**
 * Fusión al vuelo (session/list + overlay 0-turn). Idempotente. El overlay
 * solo aporta lo que el CLI aún no publica; en cuanto hay primer turno,
 * session/list manda.
 */
export async function reconcile(): Promise<SessionSummary[]> {
  let official: AgentSessionInfo[] = [];
  try {
    official = await listAgentSessions();
  } catch {
    official = []; // daemon caído: seguimos con lo que conocemos (overlay)
  }
  const mine = new Map(
    official
      .filter((r) => r.sessionId)
      .slice(0, MAX_SESSIONS)
      .map((r) => [r.sessionId, toSummary(r)] as const)
  );
  for (const z of listZeroTurn()) if (!mine.has(z.id)) mine.set(z.id, z);
  return sortByActivity([...mine.values()]);
}

/** Existencia en la lista fusionada (para routes): CLI o overlay 0-turn. */
export async function findSession(
  id: string
): Promise<SessionSummary | undefined> {
  return (await reconcile()).find((s) => s.id === id);
}
