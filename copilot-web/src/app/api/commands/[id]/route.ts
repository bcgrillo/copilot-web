import { ensureCommands, listAvailableCommands } from "@/lib/acp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Cached snapshot of the session slash commands (fallback: latest global). */
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  let commands = listAvailableCommands(id);
  if (!commands.length) commands = await ensureCommands();
  return Response.json({ commands });
}