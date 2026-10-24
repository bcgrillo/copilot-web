import { respondPermission } from "@/lib/acp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Allows/denies a pending permission request (chat card).
 * Body: {reqId, allow?: boolean} or {reqId, optionId} (a permission with
 * options like allow_always / reject_always). */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const reqId = Number(body?.reqId);
  if (!Number.isInteger(reqId))
    return Response.json({ error: "Invalid reqId" }, { status: 400 });
  let decision: boolean | string;
  if (typeof body?.optionId === "string") decision = body.optionId;
  else if (typeof body?.allow === "boolean") decision = body.allow;
  else return Response.json({ error: "missing allow or optionId" }, { status: 400 });
  const r = respondPermission(reqId, decision);
  if (!r.ok) {
    const msg =
      r.reason === "invalid-option"
        ? "optionId is not among the options offered by the agent"
        : "Request not found (already resolved or expired?)";
    const status = r.reason === "invalid-option" ? 400 : 404;
    return Response.json({ error: msg }, { status });
  }
  return Response.json({ ok: true });
}