import { ensureCommands, listAvailableCommands } from "@/lib/acp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Snapshot cacheado de comandos slash de la sesión (fallback: último global). */
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  let commands = listAvailableCommands(id);
  if (!commands.length) commands = await ensureCommands();
  return Response.json({ commands });
}