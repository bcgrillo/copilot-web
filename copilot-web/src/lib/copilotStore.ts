/**
 * Bridge to the agent sessions (ACP `session/list`, sessionCapabilities,
 * copilot >= 1.0.80): returns sessionId/title/updatedAt sorted by last
 * activity. The list is ON THE FLY (nothing persisted): official + web's
 * zero-turn overlay (lib/store.ts), sorted by activity. The title is ALWAYS
 * the CLI's (we adopt whatever session/list says; web renames go through
 * the CLI, and on failure → visible error, no cache).
 */
import {
  listAgentSessions,
  type AgentSessionInfo,
} from "./acp";
import { listZeroTurn, sortByActivity } from "./store";
import type { SessionSummary } from "./types";

const MAX_SESSIONS = 300;

function toSummary(r: AgentSessionInfo): SessionSummary {
  const name = (r.title?.trim() || `Session ${r.sessionId.slice(0, 8)}`).slice(0, 80);
  return {
    id: r.sessionId,
    name,
    createdAt: r.updatedAt ?? new Date().toISOString(),
    updatedAt: r.updatedAt,
    cwd: r.cwd,
  };
}

/**
 * On-the-fly merge (session/list + zero-turn overlay). Idempotent. The
 * overlay only contributes what the CLI does not publish yet; as soon as
 * there is a first turn, session/list wins.
 */
export async function reconcile(): Promise<SessionSummary[]> {
  let official: AgentSessionInfo[] = [];
  try {
    official = await listAgentSessions();
  } catch {
    official = []; // daemon down: stick to what we know (overlay)
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

/** Existence check on the merged list (for routes): CLI or zero-turn overlay. */
export async function findSession(
  id: string
): Promise<SessionSummary | undefined> {
  return (await reconcile()).find((s) => s.id === id);
}
