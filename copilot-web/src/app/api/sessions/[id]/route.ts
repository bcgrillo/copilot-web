import { findSession, reconcile } from "@/lib/copilotStore";
import { remove, rename } from "@/lib/store";
import {
  closeAgentSession,
  listAgentSessions,
  getSessionLog,
  materializeSession,
  pendingPermissionFor,
  prompt,
  resetSessionLog,
  adminPrompt,
  runningTurns,
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
  // el histórico se materializa por canal ACP (session/load cuando no hay
  // log en RAM + updates en vivo ya capturados en sessionLog); nunca se lee
  // ningún fichero interno del CLI
  let messages: ChatMessage[] = [];
  let note: string | undefined;
  try {
    await materializeSession(id);
    messages = materialize(getSessionLog(id) ?? []);
  } catch (e) {
    note = `Failed to materialize history: ${errMsg(e)}`;
  }
  // permiso pendiente (si el stream murió con una card sin responder: se
  // re-muestra en la web; nunca se autoriza solo) + turno vivo en el daemon
  // (zombi: el cliente lo sondea hasta que termina)
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
  if (!raw) return Response.json({ error: "Falta name" }, { status: 400 });
  const session: SessionSummary | undefined = await findSession(id);
  if (!session)
    return Response.json({ error: "Session not found" }, { status: 404 });
  if (runningTurns.has(id))
    return Response.json(
      { error: "La sesión está procesando un mensaje; espera a que termine." },
      { status: 429 }
    );

  // ¿sesión con turnos en el CLI? (solo esas aparecen en session/list)
  let previous: string | null = null;
  try {
    previous =
      (await listAgentSessions()).find((r) => r.sessionId === id)?.title ?? null;
  } catch {
    previous = null;
  }

  if (previous === null) {
    // 0-turn: el CLI no lista la sesión → renombre en el overlay RAM
    // (al primer turno session/list manda)
    const s = rename(id, raw);
    return Response.json({ session: s });
  }

  // `/session rename` renombra SOLO la sesión actual del driver del CLI: se
  // inyecta como prompt slash en la propia sesión objetivo (los slash no
  // crean turnos). Luego se verifica contra session/list y solo si el CLI
  // confirma se escribe localmente; si no, error visible en la web.
  try {
    const r = await prompt(id, [{ type: "text", text: `/session rename ${raw}` }]);
    if (r.error) throw new Error(r.error.message || JSON.stringify(r.error));
  } catch (e) {
    return Response.json(
      { error: `CLI could not rename: ${errMsg(e)}` },
      { status: 502 }
    );
  }

  let finalName: string;
  try {
    const title =
      (await listAgentSessions()).find((x) => x.sessionId === id)?.title ?? "";
    if (title && title !== previous) finalName = title.trim().slice(0, 80) || raw;
    else if (title && title === raw) finalName = raw;
    else throw new Error("session/list no refleja el renombrado");
  } catch (e) {
    return Response.json(
      { error: `CLI did not confirm rename: ${errMsg(e)}` },
      { status: 502 }
    );
  }
  // el CLI ya confirmó el nuevo título → es la verdad, sin caché local
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
      { error: "No puedes borrar una sesión con un turno en curso." },
      { status: 429 }
    );

  // ¿existe como sesión del CLI (con turnos)?
  let inCli = false;
  try {
    inCli = (await listAgentSessions()).some((r) => r.sessionId === id);
  } catch {
    inCli = false;
  }

  if (inCli) {
    // borrar requiere cerrar primero el driver en vuelo de NUESTRA conexión
    // (verificado: con el driver abierto, un prompt a la sesión borrada
    // seguiría vivo)
    await closeAgentSession(id).catch(() => {});
    const r = await adminPrompt(`/session delete ${id} --yes`).catch((e) => ({
      error: { message: errMsg(e) },
    }));
    if (r.error)
      return Response.json(
        { error: `El CLI no pudo ejecutar el borrado: ${r.error.message}` },
        { status: 502 }
      );
    // verificación oficial: debe desaparecer del session/list del CLI
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
      // SIN tombstones: el CLI manda. La sesión sigue existiendo ahí y la
      // conciliación la mantiene; el fallo se informa al usuario.
      return Response.json(
        { error: "El CLI no pudo borrar la sesión (sigue en session/list)." },
        { status: 502 }
      );
    }
  }

  remove(id);
  resetSessionLog(id);
  return Response.json({ ok: true });
}