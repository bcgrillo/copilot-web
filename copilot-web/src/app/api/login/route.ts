import { guardApi } from "@/lib/apiMode";
import { authEnabled, login } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/login {user,password} → {access, refresh} (Bearer pair).
 * Public endpoint (exempt from the bearer guard). */
export async function POST(req: Request) {
  const g = guardApi(req);
  if (g) return g;
  if (!authEnabled()) return Response.json({ error: "auth-disabled" }, { status: 400 });
  let body: { user?: string; password?: string } | null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const user = typeof body?.user === "string" ? body.user.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!user || !password)
    return Response.json({ error: "user and password are required" }, { status: 400 });
  const pair = login(user, password);
  if (!pair) return Response.json({ error: "invalid-credentials" }, { status: 401 });
  return Response.json(pair);
}