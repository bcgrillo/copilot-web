#!/usr/bin/env node
/**
 * ask-user — MCP stdio helper para copilot-web (scaffold v0).
 *
 * Registro (sin tocar config global):
 *   copilot mcp add copilot-web-helper -- node /abs/path/copilot-web/mcp/ask-user.mjs
 * o por sesión, desde el launcher del daemon:
 *   --additional-mcp-config @/tmp/copilot-web-helper.json
 *
 * Protocolo: JSON-RPC delimitado por líneas (stdio). Tools:
 *   ask_user  — hace POST a la web con la pregunta y espera la respuesta
 *               del usuario (long-poll), devolviendo el texto como content.
 *
 * La web muestra la card de pregunta en la(s) sesión(es) con turno en
 * curso (v0); diseño y decisiones en docs/mcp-helper.md.
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
 * POSTea la pregunta a la web y hace long-poll de la respuesta.
 * (Los endpoints de la web llegan en la siguiente iteración; v0
 * falla honesto con un error claro para el agente.)
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