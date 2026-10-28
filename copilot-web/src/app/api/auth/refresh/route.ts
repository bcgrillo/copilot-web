import { guardApi } from "@/lib/apiMode";
import { authEnabled, bearerToken, refreshAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/auth/refresh — Authorization: Bearer <refresh token>.
 * Rotates and returns a fresh {access, refresh} pair (refresh tokens are
 * single-use; reuse revokes the chain). Public from the guard's point of
 * view (it authenticates ITSELF with the refresh token). */
export async function POST(req: Request) {
  const g = guardApi(req);
  if (g) return g;
  if (!authEnabled()) return Response.json({ error: "auth-disabled" }, { status: 400 });
  const tok = bearerToken(req);
  if (!tok) return Response.json({ error: "unauthorized", reason: "missing-token" }, { status: 401 });
  const r = refreshAuth(tok);
  if (r.ok) return Response.json(r.pair);
  return Response.json(
    { error: "unauthorized", reason: r.reason },
    {
      status: 401,
      headers: {
        "www-authenticate": `Bearer realm="copilot-web", error="${r.reason}"`,
      },
    },
  );
}