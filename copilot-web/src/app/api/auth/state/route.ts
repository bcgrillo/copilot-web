import { guardApi } from "@/lib/apiMode";
import { authEnabled } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/auth/state → {auth: boolean} — the UI checks whether the
 * login screen must be shown. Public (exempt from the bearer guard). */
export async function GET(req: Request) {
  const g = guardApi(req);
  if (g) return g;
  return Response.json({ auth: authEnabled() });
}