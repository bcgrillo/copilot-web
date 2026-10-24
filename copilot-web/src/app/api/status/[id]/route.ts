/** Estado de trabajo de una sesión para el status-bar: cwd (+ git branch al
 * vuelo con git estándar) y, si se pasó --model al launcher, el modelo
 * declarado. El modelo NO se lee de ACP (1.0.80 no lo expone por canal
 * oficial): solo se muestra si el operador lo configuró al arrancar. */
import { execFile } from "node:child_process";
import { findSession } from "@/lib/copilotStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** git nativo a mano (el `git` del PATH es el shim de CodePods → host API, que
 * no puede leer rutas del contenedor); lectura solamente. */
const GIT_BIN = process.env.GIT_BIN || "/usr/bin/git";
const git = (cwd: string, ...args: string[]) =>
  new Promise<string | null>((resolve) =>
    execFile(
      GIT_BIN,
      ["-C", cwd, ...args],
      { timeout: 3000 },
      (e, out) => resolve(e ? null : String(out).trim())
    )
  );

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const s = await findSession(id);
  if (!s) return Response.json({ error: "Session not found" }, { status: 404 });
  const cwd = s.cwd || process.env.CHAT_CWD || process.cwd();
  const inside = await git(cwd, "rev-parse", "--is-inside-work-tree");
  let branch: string | null = null;
  if (inside === "true") {
    branch = await git(cwd, "branch", "--show-current");
    if (!branch) branch = await git(cwd, "rev-parse", "--short", "HEAD");
  }
  return Response.json({
    cwd,
    branch,
    model: process.env.COPILOT_MODEL || null,
  });
}
