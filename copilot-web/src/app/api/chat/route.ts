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
  type AcpUpdate,
} from "@/lib/acp";
import { cleanToolOut } from "@/lib/materialize";
import type { Attachment, AvailableCommand, MessagePart, ToolStep } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

// una ejecución por sesión a la vez
import { runningTurns as running } from "@/lib/acp";

const MAX_FILES = 8;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

type SSEEvent = { type: string; data: Record<string, unknown> };

const textOf = (parts: MessagePart[]) =>
  parts.flatMap((p) => (p.kind === "text" ? [p.content] : [])).join("");

const IMG_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
};

// Bloques ACP del prompt: el texto del usuario + cada adjunto como
// resource_link con URI file:// real. El agente lee los ficheros con su
// propia tool al procesar (verificado E2E: "Viewing <file>").
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
      throw new Error(`"${att.name}" supera 5 MB (límite POC)`);
    }
    const safe =
      path
        .basename(att.name || "")
        .replace(/[^\w.\- ()]+/g, "_")
        .slice(0, 120) || `adjunto-${i}`;
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
    // la sesión ya está procesando otro mensaje: devolvemos también el
    // permiso pendiente si lo hay, para poder re-mostrar la card (el turno
    // original sigue vivo en el daemon y ningún permiso se resuelve solo)
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
      { error: `Adjunto inválido: ${e instanceof Error ? e.message : e}` },
      { status: 400 }
    );
  }

  const session = (await findSession(sessionId))!;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let doneSent = false;
      // guarda anti-colgado: si la sesión está en uso por otro driver (CLI)
      // el prompt queda en cola y el stream no produce nada → avisar y soltar
      let firstUpdateSeen = false;
      let unsub: (() => void) | null = null;

      const send = (ev: SSEEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
        } catch {
          /* stream ya cerrado */
        }
      };

      const sendDone = () => {
        if (doneSent) return;
        doneSent = true;
        send({ type: "done", data: {} });
      };

      const finish = (keepRunning = false) => {
        closed = true;
        // keepRunning: stream muerto (reload/navegación) pero el turno sigue
        // en el daemon; running se libera cuando el prompt termine en su finally
        if (!keepRunning) running.delete(session.id);
        // SIN fallback de permisos: un permiso pendiente nunca se resuelve
        // solo (decisión de seguridad); la card se vuelve a ofrecer vía el
        // 429 "busy" con pendingPermissionFor(session.id)
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
      // timeline ordenado: tramos de texto y razonamiento alternados con tool calls
      const parts: MessagePart[] = [];
        // tools cuyo fallo fue un permiso denegado: para titular "(denegado)"
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
            // failed ≡ error (fallo real); un error ya marcado nunca se degrada
            const eff = st === "failed" ? "error" : st;
            if (eff === "error" || target.status !== "error") target.status = eff;
          }
        };

        const textOfContent = (c: unknown): string | undefined => {
          const flat = (b: unknown): string => {
            if (!b || typeof b !== "object") return "";
            if (typeof (b as { text?: string }).text === "string")
              return (b as { text?: string }).text ?? "";
            // tool_call_update anida { type:"content", content:{ type:"text" } }
            const inner = (b as { content?: unknown }).content;
            if (inner && typeof inner === "object" && typeof (inner as { text?: string }).text === "string")
              return (inner as { text?: string }).text ?? "";
            return "";
          };
          if (Array.isArray(c)) {
            const t = c.map(flat).join("");
            return t || undefined;
          }
          return flat(c) || undefined;
        };

        unsub = subscribeUpdates(session.id, (u: AcpUpdate) => {
          if (isLoading(session.id)) return; // replay del session/load
          firstUpdateSeen = true;
          const kind = u.sessionUpdate;
          if (kind === "agent_thought_chunk") {
            const c = (u.content as { text?: string })?.text ?? "";
            if (c) {
              // tramo de razonamiento como part intercalado (igual que el
              // CLI: pensamiento, frase, herramienta, pensamiento…)
              const lastP = parts[parts.length - 1];
              if (lastP && lastP.kind === "reasoning") lastP.content += c;
              else parts.push({ kind: "reasoning", content: c });
              send({ type: "reasoning_delta", data: { content: c } });
            }
          } else if (kind === "agent_message_chunk") {
            const c = (u.content as { text?: string })?.text ?? "";
            if (!c) return;
            // "Info: <ruta>" del daemon tras create/edit: duplica el chip y
            // llega como primer chunk de texto del turno → no se muestra
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
            const rawIn = u.rawInput as { command?: string } | undefined;
            const detail = rawIn?.command
              ? `$ ${rawIn.command}`
              : rawIn
                ? JSON.stringify(rawIn).slice(0, 400)
                : textOfContent(u.content);
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
              // falló por permiso denegado y la resolución sintética no llegó
              // a titular el chip: se cierra la meta aquí
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
            // 1.0.80 trae la salida del tool en vivo vía rawOutput.content
            // (o la lista content[] con bloques anidados); nada que
            // rellenar a posteriori
            const rawOut = u.rawOutput as { content?: string; output?: string } | undefined;
            const detail = (() => {
              const d0 = rawOut?.content ?? rawOut?.output ?? textOfContent(u.content);
              return d0 ? cleanToolOut(d0) : d0;
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
                // update sin tool_call previo: chip nuevo con la salida
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
            // snapshot oficial de comandos slash: lo reenviamos para que el
            // composer refresque su paleta en vivo
            const cmds = (u.availableCommands ?? []) as AvailableCommand[];
            if (cmds.length)
              send({ type: "commands", data: { availableCommands: cmds } });
          } else if (kind === "permission_request") {
            // visibilidad: el agente pide permiso; la web muestra una card y
            // el turno queda en espera hasta que el usuario responda
            const reqId = typeof u.reqId === "number" ? u.reqId : null;
            const tcId = typeof u.toolCallId === "string" ? u.toolCallId : undefined;
            if (tcId) deniable.add(tcId);
            // permiso asociado a un tool: meta del chip del tool (sin chip
            // "permiso ·" duplicado, que desaparecería al rehidratar)
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
            // marca el tool real pendiente que se quedó colgado
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
                "Sin respuesta en 20s: la sesión puede estar EN USO por otro driver (¿CLI/Copilot en terminal?). Libérala ahí o reintenta; el histórico converge igualmente.",
            },
          });
          cancelSession(session.id).catch(() => {});
          sendDone();
          finish();
        }, 20_000);

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
          const content = textOf(parts);
          if (!content.trim()) {
            // sin texto: con chips de tool basta una línea de meta (no burbujas
            // placeholder que se duplican con events.jsonl); si no hay ninguna
            // herramienta, se mantiene la burbuja informativa mínima
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
                  : `⚙ sin respuesta del agente (stopReason: ${result?.stopReason ?? "unknown"})`,
              });
            } else {
              parts.push({
                kind: "text",
                content: `_(no response — stopReason: ${result?.stopReason ?? "unknown"})_`,
              });
            }
          }
          // stream ACP: la salida del tool ya llegó en vivo (rawOutput.content
          // de tool_call_update); los chips quedan completos en el sessionLog
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
              content: textOf(parts),
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
          // fin de la interacción: sube la sesión en el orden (el contenido
          // persiste en el CLI; aquí solo metadatos)
          touch(session.id);
          sendDone();
          finish();
        }
      })();

      req.signal.addEventListener("abort", () => {
        // stream cerrado (stop vía POST /api/cancel, reload, navegación):
        // NO enviamos session/cancel aquí — antes un reload cortaba el turno
        // mid-permiso ("Session aborted") y parecía un colgado. El turno
        // sigue en el daemon y su resultado queda en events.jsonl (converge
        // al re-hidratar); el stop real lo hace /api/cancel explícitamente.
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