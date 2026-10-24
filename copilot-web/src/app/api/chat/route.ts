import crypto from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { touch } from "@/lib/store";
import { findSession } from "@/lib/copilotStore";
import {
  prompt,
  subscribeUpdates,
  isLoading,
  cancelSession,
  pendingPermissionFor,
  DAEMON_INFO_RE,
  runningTurns as running,
  type AcpUpdate,
} from "@/lib/acp";
import {
  cleanToolOutput,
  textContentOf,
  textOfParts,
  toolInputDetail,
} from "@/lib/content";
import { MAX_FILES, MAX_FILE_BYTES, FIRST_UPDATE_TIMEOUT_MS } from "@/lib/limits";
import type { Attachment, AvailableCommand, MessagePart, ToolStep } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

type SSEEvent = { type: string; data: Record<string, unknown> };

const IMG_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
};

// ACP prompt blocks: the user's text plus each attachment as a resource_link
// with a real file:// URI. The agent reads the files with its own tool while
// processing (verified E2E: "Viewing <file>").
async function buildPromptBlocks(
  message: string,
  attachments: Attachment[],
  attDir: string
): Promise<unknown[]> {
  const blocks: unknown[] = [{ type: "text", text: message }];
  for (const [i, att] of attachments.slice(0, MAX_FILES).entries()) {
    const buf = Buffer.from(att.content || "", "base64");
    if (buf.length === 0) continue;
    if (buf.length > MAX_FILE_BYTES) {
      throw new Error(`"${att.name}" exceeds 5 MB (upload limit)`);
    }
    const safe =
      path
        .basename(att.name || "")
        .replace(/[^\w.\- ()]+/g, "_")
        .slice(0, 120) || `attachment-${i}`;
    const file = path.join(attDir, safe);
    await fs.writeFile(file, buf);
    const ext = path.extname(safe).slice(1).toLowerCase();
    blocks.push({
      type: "resource_link",
      uri: "file://" + file,
      name: safe,
      mimeType: IMG_MIME[ext] || "application/octet-stream",
    });
  }
  return blocks;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const sessionId: string | undefined = body?.sessionId;
  const message: string | undefined = body?.message;
  const attachments: Attachment[] = Array.isArray(body?.attachments)
    ? (body.attachments as Attachment[])
    : [];

  if (!sessionId || !(await findSession(sessionId)))
    return Response.json({ error: "Session not found" }, { status: 404 });
  if (!message || !message.trim())
    return Response.json({ error: "Empty message" }, { status: 400 });
  if (running.has(sessionId)) {
    // the session is already processing another message: return the pending
    // permission too (if any) so the card can be re-displayed — the original
    // turn keeps running in the daemon and no permission resolves itself
    const pending = pendingPermissionFor(sessionId);
    return Response.json(
      {
        error: "Session is already processing another message",
        busy: true,
        pending,
      },
      { status: 429 }
    );
  }

  const attDir = path.join(
    os.tmpdir(),
    `copilot-web-att-${crypto.randomUUID()}`
  );
  let blocks: unknown[];
  try {
    await fs.mkdir(attDir, { recursive: true });
    blocks = await buildPromptBlocks(message.trim(), attachments, attDir);
  } catch (e) {
    fs.rm(attDir, { recursive: true, force: true }).catch(() => {});
    return Response.json(
      { error: `Invalid attachment: ${e instanceof Error ? e.message : e}` },
      { status: 400 }
    );
  }

  const session = (await findSession(sessionId))!;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let doneSent = false;
      // hang guard: if the session is busy in another driver (CLI) the prompt
      // gets queued and the stream produces nothing → warn and drop
      let firstUpdateSeen = false;
      let unsub: (() => void) | null = null;

      const send = (ev: SSEEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
        } catch {
          /* stream already closed */
        }
      };

      const sendDone = () => {
        if (doneSent) return;
        doneSent = true;
        send({ type: "done", data: {} });
      };

      const finish = (keepRunning = false) => {
        closed = true;
        // keepRunning: the stream died (reload/navigation) but the turn keeps
        // running in the daemon; running is released when the prompt's finally fires
        if (!keepRunning) running.delete(session.id);
        // NO permission fallback: a pending permission never resolves itself
        // (security decision); the card is re-offered via the 429 "busy" with
        // pendingPermissionFor(session.id)
        unsub?.();
        unsub = null;
        fs.rm(attDir, { recursive: true, force: true }).catch(() => {});
        try {
          controller.close();
        } catch {
          /* noop */
        }
      };

      running.add(session.id);

      void (async () => {
      let msgId: string | null = null;
      let streamStarted = false;
      // ordered timeline: text/reasoning segments interleaved with tool calls
      const parts: MessagePart[] = [];
        // tool calls that failed because a permission was denied: to title them "(denied)"
        const deniable = new Set<string>();

        const updateToolPart = (toolCallId: unknown, st: string) => {
          let target: MessagePart | undefined;
          for (let i = parts.length - 1; i >= 0; i--) {
            const p = parts[i];
            if (
              p.kind === "tool" &&
              (typeof toolCallId === "string" ? p.toolCallId === toolCallId : false)
            ) {
              target = p;
              break;
            }
          }
          if (!target) {
            for (let i = parts.length - 1; i >= 0; i--) {
              const p = parts[i];
              if (p.kind === "tool" && p.status === "pending") {
                target = p;
                break;
              }
            }
          }
          if (target && target.kind === "tool") {
            // failed ≡ error (real failure); an already-errored chip never downgrades
            const eff = st === "failed" ? "error" : st;
            if (eff === "error" || target.status !== "error") target.status = eff;
          }
        };

        unsub = subscribeUpdates(session.id, (u: AcpUpdate) => {
          if (isLoading(session.id)) return; // session/load replay
          firstUpdateSeen = true;
          const kind = u.sessionUpdate;
          if (kind === "agent_thought_chunk") {
            const c = textContentOf(u.content);
            if (c) {
              // reasoning segment interleaved as a part (like the CLI:
              // thought, sentence, tool, thought…)
              const lastP = parts[parts.length - 1];
              if (lastP && lastP.kind === "reasoning") lastP.content += c;
              else parts.push({ kind: "reasoning", content: c });
              send({ type: "reasoning_delta", data: { content: c } });
            }
          } else if (kind === "agent_message_chunk") {
            const c = textContentOf(u.content);
            if (!c) return;
            // daemon "Info: <file>" trailing tool calls duplicates the chip
            // and arrives as the first text chunk of the turn → not shown
            if (
              !streamStarted &&
              DAEMON_INFO_RE.test(c) &&
              parts.some((p) => p.kind === "tool")
            )
              return;
            if (!streamStarted) {
              streamStarted = true;
              msgId = crypto.randomUUID();
              send({ type: "message_start", data: { id: msgId } });
            }
            const last = parts[parts.length - 1];
            if (last && last.kind === "text") last.content += c;
            else parts.push({ kind: "text", content: c });
            send({ type: "delta", data: { id: msgId, content: c } });
          } else if (kind === "tool_call") {
            const detail = toolInputDetail(u.rawInput, u.content);
            parts.push({
              kind: "tool",
              toolCallId:
                typeof u.toolCallId === "string" ? u.toolCallId : undefined,
              title: String(u.title ?? "tool"),
              status: String(u.status ?? "pending"),
              detail,
            });
            send({
              type: "tool",
              data: {
                kind: "tool_call",
                toolCallId: u.toolCallId,
                title: u.title,
                status: u.status,
                detail,
              },
            });
          } else if (kind === "tool_call_update") {
            const st = u.status ? String(u.status) : undefined;
            const tcIdU =
              typeof u.toolCallId === "string" ? u.toolCallId : undefined;
            if (st) updateToolPart(u.toolCallId, st);
            if (st === "failed" && tcIdU && deniable.has(tcIdU)) {
              // failed because a permission was denied and the synthetic
              // resolution did not get to title the chip: close it here
              deniable.delete(tcIdU);
              for (let i = parts.length - 1; i >= 0; i--) {
                const p = parts[i];
                if (
                  p.kind === "tool" &&
                  p.toolCallId === tcIdU &&
                  !p.title.includes("(denied)")
                )
                  parts[i] = { ...p, title: `${p.title} (denied)` };
              }
            }
            // 1.0.80 streams the tool output live via rawOutput.content (or a
            // nested content[] list); nothing to fill in afterwards
            const rawOut = u.rawOutput as { content?: string; output?: string } | undefined;
            const detail = (() => {
              const d0 = rawOut?.content ?? rawOut?.output ?? textContentOf(u.content);
              return d0 ? cleanToolOutput(d0) : d0;
            })();
            if (detail) {
              let updated = false;
              for (let i = parts.length - 1; i >= 0; i--) {
                const p = parts[i];
                if (
                  p.kind === "tool" &&
                  (typeof u.toolCallId === "string"
                    ? p.toolCallId === u.toolCallId
                    : p.status === "pending")
                ) {
                  parts[i] = {
                    ...p,
                    detail:
                      p.detail?.startsWith("$ ") && !detail.startsWith("$ ")
                        ? `${p.detail}\n\n${detail}`
                        : detail,
                  };
                  updated = true;
                  break;
                }
              }
              if (!updated) {
                // update with no preceding tool_call: new chip with the output
                parts.push({
                  kind: "tool",
                  toolCallId:
                    typeof u.toolCallId === "string" ? u.toolCallId : undefined,
                  title: String(u.title ?? "tool"),
                  status: st ?? "completed",
                  detail,
                });
              }
            }
            send({
              type: "tool",
              data: {
                kind: "tool_call_update",
                toolCallId: u.toolCallId,
                status: u.status,
                detail,
              },
            });
          } else if (kind === "available_commands_update") {
            // official slash-command snapshot: re-sent so the composer
            // refreshes its palette live
            const cmds = (u.availableCommands ?? []) as AvailableCommand[];
            if (cmds.length)
              send({ type: "commands", data: { availableCommands: cmds } });
          } else if (kind === "permission_request") {
            // visibility: the agent asks for permission; the web shows a card
            // and the turn stays paused until the user responds
            const reqId = typeof u.reqId === "number" ? u.reqId : null;
            const tcId = typeof u.toolCallId === "string" ? u.toolCallId : undefined;
            if (tcId) deniable.add(tcId);
            // permission tied to a tool: metadata of that chip (no duplicate
            // "permission ·" chip, which would vanish on rehydration)
            if (!tcId)
              parts.push({
                kind: "tool",
                toolCallId: reqId === null ? undefined : `perm-${reqId}`,
                title: `permission · ${String(u.title ?? "tool")}`,
                status: "pending",
              });
            if (reqId !== null)
              send({
                type: "permission",
                data: {
                  reqId,
                  title: u.title,
                  toolCallId: tcId,
                  options: u.options,
                },
              });
          } else if (kind === "permission_resolved") {
            const reqId = typeof u.reqId === "number" ? u.reqId : null;
            const marker = reqId === null ? null : `perm-${reqId}`;
            const tcId = typeof u.toolCallId === "string" ? u.toolCallId : undefined;
            const denied = /deny|reject/i.test(String(u.choice ?? ""));
            if (tcId) deniable.delete(tcId);
            for (let i = parts.length - 1; i >= 0; i--) {
              const p = parts[i];
              if (
                p.kind === "tool" &&
                marker !== null &&
                p.toolCallId === marker
              ) {
                parts[i] = {
                  ...p,
                  title: `${denied ? "permission denied" : "permission granted"} · ${p.title.replace(/^permission · /, "")}`,
                  status: denied ? "error" : "completed",
                };
                break;
              }
            }
            // flag the real tool chip that was left hanging
            if (denied && tcId) {
              for (let i = parts.length - 1; i >= 0; i--) {
                const p = parts[i];
                if (p.kind === "tool" && p.toolCallId === tcId) {
                  parts[i] = {
                    ...p,
                    title: `${p.title} (denied)`,
                    status: "error",
                  };
                  break;
                }
              }
            }
            if (reqId !== null)
              send({
                type: "permission_resolved",
                data: { reqId, choice: u.choice, auto: u.auto, toolCallId: tcId },
              });
          }
        });

        let guardFired = false;
        const guard = setTimeout(() => {
          if (firstUpdateSeen || doneSent) return;
          guardFired = true;
          send({
            type: "error",
            data: {
              message:
                "No response in 20s: the session may be IN USE by another driver (CLI/terminal?). Release it there or retry; history converges anyway.",
            },
          });
          cancelSession(session.id).catch(() => {});
          sendDone();
          finish();
        }, FIRST_UPDATE_TIMEOUT_MS);

        try {
          const out = await prompt(session.id, blocks, message.trim());
          clearTimeout(guard);
          unsub?.();
          unsub = null;
          if (guardFired) return;
          if (out.error) {
            throw new Error(
              "session/prompt: " + (out.error.message || JSON.stringify(out.error))
            );
          }
          const result = out.result as
            | { stopReason?: string; usage?: PromptUsage }
            | undefined;
          const content = textOfParts(parts);
          if (!content.trim()) {
            // no text: with tool chips one meta line is enough (no placeholder
            // bubbles that would duplicate on reload); without any tool, keep
            // the minimal informative bubble
            const hasToolChips = parts.some((p) => p.kind === "tool");
            if (hasToolChips) {
              const deniedTool = parts.some(
                (p) =>
                  p.kind === "tool" &&
                  !p.toolCallId?.startsWith("perm-") &&
                  p.status === "error" &&
                  p.title.includes("(denied)")
              );
              parts.push({
                kind: "system",
                content: deniedTool
                  ? "⚙ permission rejected — no response from the agent"
                  : `⚙ no response from the agent (stopReason: ${result?.stopReason ?? "unknown"})`,
              });
            } else {
              parts.push({
                kind: "text",
                content: `_(no response — stopReason: ${result?.stopReason ?? "unknown"})_`,
              });
            }
          }
          // ACP stream: tool output already arrived live (rawOutput.content of
          // tool_call_update); chips are complete in the sessionLog
          const tools: ToolStep[] = [];
          for (const p of parts)
            if (p.kind === "tool" && !p.toolCallId?.startsWith("perm-"))
              tools.push({
                id: p.toolCallId,
                title: p.title.replace(/^(permission (granted|denied)) · /, ""),
                status: p.status,
                detail: p.detail,
              });
          send({
            type: "message",
            data: {
              id: msgId ?? crypto.randomUUID(),
              role: "assistant",
              content: textOfParts(parts),
              parts: parts.length ? parts : undefined,
              tools: tools.length ? tools : undefined,
              usage: result?.usage,
              stopReason: result?.stopReason,
            },
          });
        } catch (e) {
          send({
            type: "error",
            data: { message: e instanceof Error ? e.message : String(e) },
          });
        } finally {
          unsub?.();
          unsub = null;
          // end of interaction: the session rises to the top (its content
          // persists in the CLI; only metadata lives here)
          touch(session.id);
          sendDone();
          finish();
        }
      })();

      req.signal.addEventListener("abort", () => {
        // stream closed (stop via POST /api/cancel, reload, navigation):
        // we do NOT send session/cancel here — a reload used to cut the turn
        // mid-permission ("Session aborted") and looked like a hang. The
        // turn keeps running in the daemon and its result converges on
        // rehydration; the explicit stop is POST /api/cancel.
        finish(true);
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

type PromptUsage = {
  inputTokens?: number;
  outputTokens?: number;
};