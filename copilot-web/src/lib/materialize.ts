/**
 * Materialización del histórico de una sesión a partir del log de updates
 * ACP (sessionLog en lib/acp.ts: replay de session/load + updates en vivo
 * + eventos sintéticos de permiso). Sustituye al parse del events.jsonl del
 * CLI: solo canal ACP, no se lee ningún fichero interno del CLI.
 *
 * Semántica verificada empíricamente contra el daemon (1.0.80):
 * - user_message_chunk compone la burbuja de usuario (el adjunto aparece
 *   anotado "[Resource link: file://…]", que el cliente pinta como chip).
 * - agent_message_chunk / agent_thought_chunk componen la respuesta.
 * - tool_call / tool_call_update componen chips por toolCallId; la salida
 *   llega en rawOutput.content (o rawOutput.output, o content[] anidado).
 * - permission_request / permission_resolved (sintéticos de la web) son
 *   meta del chip o chip "permiso ·" propio, igual que en el turno vivo.
 * - available_commands_update y demás tipos sin UI se ignoran.
 */
import { DAEMON_INFO_RE, type AcpUpdate } from "./acp";
import type { ChatMessage, MessagePart } from "./types";

/** Tail que el CLI añade a la captura de bash: se oculta en el chip. */
export function cleanToolOut(s: string): string {
  return s.replace(/\n?<shellId: [^>]*>\s*$/, "");
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object";

/** Texto de content de chunk (bloque único o lista, plana o anidada). */
function chunkText(c: unknown): string {
  if (isObj(c)) return typeof c.text === "string" ? c.text : "";
  if (Array.isArray(c))
    return c
      .map((b) => {
        if (typeof b === "string") return b;
        if (!isObj(b)) return "";
        if (typeof b.text === "string") return b.text;
        // tool_call_update anida { type: "content", content: { type: "text" } }
        const inner = b.content;
        if (isObj(inner) && typeof inner.text === "string") return inner.text;
        return "";
      })
      .join("");
  return "";
}

/** Anota resource_link el formato que el cliente ya pinta (chips 📎). */
function userBlockText(c: unknown): string {
  const single = (block: Record<string, unknown>): string => {
    if (block.type === "resource_link") {
      const uri = String(block.uri ?? "").replace(/^file:\/\//, "");
      return uri ? `[Resource link: file://${uri}]` : "";
    }
    return typeof block.text === "string" ? block.text : "";
  };
  if (isObj(c)) return single(c);
  if (Array.isArray(c)) return c.map((b) => (isObj(b) ? single(b) : "")).join("");
  return "";
}

type OpenAssistant = { deniable: Set<string> };

/**
 * Updates ACP → mensajes. El orden del log es el orden real (el replay
 * llega antes que el resultado de session/load; los updates en vivo,
 * mientras el turno corre).
 */
export function materialize(updates: AcpUpdate[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  let openMsg: ChatMessage | null = null;
  let openState: OpenAssistant | null = null;

  const flushAssistant = () => {
    if (!openMsg || !openState) return;
    const st = openState;
    const msg = openMsg;
    openMsg = null;
    openState = null;
    msg.content = (msg.parts ?? [])
      .flatMap((p) => (p.kind === "text" ? [p.content] : []))
      .join("");
    // el razonamiento ya vive en parts (tramos intercalados); basta con
    // comprobar texto + tramos no vacíos
    const has = msg.content.trim() || (msg.parts?.length ?? 0) > 0;
    if (!has) {
      const i = out.indexOf(msg);
      if (i >= 0) out.splice(i, 1);
    }
  };

  const tsOf = (u: AcpUpdate): string | undefined =>
    typeof u.ts === "string" && u.ts ? u.ts : undefined;

  const ensureAssistant = (ts?: string): { msg: ChatMessage; state: OpenAssistant } => {
    if (openMsg && openState) return { msg: openMsg, state: openState };
    const msg: ChatMessage = {
      id: `mat-${out.length}`,
      role: "assistant",
      content: "",
    };
    if (ts) msg.ts = ts;
    out.push(msg);
    openMsg = msg;
    const state: OpenAssistant = { deniable: new Set() };
    openState = state;
    return { msg, state };
  };

  const pushTool = (
    msg: ChatMessage,
    id: string | undefined,
    title: string,
    status: string,
    detail?: string
  ) => {
    msg.parts = msg.parts ?? [];
    msg.parts.push({ kind: "tool", toolCallId: id, title, status, detail });
  };

  /** Último chip con ese toolCallId (escanea el histórico hacia atrás). */
  const findTool = (
    id: string
  ): { msg: ChatMessage; part: MessagePart } | undefined => {
    for (let m = out.length - 1; m >= 0; m--) {
      const msg = out[m];
      const parts = msg.parts ?? [];
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        if (p.kind === "tool" && p.toolCallId === id) return { msg, part: p };
      }
    }
    return undefined;
  };

  for (const u of updates) {
    const kind = u.sessionUpdate;

    if (kind === "user_message_chunk") {
      flushAssistant();
      const chunk = userBlockText(u.content);
      const last = out[out.length - 1];
      if (last && last.role === "user") last.content += chunk;
      else {
        const mu: ChatMessage = { id: `mat-${out.length}`, role: "user", content: chunk };
        const uts = tsOf(u);
        if (uts) mu.ts = uts;
        out.push(mu);
      }
      continue;
    }

    if (kind === "agent_message_chunk" || kind === "agent_thought_chunk") {
      const { msg } = ensureAssistant(tsOf(u));
      const text = chunkText(u.content);
      if (!text) continue;
      if (kind === "agent_thought_chunk") {
        const { msg } = ensureAssistant(tsOf(u));
        const text = chunkText(u.content);
        if (!text) continue;
        msg.parts = msg.parts ?? [];
        const last = msg.parts[msg.parts.length - 1];
        // los deltas se concatenan al último tramo reasoning contiguo; un
        // salto a texto/tool abre un nuevo bloque (igual que el CLI: tramos
        // alternos de pensamiento, frase, herramienta…). NOTA: el replay frío
        // de session/load NO trae thought chunks (ACP no los reproduce), así
        // que esto solo llena sesiones calientes (sessionLog en RAM)
        if (last && last.kind === "reasoning") last.content += text;
        else msg.parts.push({ kind: "reasoning", content: text });
      } else {
        msg.parts = msg.parts ?? [];
        const last = msg.parts[msg.parts.length - 1];
        const opensNewText = !(last && last.kind === "text");
        if (
          opensNewText &&
          DAEMON_INFO_RE.test(text) &&
          msg.parts.some((p) => p.kind === "tool")
        )
          continue; // "Info: <ruta>" del daemon: el chip ya lo enseña
        if (last && last.kind === "text") last.content += text;
        else msg.parts.push({ kind: "text", content: text });
      }
      continue;
    }

    if (kind === "tool_call") {
      const { msg } = ensureAssistant(tsOf(u));
      const id = typeof u.toolCallId === "string" ? u.toolCallId : undefined;
      const rawIn = isObj(u.rawInput)
        ? (u.rawInput as { command?: string })
        : undefined;
      const detail = rawIn?.command
        ? `$ ${rawIn.command}`
        : rawIn
          ? JSON.stringify(rawIn).slice(0, 400)
          : chunkText(u.content) || undefined;
      pushTool(
        msg, id,
        String(u.title ?? "tool"),
        String(u.status ?? "pending"), detail
      );
      continue;
    }

    if (kind === "tool_call_update") {
      const id = typeof u.toolCallId === "string" ? u.toolCallId : "";
      if (!id) continue;
      ensureAssistant(tsOf(u));
      const st = typeof u.status === "string" ? u.status : undefined;
      const rawOut = isObj(u.rawOutput)
        ? (u.rawOutput as { content?: string; output?: string })
        : undefined;
      const rawDetail = rawOut
        ? rawOut.content ?? rawOut.output ?? ""
        : chunkText(u.content);
      const detail = rawDetail ? cleanToolOut(rawDetail) : "";
      const hit = findTool(id);
      if (hit && hit.part.kind === "tool") {
        const p = hit.part;
        const eff = st === "failed" ? "error" : st;
        if (eff && (eff === "error" || p.status !== "error")) p.status = eff;
        if (detail)
          p.detail =
            p.detail?.startsWith("$ ") && !detail.startsWith("$ ")
              ? `${p.detail}\n\n${detail}`
              : detail;
      } else if (detail || st) {
        // update sin tool_call previo (replay parcial): chip nuevo
        const { msg } = ensureAssistant(tsOf(u));
        pushTool(
          msg, id,
          String(u.title ?? "tool"), st ?? "completed", detail || undefined
        );
      }
      continue;
    }

    if (kind === "permission_request") {
      const { msg, state } = ensureAssistant(tsOf(u));
      const reqId = typeof u.reqId === "number" ? u.reqId : null;
      const tcId = typeof u.toolCallId === "string" ? u.toolCallId : undefined;
      if (tcId) state.deniable.add(tcId);
      if (!tcId)
        pushTool(
          msg,
          reqId === null ? undefined : `perm-${reqId}`,
          `permission · ${String(u.title ?? "tool")}`,
          "pending"
        );
      continue;
    }

    if (kind === "permission_resolved") {
      const reqId = typeof u.reqId === "number" ? u.reqId : null;
      const tcId = typeof u.toolCallId === "string" ? u.toolCallId : undefined;
      const denied = /deny|reject/i.test(String(u.choice ?? ""));
      const { msg, state } = ensureAssistant(tsOf(u));
      if (tcId) state.deniable.delete(tcId);
      const marker = reqId === null ? null : `perm-${reqId}`;
      const parts = msg.parts ?? [];
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        if (p.kind === "tool" && marker !== null && p.toolCallId === marker) {
          parts[i] = {
            ...p,
            title: `${denied ? "permission denied" : "permission granted"} · ${p.title.replace(/^permission · /, "")}`,
            status: denied ? "error" : "completed",
          };
          break;
        }
      }
      if (denied && tcId) {
        const hit = findTool(tcId);
        if (hit && hit.part.kind === "tool") {
          const p = hit.part;
          const partsR = hit.msg.parts ?? [];
          const i = partsR.indexOf(p);
          if (i >= 0)
            partsR[i] = { ...p, title: `${p.title} (denied)`, status: "error" };
        }
      }
      continue;
    }

    // available_commands_update y cualquier otro tipo: sin UI
  }

  flushAssistant();
  return out;
}