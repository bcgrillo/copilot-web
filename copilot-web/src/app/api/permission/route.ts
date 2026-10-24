import { respondPermission } from "@/lib/acp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Permite/deniega una solicitud de permiso pendiente (card del chat).
 * Cuerpo: {reqId, allow?: boolean} o {reqId, optionId} (permiso con opciones
 * tipo allow_always / reject_always). */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const reqId = Number(body?.reqId);
  if (!Number.isInteger(reqId))
    return Response.json({ error: "reqId inválido" }, { status: 400 });
  let decision: boolean | string;
  if (typeof body?.optionId === "string") decision = body.optionId;
  else if (typeof body?.allow === "boolean") decision = body.allow;
  else return Response.json({ error: "falta allow u optionId" }, { status: 400 });
  const r = respondPermission(reqId, decision);
  if (!r.ok) {
    const msg =
      r.reason === "invalid-option"
        ? "optionId no está entre las opciones que ofreció el agente"
        : "Solicitud no encontrada (¿ya resuelta o caducada?)";
    const status = r.reason === "invalid-option" ? 400 : 404;
    return Response.json({ error: msg }, { status });
  }
  return Response.json({ ok: true });
}