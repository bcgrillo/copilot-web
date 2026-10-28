import { guardApi } from "@/lib/apiMode";
import { OPENAPI } from "@/lib/openapiSpec";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Serves the OpenAPI 3.1 spec (see src/lib/openapiSpec.ts) — gated like
 * every other /api route so APP_MODE is respected. */

export async function GET(req: Request) {
  const g = guardApi(req);
  if (g) return g;
  return Response.json(OPENAPI);
}
