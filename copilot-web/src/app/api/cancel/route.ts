import { guardApi } from "@/lib/apiMode";
import { cancelSession } from "@/lib/acp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const g = guardApi(req);
  if (g) return g;
  const body = await req.json().catch(() => null);
  const sessionId: string | undefined = body?.sessionId;
  if (!sessionId)
    return Response.json({ error: "Missing sessionId" }, { status: 400 });
  await cancelSession(sessionId);
  return Response.json({ ok: true });
}