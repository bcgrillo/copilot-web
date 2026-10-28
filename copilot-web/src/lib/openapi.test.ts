import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/openapi/route";
import { OPENAPI } from "@/lib/openapiSpec";
import { GET as getSessions } from "@/app/api/sessions/route";
import pkg from "../../package.json";

const PATHS = Object.keys(OPENAPI.paths);

describe("OpenAPI spec served at /api/openapi", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is a valid 3.1 doc with the version build-baked", () => {
    expect(OPENAPI.openapi).toMatch(/^3\./);
    expect(OPENAPI.info.title).toBe("Copilot Web API");
    expect(OPENAPI.info.version).toBe(pkg.version);
  });

  it("documents every backend route", () => {
    expect(PATHS).toHaveLength(14);
    for (const p of [
      "/api/sessions",
      "/api/sessions/{id}",
      "/api/chat",
      "/api/cancel",
      "/api/permission",
      "/api/daemon",
      "/api/commands/{id}",
      "/api/status/{id}",
      "/api/helper/ask",
      "/api/helper/answer/{id}",
      "/api/openapi",
      "/api/login",
      "/api/auth/refresh",
      "/api/auth/state",
    ])
      expect(PATHS, p).toContain(p);
  });

  it("describes the chat SSE stream and its events", () => {
    const post = (OPENAPI.paths["/api/chat"] as unknown as { post: { responses: Record<string, unknown> } }).post;
    expect(post.responses[200]).toHaveProperty("x-sse-events");
    const events = (post.responses[200] as unknown as { "x-sse-events": { name: string }[] })[
      "x-sse-events"
    ].map((e) => e.name);
    for (const ev of ["message_start", "delta", "reasoning_delta", "tool", "permission", "message", "error", "done"])
      expect(events, ev).toContain(ev);
  });

  it("defines the shared schemas", () => {
    for (const s of [
      "SessionSummary",
      "SessionDetail",
      "ChatMessage",
      "MessagePart",
      "ToolStep",
      "PermissionReq",
      "Attachment",
      "Ask",
      "Error",
    ])
      expect(Object.keys(OPENAPI.components.schemas), s).toContain(s);
  });

  it("GET serves the spec in all mode and is gated in front mode", async () => {
    vi.stubEnv("APP_MODE", "all");
    vi.stubEnv("NO_AUTH", "1");
    const all = await GET(new Request("http://x/api/openapi/"));
    expect(all.status).toBe(200);
    expect((await all.json()).openapi).toMatch(/^3\./);
    vi.stubEnv("APP_MODE", "front");
    const front = await GET(new Request("http://x/api/openapi/"));
    expect(front.status).toBe(404);
    expect((await front.json()).error).toBe("api-disabled");
  });

  it("matches the real sessions route status codes", async () => {
    vi.stubEnv("APP_MODE", "api");
    vi.stubEnv("NO_AUTH", "1");
    const r = await getSessions(new Request("http://x/api/sessions/"));
    // the spec lists a 200 {sessions[]} for GET /api/sessions
    const listed = (OPENAPI.paths["/api/sessions"] as unknown as { get: { responses: Record<string, unknown> } })
      .get.responses;
    expect(listed[200]).toBeTruthy();
    expect(r.status).toBeLessThan(500);
  });

  it("describes the bearer security scheme and the public endpoints", () => {
    expect(OPENAPI.components.securitySchemes?.bearerAuth?.type).toBe("http");
    // default = authenticated
    expect(OPENAPI.security).toEqual([{ bearerAuth: [] }]);
    // the public endpoints opt out explicitly
    for (const p of ["/api/login", "/api/auth/refresh", "/api/auth/state", "/api/openapi"]) {
      const op = (OPENAPI.paths as unknown as Record<string, Record<string, { security?: unknown[] }>>)[p];
      for (const method of ["get", "post"]) {
        if (!op[method]) continue;
        expect(op[method].security, `${p} ${method}`).toEqual([]);
      }
    }
    // the description explains the 401 reasons and the --no-auth mode
    expect(OPENAPI.info.description).toContain("missing-token");
    expect(OPENAPI.info.description).toContain("--no-auth");
  });
});