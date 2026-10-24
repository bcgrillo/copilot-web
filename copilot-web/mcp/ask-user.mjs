#!/usr/bin/env node
/**
 * ask-user — MCP stdio helper for copilot-web (v0 scaffold).
 *
 * Registration (without touching global config):
 *   copilot mcp add copilot-web-helper -- node /abs/path/copilot-web/mcp/ask-user.mjs
 * or per daemon, from the daemon launcher:
 *   --additional-mcp-config @/tmp/copilot-web-helper.json
 *
 * Protocol: line-delimited JSON-RPC (stdio). Tools:
 *   ask_user  — POSTs the question to the web and waits for the user's
 *               answer (long-poll), returning the text as content.
 *
 * The web shows the question card on the session(s) with a turn in
 * progress (v0); design and decisions in docs/mcp-helper.md.
 */
import { createInterface as createReadline } from "node:readline";
import process from "node:process";

const WEB_URL = process.env.COPILOT_WEB_URL || "http://localhost:3100";
const VERSION = "0.1.0";

const rl = createReadline({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  line = line.trim();
  if (!line) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  handle(msg);
});

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function answer(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function answerErr(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === "initialize" && id != null) {
    answer(id, {
      protocolVersion: params?.protocolVersion ?? "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "copilot-web-helper", version: VERSION },
    });
    return;
  }
  if (method === "notifications/initialized" || method === "initialized") {
    return;
  }
  if (method === "tools/list") {
    answer(id, {
      tools: [
        {
          name: "ask_user",
          description:
            "Ask the web user a question and wait for their typed answer. Use this when you need a decision or extra information; never use it for trivial confirmations.",
          inputSchema: {
            type: "object",
            properties: {
              question: {
                type: "string",
                minLength: 1,
                description: "Question to show in the chat UI",
              },
              kind: {
                type: "string",
                enum: ["info", "choice"],
                description: "Plain question, or multiple options",
              },
              options: {
                type: "array",
                items: { type: "string" },
                description: "When kind=choice, the allowed answers",
              },
            },
            required: ["question"],
          },
        },
      ],
    });
    return;
  }
  if (method === "tools/call" && params?.name === "ask_user") {
    const args = params.arguments ?? {};
    if (!args.question || typeof args.question !== "string") {
      answerErr(id, -32602, "params invalid: 'question' is required");
      return;
    }
    try {
      const answerText = await askUser(args);
      answer(id, {
        content: [{ type: "text", text: answerText }],
        isError: false,
      });
    } catch (e) {
      answer(id, {
        content: [
          { type: "text", text: `ask_user failed: ${String(e.message ?? e)}` },
        ],
        isError: true,
      });
    }
    return;
  }
  if (id != null && method?.startsWith("tools/")) {
    answerErr(id, -32601, `unknown method: ${method}`);
  }
}

/**
 * POSTs the question to the web and long-polls for the answer.
 * (The web endpoints land in the next iteration; v0 fails honestly
 * with a clear error for the agent.)
 */
async function askUser(args) {
  const res = await fetch(`${WEB_URL}/api/helper/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question: args.question,
      kind: args.kind ?? "info",
      options: args.options ?? [],
      poll: true, // la web long-pollea hasta 5 min y devuelve {answered, answer}
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`web /api/helper/ask → ${res.status} ${body}`);
  }
  const data = await res.json();
  if (data.answered && typeof data.answer === "string") return data.answer;
  throw new Error(data.error ?? "no user response");
}