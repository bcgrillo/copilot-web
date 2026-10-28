import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Edge middleware: CORS for /api/* + build-time APP_MODE gating.
// NOTE: on the Edge runtime process.env is baked at build time — set
// APP_MODE / CORS_ALLOW_ORIGIN when building each image (api/front forks).
// Route-level runtime gating lives in src/lib/apiMode.ts (guardApi).
//
// CORS_ALLOW_ORIGIN: "*" or comma-separated exact origins. Unset ⇒ behaves
// exactly as before (no CORS headers).

const MODE = (process.env.APP_MODE ?? "all").trim().toLowerCase();
const CORS = (process.env.CORS_ALLOW_ORIGIN ?? "").trim();

function corsHeaders(origin: string | null): Headers {
  const h = new Headers();
  if (!CORS) return h;
  const list = CORS.split(",").map((s) => s.trim()).filter(Boolean);
  if (list.includes("*")) {
    h.set("Access-Control-Allow-Origin", "*");
  } else if (origin && list.includes(origin)) {
    h.set("Access-Control-Allow-Origin", origin);
    h.set("Vary", "Origin");
    h.set("Access-Control-Allow-Credentials", "true");
  } else {
    return h;
  }
  h.set("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  h.set("Access-Control-Allow-Headers", "content-type,authorization");
  return h;
}

function json404(h: Headers, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status: 404,
    headers: { "content-type": "application/json", ...Object.fromEntries(h) },
  });
}

export default function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const origin = req.headers.get("origin");
  const h = corsHeaders(origin);
  const isApi = pathname === "/api" || pathname.startsWith("/api/");

  if (isApi) {
    if (MODE === "front") return json404(h, "api-disabled");
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
    if (!h.get("Access-Control-Allow-Origin")) return NextResponse.next();
    return NextResponse.next({ headers: h });
  }

  if (MODE === "api") return json404(h, "ui-disabled");
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};