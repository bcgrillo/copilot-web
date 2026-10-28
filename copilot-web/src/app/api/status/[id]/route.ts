import { guardApi } from "@/lib/apiMode";
/** Session working state for the status-bar: cwd (+ git branch on the fly
 * with standard git) and, if --model was passed to the launcher, the
 * declared model. The model is NOT read from ACP (1.0.80 does not expose it
 * on the official channel): it is only shown if the operator set it at
 * boot. */
import { execFile } from "node:child_process";
import { findSession } from "@/lib/copilotStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** hand-rolled native git (the PATH `git` is the CodePods shim → host API,
 * which cannot read container paths); read-only. */
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
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = guardApi(req);
  if (g) return g;
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
