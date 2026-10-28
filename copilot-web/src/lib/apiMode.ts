// APP_MODE deployment gates (all | api | front), evaluated at RUNTIME so
// the mode can be changed without rebuilding (route handlers run on the
// Node.js runtime, where process.env is live):
// - all  (default): UI + API in one server (self-host monolith)
// - api:  backend container. API routes work; the UI is expected to be
//         blocked by middleware (build-time APP_MODE). Route guards keep
//         working if only the env changes.
// - front: pure frontend. /api/* returns 404 from both middleware and the
//          per-route guards below.
//
// CORS lives in src/middleware.ts. It runs on the Edge runtime, where
// process.env is baked at build time, so CORS_ALLOW_ORIGIN / APP_MODE are
// read there per-build; CORS_ALLOW_ORIGIN can stay unset (no headers are
// added, same-origin behavior unchanged — e.g. the CodePods proxy case).

export type AppMode = "all" | "api" | "front";

export function getAppMode(): AppMode {
  const m = (process.env.APP_MODE ?? "all").trim().toLowerCase();
  return m === "api" || m === "front" ? m : "all";
}

// Comma-separated origins or "*"; unset ⇒ no CORS headers.
export function corsHeadersRuntime(origin: string | null): Headers {
  const h = new Headers();
  const allow = (process.env.CORS_ALLOW_ORIGIN ?? "").trim();
  if (!allow) return h;
  const list = allow.split(",").map((s) => s.trim()).filter(Boolean);
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

// First line of every API route handler: blocks the route when the server
// runs as a pure frontend (404), then enforces bearer authentication for
// every /api path except the public ones (openapi, login, auth/state,
// auth/refresh) — see src/lib/auth.ts. FAIL-SAFE: guardApi() without a
// Request object returns 401 while auth is enabled (the routes below all
// pass their request).
import { guardAuth } from "@/lib/auth";

export function guardApi(req?: Request): Response | null {
  if (getAppMode() === "front") {
    const h = corsHeadersRuntime(req?.headers.get("origin") ?? null);
    return new Response(JSON.stringify({ error: "api-disabled" }), {
      status: 404,
      headers: { "content-type": "application/json", ...Object.fromEntries(h) },
    });
  }
  const g = guardAuth(req);
  if (g) {
    // 401s carry runtime CORS headers too (cross-origin forks)
    const h = corsHeadersRuntime(req?.headers.get("origin") ?? null);
    for (const [k, v] of h) g.headers.set(k, v);
    return g;
  }
  return null;
}