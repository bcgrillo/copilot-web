import pkg from "../../package.json";

/** The complete OpenAPI 3.1 spec (exported separately so the route file only
 * exports handlers, which Next.js requires; no codegen deps). */

const err = (desc: string) => ({
  description: desc,
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/Error" },
    },
  },
});

const json = (schema: unknown, desc = "") => ({
  description: desc,
  ...(schema ? { content: { "application/json": { schema } } } : {}),
});

const sessionIdParam = {
  name: "id",
  in: "path",
  required: true,
  description: "Session id (equals the agent/CLI session id)",
  schema: { type: "string" },
};

const OPENAPI = {
  openapi: "3.1.0",
  info: {
    title: "Copilot Web API",
    version: pkg.version as string,
    description: [
      "HTTP API exposed by the copilot-web backend (Next.js route handlers).",
      "",
      "The backend owns the ACP bridge to the `copilot --acp` daemon (default :3222);",
      "the frontend never talks ACP — it consumes this API only, so a separate",
      "frontend (or a fork of the UI) can point at this base with `NEXT_PUBLIC_API_URL`.",
      "",
      "Deployment modes (`APP_MODE`, runtime, no rebuild needed):",
      "• `all` (default) — UI + API on one server",
      "• `api` — backend only, UI answers 404 {\"error\":\"ui-disabled\"}",
      "• `front` — does not serve this API (404 {\"error\":\"api-disabled\"})",
      "",
      "Cross-origin frontends: set `CORS_ALLOW_ORIGIN` on the backend (exact origin,",
      "comma list, or `*`). Unset = same-origin only (e.g. behind a reverse proxy).",
      "",
      "Authentication (default ON since v0.1.4): every endpoint except /api/login,",
      "/api/auth/state, /api/auth/refresh and /api/openapi requires",
      "`Authorization: Bearer <access>` (15-min TTL; internal MCP helper tokens",
      "accepted). Login returns a short-lived access token plus a single-use",
      "refresh token (90 d) rotated on every refresh; refresh-token reuse revokes",
      "the rotated chain. Disable with `--no-auth`. Users are managed with the",
      "`--add-user/--set-password/--del-user/--revoke/--list-users` CLI flags.",
      "With auth ON, guarded endpoints answer 401 {\"error\":\"unauthorized\", \"reason\":\"…\"} ",
      "with reasons: missing-token (no/parsable header), invalid-token (signature), ",
      "wrong-token-type (a refresh used as bearer), expired, revoked or no-auth-file. ",
      "With `--no-auth` the guard is skipped entirely (no header needed) and ",
      "/api/login answers 400 auth-disabled.",
    ].join("\n"),
    license: { name: "MIT" },
  },
  servers: [{ url: "/", description: "same origin, or the absolute base URL of the backend" }],
  tags: [
    { name: "sessions" },
    { name: "chat" },
    { name: "permissions" },
    { name: "daemon" },
    { name: "helper" },
    { name: "auth" },
  ],
  security: [{ bearerAuth: [] }],
  paths: {
    "/api/login": {
      post: {
        tags: ["auth"],
        summary: "Exchange user + password for a bearer token pair.",
        description: "Public endpoint. `access` lives 15 min; `refresh` 90 days and is single-use (rotated on every /api/auth/refresh; reuse revokes the chain). The `refresh` token is NOT valid as a bearer token for regular endpoints.",
        security: [],
        requestBody: json({
          type: "object",
          required: ["user", "password"],
          properties: { user: { type: "string" }, password: { type: "string" } },
        }),
        responses: {
          200: json({
            type: "object",
            required: ["access", "refresh"],
            properties: { access: { type: "string" }, refresh: { type: "string" } },
          }),
          400: err("Missing user/password, or auth disabled (--no-auth)"),
          401: err("invalid-credentials"),
        },
      },
    },
    "/api/auth/refresh": {
      post: {
        tags: ["auth"],
        summary: "Rotate a single-use refresh token into a fresh pair.",
        description: "Public endpoint (it authenticates itself with the refresh token). Send `Authorization: Bearer <refresh>`; the old refresh becomes invalid.",
        security: [],
        parameters: [
          {
            name: "authorization",
            in: "header",
            required: true,
            description: "Bearer <refresh token>",
            schema: { type: "string" },
          },
        ],
        responses: {
          200: json({
            type: "object",
            required: ["access", "refresh"],
            properties: { access: { type: "string" }, refresh: { type: "string" } },
          }),
          401: err("unauthorized (expired / reused → chain revoked / missing token)"),
          400: err("auth disabled"),
        },
      },
    },
    "/api/auth/state": {
      get: {
        tags: ["auth"],
        summary: "Whether authentication is enabled ({auth:true|false}).",
        description: "Public; used by the frontend to decide between the login screen and the UI.",
        security: [],
        responses: {
          200: json({
            type: "object",
            required: ["auth"],
            properties: { auth: { type: "boolean" } },
          }),
        },
      },
    },
    "/api/sessions": {
      get: {
        tags: ["sessions"],
        summary: "List sessions (reconciled with the agent).",
        responses: {
          200: json(
            {
              type: "object",
              required: ["sessions"],
              properties: {
                sessions: { type: "array", items: { $ref: "#/components/schemas/SessionSummary" } },
              },
            },
            "Metadata only (no messages)."
          ),
        },
      },
      post: {
        tags: ["sessions"],
        summary: "Create a session (agent-side too).",
        requestBody: json(
          {
            type: "object",
            properties: { name: { type: "string", description: "Optional display name" } },
          },
          "Optional"
        ),
        responses: {
          201: json(
            {
              type: "object",
              required: ["session"],
              properties: { session: { $ref: "#/components/schemas/SessionSummary" } },
            },
            "Created"
          ),
          502: err("The agent/ACP backend could not create the session"),
        },
      },
    },
    "/api/sessions/{id}": {
      parameters: [sessionIdParam],
      get: {
        tags: ["sessions"],
        summary: "Get one session with full history.",
        description:
          "History is materialized over the ACP channel (session/load or in-RAM log); " +
          "the pending permission (if any) and whether a turn is running are included.",
        responses: {
          200: json({
            type: "object",
            required: ["session"],
            properties: {
              session: { $ref: "#/components/schemas/SessionDetail" },
              note: { type: "string", description: "Non-fatal warning (e.g. materialize failed)" },
            },
          }),
          404: err("Session not found"),
        },
      },
      patch: {
        tags: ["sessions"],
        summary: "Rename a session.",
        requestBody: json({
          type: "object",
          required: ["name"],
          properties: { name: { type: "string", minLength: 1, maxLength: 80 } },
        }),
        responses: {
          200: json({
            type: "object",
            required: ["session"],
            properties: { session: { $ref: "#/components/schemas/SessionSummary" } },
          }),
          400: err("Missing name"),
          404: err("Session not found"),
          429: err("A turn is running in the session"),
          502: err("The agent could not apply the rename"),
        },
      },
      delete: {
        tags: ["sessions"],
        summary: "Delete a session (agent-side too).",
        responses: {
          200: json(
            { type: "object", required: ["ok"], properties: { ok: { const: true } } },
            "Deleted"
          ),
          404: err("Session not found"),
          429: err("You cannot delete a session with a turn in progress"),
          502: err("The agent could not delete the session"),
        },
      },
    },
    "/api/chat": {
      post: {
        tags: ["chat"],
        summary: "Send a message; server-sent events stream (text/event-stream).",
        description:
          "Sends one user message to the agent and streams the turn back as SSE frames " +
          "`data: {\"type\":…,\"data\":…}\\n\\n`. Event order in a turn: " +
          "`reasoning_delta`/`reasoning_done`, `tool` (tool_call/tool_call_update), " +
          "`message_start`, `delta`…, final `message`, then `done`. " +
          "A `permission` event pauses the turn until POST /api/permission resolves it. " +
          "Closing the connection does NOT cancel the turn (it keeps running and " +
          "rehydrates); use POST /api/cancel to stop it.",
        requestBody: json(
          {
            type: "object",
            required: ["sessionId", "message"],
            properties: {
              sessionId: { type: "string" },
              message: { type: "string", minLength: 1 },
              attachments: {
                type: "array",
                maxItems: 10,
                items: { $ref: "#/components/schemas/Attachment" },
                description: "Base64 files written next to the session cwd and passed as file:// resource links",
              },
            },
          },
          "The user message"
        ),
        responses: {
          200: {
            description:
              "SSE stream. Frames: data: {type, data}. Event types in `x-sse-events`.",
            content: {
              "text/event-stream": {
                schema: { type: "string" },
              },
            },
            "x-sse-events": [
              { name: "message_start", data: { type: "object", properties: { id: { type: "string" } } } },
              { name: "delta", data: { type: "object", properties: { id: { type: "string" }, content: { type: "string" } } } },
              { name: "reasoning_delta", data: { type: "object", properties: { content: { type: "string" } } } },
              { name: "reasoning_done", data: { type: "object", properties: { index: { type: "integer" } } } },
              {
                name: "tool",
                data: {
                  type: "object",
                  required: ["kind"],
                  properties: {
                    kind: { enum: ["tool_call", "tool_call_update"] },
                    toolCallId: { type: "string" },
                    title: { type: "string" },
                    status: { type: "string", description: "pending | completed | in_progress | error" },
                    detail: { type: "string", description: "Tool output/summary" },
                  },
                },
              },
              {
                name: "commands",
                data: {
                  type: "object",
                  properties: {
                    availableCommands: { type: "array", items: { $ref: "#/components/schemas/AvailableCommand" } },
                  },
                },
              },
              { name: "permission", data: { $ref: "#/components/schemas/PermissionReq" } },
              {
                name: "permission_resolved",
                data: {
                  type: "object",
                  properties: { reqId: { type: "integer" }, choice: {}, auto: { type: "boolean" }, toolCallId: { type: "string" } },
                },
              },
              {
                name: "message",
                description: "Final message of the turn (same shape as history messages)",
                data: { $ref: "#/components/schemas/ChatMessage" },
              },
              { name: "error", data: { type: "object", properties: { message: { type: "string" } } } },
              { name: "done", data: { type: "object", description: "Turn finished" } },
            ],
          },
          400: err("Empty message or invalid attachment (max 5 MB per file / 10 files)"),
          404: err("Session not found"),
          429: err("Session is already processing another message (body includes busy:true and the pending permission, if any)"),
        },
      },
    },
    "/api/cancel": {
      post: {
        tags: ["chat"],
        summary: "Cancel the running turn of a session.",
        requestBody: json({
          type: "object",
          required: ["sessionId"],
          properties: { sessionId: { type: "string" } },
        }),
        responses: {
          200: json({ type: "object", properties: { ok: { const: true } } }),
          400: err("Missing sessionId"),
        },
      },
    },
    "/api/permission": {
      post: {
        tags: ["permissions"],
        summary: "Resolve a permission request (allow/deny or an agent-provided option).",
        requestBody: json({
          type: "object",
          required: ["reqId"],
          properties: {
            reqId: { type: "integer", description: "From the `permission` SSE event" },
            allow: { type: "boolean" },
            optionId: { type: "string", description: "e.g. allow_always / reject_always — wins over `allow`" },
          },
        }),
        responses: {
          200: json({ type: "object", properties: { ok: { const: true } } }),
          400: err("Invalid reqId / missing allow / invalid optionId"),
          404: err("Request not found (already resolved or expired)"),
        },
      },
    },
    "/api/daemon": {
      get: {
        tags: ["daemon"],
        summary: "ACP daemon status (probed on TCP + /proc scan).",
        responses: {
          200: json({
            type: "object",
            required: ["alive", "port"],
            properties: {
              alive: { type: "boolean" },
              port: { type: "integer" },
              pid: { type: "integer" },
              model: { type: "string" },
            },
          }),
        },
      },
      post: {
        tags: ["daemon"],
        summary: "Restart the ACP daemon (respawns it with its original argv/env).",
        requestBody: json({
          type: "object",
          required: ["action"],
          properties: { action: { const: "restart" } },
        }),
        responses: {
          200: json({ type: "object", properties: { ok: { const: true }, pid: { type: "integer" } } }),
          400: err("Unsupported action"),
          409: err("Daemon not found or not responding"),
          500: err("Spawn failed"),
          502: err("Daemon did not come back"),
        },
      },
    },
    "/api/commands/{id}": {
      parameters: [sessionIdParam],
      get: {
        tags: ["chat"],
        summary: "Slash commands available in the session.",
        responses: {
          200: json({
            type: "object",
            required: ["commands"],
            properties: {
              commands: { type: "array", items: { $ref: "#/components/schemas/AvailableCommand" } },
            },
          }),
        },
      },
    },
    "/api/status/{id}": {
      parameters: [sessionIdParam],
      get: {
        tags: ["sessions"],
        summary: "Session working state (cwd, git branch, model).",
        responses: {
          200: json({
            type: "object",
            required: ["cwd"],
            properties: {
              cwd: { type: "string" },
              branch: { type: "string", nullable: true },
              model: { type: "string", nullable: true },
            },
          }),
          404: err("Session not found"),
        },
      },
    },
    "/api/helper/ask": {
      get: {
        tags: ["helper"],
        summary: "Pending ask_user questions (or one ask via ?id=).",
        description:
          "Without `id`: all pending asks (UI polling). With `id`: its state; " +
          "add `&poll=1` to long-poll up to 5 min for the answer.",
        parameters: [
          { name: "id", in: "query", schema: { type: "string" } },
          { name: "poll", in: "query", schema: { type: "string", enum: ["1"] } },
        ],
        responses: {
          200: json({
            oneOf: [
              { type: "object", required: ["asks"], properties: { asks: { type: "array", items: { $ref: "#/components/schemas/Ask" } } } },
              { type: "object", properties: { pending: { const: true } } },
              { type: "object", properties: { answered: { const: true }, answer: { type: "string" } } },
              { type: "object", properties: { answered: { const: false }, error: { type: "string" } } },
            ],
          }),
        },
      },
      post: {
        tags: ["helper"],
        summary: "Create an ask_user question (normally called by the MCP helper, inside a tool round).",
        description:
          "Body: {question, kind: \"info\"|\"choice\", options?: string[], poll?: true}.\n" +
          "With `poll:true` it long-polls (≤5 min) and returns the user's answer instead of `{id}`.",
        requestBody: json({
          type: "object",
          required: ["question"],
          properties: {
            question: { type: "string", minLength: 1 },
            kind: { enum: ["info", "choice"] },
            options: { type: "array", items: { type: "string" }, maxItems: 12 },
            poll: { type: "boolean" },
          },
        }),
        responses: {
          200: json({
            oneOf: [
              { type: "object", required: ["id"], properties: { id: { type: "string" } } },
              { type: "object", properties: { answered: { type: "boolean" }, answer: { type: "string" }, error: { type: "string" } } },
            ],
          }),
          400: err("question is required"),
        },
      },
    },
    "/api/helper/answer/{id}": {
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      post: {
        tags: ["helper"],
        summary: "Answer an ask_user question from the web card.",
        requestBody: json({
          type: "object",
          required: ["answer"],
          properties: { answer: { type: "string", minLength: 1 } },
        }),
        responses: {
          200: json({ type: "object", properties: { ok: { const: true } } }),
          400: err("answer is required"),
          410: err("Ask not found or already answered"),
        },
      },
    },
    "/api/openapi": {
      get: {
        tags: ["daemon"],
        summary: "This document (OpenAPI 3.1).",
        description: "Public: the only always-exempt endpoint besides /api/login, /api/auth/state and /api/auth/refresh.",
        security: [],
        responses: {
          200: {
            description: "The spec itself",
            content: { "application/json": { schema: { type: "object" } } },
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "opaque-token",
        description:
          "Access token from POST /api/login (HMAC-signed opaque token, 15 min TTL). The MCP helper uses a permanent internal token issued by the installer.",
      },
    },
    schemas: {
      Error: {
        type: "object",
        required: ["error"],
        properties: { error: { type: "string" } },
      },
      Attachment: {
        type: "object",
        required: ["name", "content"],
        properties: {
          name: { type: "string", description: "File name (basename is sanitized)" },
          content: { type: "string", description: "Base64-encoded content", contentEncoding: "base64" },
        },
      },
      AvailableCommand: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          input: { type: "object", properties: { hint: { type: "string" } }, nullable: true },
        },
      },
      SessionSummary: {
        type: "object",
        required: ["id", "name", "createdAt"],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          createdAt: { type: "string" },
          cwd: { type: "string" },
          updatedAt: { type: "string" },
        },
      },
      SessionDetail: {
        allOf: [
          { $ref: "#/components/schemas/SessionSummary" },
          {
            type: "object",
            required: ["running"],
            properties: {
              messages: { type: "array", items: { $ref: "#/components/schemas/ChatMessage" } },
              pending: { $ref: "#/components/schemas/PermissionReq" },
              running: { type: "boolean", description: "A turn is currently running for this session" },
            },
          },
        ],
      },
      ChatMessage: {
        type: "object",
        required: ["id", "role", "content"],
        properties: {
          id: { type: "string" },
          role: { enum: ["user", "assistant"] },
          content: { type: "string" },
          reasoning: { type: "string" },
          parts: { type: "array", items: { $ref: "#/components/schemas/MessagePart" } },
          tools: { type: "array", items: { $ref: "#/components/schemas/ToolStep" } },
          ts: { type: "string", description: "Only for live updates (server RAM cache)" },
        },
      },
      MessagePart: {
        oneOf: [
          {
            type: "object",
            required: ["kind", "content"],
            properties: { kind: { const: "text" }, content: { type: "string" } },
          },
          {
            type: "object",
            required: ["kind", "content"],
            properties: { kind: { const: "reasoning" }, content: { type: "string" }, done: { type: "boolean" } },
          },
          { $ref: "#/components/schemas/ToolStep", title: "tool part" },
          {
            type: "object",
            required: ["kind", "content"],
            properties: { kind: { const: "system" }, content: { type: "string" } },
          },
        ],
      },
      ToolStep: {
        type: "object",
        required: ["title", "status"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          status: { type: "string", description: "pending | completed | in_progress | error" },
          detail: { type: "string" },
        },
      },
      PermissionOption: {
        type: "object",
        required: ["optionId", "kind"],
        properties: {
          optionId: { type: "string" },
          kind: { type: "string" },
          name: { type: "string" },
        },
      },
      PermissionReq: {
        type: "object",
        required: ["reqId", "title"],
        properties: {
          reqId: { type: "integer" },
          title: { type: "string" },
          toolCallId: { type: "string" },
          options: { type: "array", items: { $ref: "#/components/schemas/PermissionOption" } },
        },
      },
      Ask: {
        type: "object",
        required: ["id", "question", "kind"],
        properties: {
          id: { type: "string" },
          question: { type: "string" },
          kind: { enum: ["info", "choice"] },
          options: { type: "array", items: { type: "string" } },
          createdAt: { type: "integer", description: "Unix ms" },
        },
      },
    },
  },
} as const;

export { OPENAPI };
