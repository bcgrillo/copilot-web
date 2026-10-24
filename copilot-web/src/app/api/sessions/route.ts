import { create } from "@/lib/store";
import { reconcile } from "@/lib/copilotStore";
import { createAgentSession, CHAT_CWD } from "@/lib/acp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ sessions: await reconcile() });
}

export async function POST(req: Request) {
  let name: string | undefined;
  try {
    const body = await req.json();
    name = body?.name;
  } catch {
    /* no body */
  }
  // local session id = the ACP agent sessionId (native context)
  let agentId: string;
  try {
    agentId = await createAgentSession();
  } catch (e) {
    return Response.json(
      { error: `ACP agent: ${e instanceof Error ? e.message : e}` },
      { status: 502 }
    );
  }
  return Response.json({ session: create(name, agentId, CHAT_CWD) }, { status: 201 });
}