import { findSession, reconcile } from "@/lib/copilotStore";
import { remove, rename } from "@/lib/store";
import {
  closeAgentSession,
  listAgentSessions,
  getSessionLog,
  materializeSession,
  pendingPermissionFor,
  prompt,
  renameCliSession,
  removeCliSessionDir,
  resetSessionLog,
  adminPrompt,
  runningTurns,
  SESSION_OPS_MODE,
} from "@/lib/acp";
import { materialize } from "@/lib/materialize";
import type { ChatMessage, SessionSummary } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const session = (await reconcile()).find((s) => s.id === id);
  if (!session)
    return Response.json({ error: "Session not found" }, { status: 404 });
  // history is materialized over the ACP channel (session/load when there
  // is no RAM log + live updates already captured in sessionLog); CLI
  // internal files are never read
  let messages: ChatMessage[] = [];
  let note: string | undefined;
  try {
    await materializeSession(id);
    messages = materialize(getSessionLog(id) ?? []);
  } catch (e) {
    note = `Failed to materialize history: ${errMsg(e)}`;
  }
  // pending permission (if the stream died with an unanswered card: it is
  // re-shown in the web; never self-authorized) + live turn in the daemon
  // (zombie: the client polls until it finishes)
  const pending = pendingPermissionFor(id);
  return Response.json({
    session: {
      ...session,
      messages,
      pending,
      running: runningTurns.has(id),
    },
    ...(note ? { note } : {}),
  });
}

export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const raw = String(body?.name ?? "").trim();
  if (!raw) return Response.json({ error: "Missing name" }, { status: 400 });
  const session: SessionSummary | undefined = await findSession(id);
  if (!session)
    return Response.json({ error: "Session not found" }, { status: 404 });
  if (runningTurns.has(id))
    return Response.json(
      { error: "The session is processing a message; wait for it to finish." },
      { status: 429 }
    );

  // session with turns in the CLI? (only those appear in session/list)
  let previous: string | null = null;
  try {
    previous =
      (await listAgentSessions()).find((r) => r.sessionId === id)?.title ?? null;
  } catch {
    previous = null;
  }

  if (previous === null) {
    // zero-turn: the CLI does not list the session → rename in the RAM
    // overlay (on the first turn, session/list wins)
    const s = rename(id, raw);
    if (SESSION_OPS_MODE === "host") {
      // host workaround only: also persist to the CLI yaml (created on
      // session/new) so the name survives the first turn (user_named=true
      // freezes it); with the slash path the first turn titles it as usual
      await renameCliSession(id, raw).catch(() => {});
    }
    return Response.json({ session: s });
  }

  let finalName: string;
  if (SESSION_OPS_MODE === "slash") {
    // ── SLASH PATH (original ≤1.0.88; broken since 1.0.89, see acp.ts) ──
    // `/session rename` renames ONLY the current session of the CLI driver:
    // it is injected as a slash prompt on the target session itself (slashes
    // do not create turns). Then it is verified against session/list and only
    // written locally if the CLI confirms; otherwise a visible web error.
    try {
      const r = await prompt(id, [{ type: "text", text: `/session rename ${raw}` }]);
      if (r.error) throw new Error(r.error.message || JSON.stringify(r.error));
    } catch (e) {
      return Response.json(
        { error: `CLI could not rename: ${errMsg(e)}` },
        { status: 502 }
      );
    }
    try {
      const title =
        (await listAgentSessions()).find((x) => x.sessionId === id)?.title ?? "";
      if (title && title !== previous) finalName = title.trim().slice(0, 80) || raw;
      else if (title && title === raw) finalName = raw;
      else throw new Error("session/list does not reflect the rename");
    } catch (e) {
      return Response.json(
        { error: `CLI did not confirm rename: ${errMsg(e)}` },
        { status: 502 }
      );
    }
  } else {
    // ── HOST WORKAROUND (1.0.89+): edit the CLI's workspace.yaml ──
    // under ACP the `/session rename` slash is a no-op (it replies
    // "Session renamed to: X" without changing session/list) and there is
    // no official method: the host renames the way the TUI does (slashes
    // create no turns nor pollute the history). Then it verifies against
    // session/list.
    const clean = raw.replace(/[\r\n\t]+/g, " ");
    try {
      await renameCliSession(id, clean);
    } catch (e) {
      return Response.json(
        { error: `CLI could not rename: ${errMsg(e)}` },
        { status: 502 }
      );
    }
    try {
      const title =
        (await listAgentSessions()).find((x) => x.sessionId === id)?.title ?? "";
      if (title !== clean)
        throw new Error("session/list does not reflect the rename");
      finalName = clean;
    } catch (e) {
      return Response.json(
        { error: `CLI did not confirm rename: ${errMsg(e)}` },
        { status: 502 }
      );
    }
  }
  // the CLI already confirmed the new title → it is the truth, no local cache
  return Response.json({
    session: { ...session, name: finalName },
  });
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  const session: SessionSummary | undefined = await findSession(id);
  if (!session)
    return Response.json({ error: "Session not found" }, { status: 404 });
  if (runningTurns.has(id))
    return Response.json(
      { error: "You cannot delete a session with a turn in progress." },
      { status: 429 }
    );

  // does it exist as a CLI session (with turns)?
  let inCli = false;
  try {
    inCli = (await listAgentSessions()).some((r) => r.sessionId === id);
  } catch {
    inCli = false;
  }

  if (inCli) {
    // deletion requires closing first the driver in flight of OUR
    // connection (verified: with the driver open, a prompt to the deleted
    // session would stay alive)
    await closeAgentSession(id).catch(() => {});

    if (SESSION_OPS_MODE === "slash") {
      // ── SLASH PATH (original ≤1.0.88; broken since 1.0.89, see acp.ts) ──
      const r = await adminPrompt(`/session delete ${id} --yes`).catch((e) => ({
        error: { message: errMsg(e) },
      }));
      if (r.error)
        return Response.json(
          { error: `The CLI could not delete: ${r.error.message}` },
          { status: 502 }
        );
    } else {
      // ── HOST WORKAROUND (1.0.89+): remove the CLI's persisted state ──
      // the yaml dir is the session/list source of truth (see acp.ts)
      try {
        await removeCliSessionDir(id);
      } catch (e) {
        return Response.json(
          { error: `Could not remove the CLI session state: ${errMsg(e)}` },
          { status: 502 }
        );
      }
    }

    // official verification: it must disappear from the CLI session/list
    let stillThere: boolean;
    try {
      stillThere = (await listAgentSessions()).some((x) => x.sessionId === id);
    } catch (e) {
      return Response.json(
        { error: `Could not verify deletion: ${errMsg(e)}` },
        { status: 502 }
      );
    }
    if (stillThere) {
      // NO tombstones: the CLI wins. The session keeps existing there and
      // reconciliation keeps it; the failure is reported to the user.
      return Response.json(
        { error: "The CLI could not delete the session (still in session/list)." },
        { status: 502 }
      );
    }
  } else if (SESSION_OPS_MODE === "host") {
    // zero-turn session: it is not in session/list, but its state dir can
    // exist (created on session/new) → only the host workaround cleans it
    await removeCliSessionDir(id).catch(() => {});
  }

  remove(id);
  resetSessionLog(id);
  return Response.json({ ok: true });
}