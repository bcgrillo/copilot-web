import { guardApi } from "@/lib/apiMode";
/** ask_user questions from the MCP helper. The helper (copilot-web/mcp/ask-user.mjs)
 * POSTs here and long-polls for the answer; the UI reads the pending asks
 * and answers. Everything in RAM — Principle 0. */
import { newAsk, pendingAsks, getAsk } from "@/lib/helperAsk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST (from the MCP helper): creates a question and returns {id}.
 * `poll=1` → additionally waits up to 5 min for the user answer (helper
 * long-poll). */
export async function POST(req: Request) {
  const g = guardApi(req);
  if (g) return g;
  let body: { question?: string; kind?: string; options?: string[]; poll?: boolean } | null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const q = typeof body?.question === "string" ? body.question.trim() : "";
  if (!q) return Response.json({ error: "question is required" }, { status: 400 });
  const kind = body?.kind === "choice" ? "choice" : "info";
  const options = Array.isArray(body?.options)
    ? body.options!.filter((o) => typeof o === "string").slice(0, 12)
    : [];
  const ask = newAsk(q, kind, options);

  if (!body!.poll) return Response.json({ id: ask.id });
  return Response.json(await waitForAnswer(ask.id));
}

/** GET: pending asks for the UI (client polling) or the state of a single
 * ask via ?id= (helper long-poll up to 5 min). */
export async function GET(req: Request) {
  const g = guardApi(req);
  if (g) return g;
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return Response.json({ asks: pendingAsks() });
  if (!url.searchParams.get("poll")) {
    const a = getAsk(id);
    if (!a) return Response.json({ error: "Ask not found" }, { status: 404 });
    return Response.json(a.pending ? { pending: true } : { answer: a.answer });
  }
  return Response.json(await waitForAnswer(id));
}

const TIMEOUT_MS = 300_000;
function waitForAnswer(id: string) {
  const t0 = Date.now();
  return new Promise<Record<string, unknown>>((resolve) => {
    const tick = () => {
      const a = getAsk(id);
      if (!a) return resolve({ answered: false, error: "unknown ask" });
      if (!a.pending) return resolve({ answered: true, answer: a.answer });
      if (Date.now() - t0 > TIMEOUT_MS)
        return resolve({ answered: false, error: "timeout" });
      setTimeout(tick, 500);
    };
    tick();
  });
}