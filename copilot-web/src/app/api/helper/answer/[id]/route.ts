/** Respuesta del usuario web a una pregunta del MCP helper (card en el chat). */
import { answerAsk } from "@/lib/helperAsk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let body: { answer?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const text = typeof body.answer === "string" ? body.answer.trim() : "";
  if (!text) return Response.json({ error: "answer is required" }, { status: 400 });
  if (answerAsk(id, text)) return Response.json({ ok: true });
  return Response.json({ error: "Ask not found or already answered" }, { status: 410 });
}