"use client";

/**
 * i18n mínimo de la POC: diccionario en/es + provider con contexto React.
 * Default: inglés (detecta es desde navigator.language). Persiste en
 * localStorage("lang"). Server-side los strings van en inglés (beta).
 */
declare global {
  interface Window {
    __WEB_LANG?: string;
  }
}

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "en" | "es";

const es = {
  "sidebar.sessions": "Sesiones",
  "chat.sessions": "Sesiones",
  "sidebar.newSession": "Nueva sesión",
  "sidebar.close": "Cerrar",
  "sidebar.empty": "Todavía no hay sesiones. Crea la primera con «+».",
  "sidebar.options": "Opciones",
  "sidebar.rename": "Renombrar",
  "sidebar.delete": "Eliminar",
  "chat.noSession": "Sin sesión",
  "chat.running": "ejecutando",
  "chat.loading": "cargando…",
  "chat.loadingSession": "cargando sesión…",
  "chat.reasoning": "razonamiento",
  "chat.workDir": "Directorio de trabajo",
  "chat.model": "Modelo",
  "chat.loadOlder": "Cargar {n} anteriores",
  "chat.messagesCount": "{a} de {b} mensajes",
  "chat.thinkingPlaceholder": "Copilot está pensando…",
  "chat.inputPlaceholder": "Escribe un mensaje… ('/' para comandos)",
  "chat.stop": "Detener turno",
  "chat.send": "Enviar",
  "chat.attach": "Adjuntar archivos (8 máx, 5 MB cada uno)",
  "chat.remove": "Quitar",
  "chat.copy": "copiar",
  "chat.copied": "copiado",
  "chat.copyTitle": "Copiar respuesta",
  "chat.executing": "ejecutando…",
  "chat.emptyTitle": "¿En qué estás trabajando?",
  "chat.emptyText":
    "Esta sesión envía tus mensajes al Copilot CLI, que puede leer código, editar archivos y ejecutar comandos en {cwd}.",
  "chat.sug1": "Explícame la estructura de este repositorio",
  "chat.sug2": "Resume los cambios pendientes en git",
  "chat.sug3": "Escribe y ejecuta un hola mundo en Python",
  "chat.permissionTitle": "El agente solicita permiso",
  "chat.permissionHint": "el turno queda en pausa hasta tu respuesta",
  "chat.helperAskTitle": "El agente te pregunta",
  "chat.helperAskHint": "responde y el agente continúa",
  "chat.helperAskPlaceholder": "Escribe tu respuesta…",
  "chat.deny": "Denegar",
  "chat.allow": "Permitir",
  "chat.permAllowOnce": "Permitir esta vez",
  "chat.permAllowAlways": "Permitir siempre",
  "chat.permRejectOnce": "Rechazar esta vez",
  "chat.permRejectAlways": "Rechazar siempre",
  "err.loadSessions": "No se pudieron cargar las sesiones",
  "err.rename": "No se pudo renombrar (error {n})",
  "err.renameNet": "No se pudo contactar con la API para renombrar la sesión",
  "err.delete": "No se pudo borrar (error {n})",
  "err.deleteNet": "No se pudo contactar con la API para borrar la sesión",
  "err.busyPerm": "La sesión espera tu respuesta sobre un permiso pendiente.",
  "err.permStale":
    "Ese permiso ya no es válido (el daemon se reinició o la solicitud caducó). Si sigue haciendo falta, vuelve a enviar el mensaje.",
  "err.busyTurn":
    "La sesión termina un turno anterior; espera unos segundos o cámbiala y reenvía.",
  "footer.themeAuto": "Tema: automático (sistema)",
  "footer.themeLight": "Tema: claro",
  "footer.themeDark": "Tema: oscuro",
  "footer.helpTitle": "Ayuda y acerca de",
  "about.line": "Una interfaz web para GitHub Copilot CLI, creada como proyecto comunitario.",
  "about.disclaimer":
    "Proyecto comunitario NO oficial. No está afiliado, respaldado ni patrocinado por GitHub, Microsoft ni OpenAI. «GitHub Copilot» es una marca de GitHub, Inc.",
  "about.repo": "Código fuente en GitHub",
  "about.issues": "Reportar un problema (issues)",
  "about.back": "Volver al chat",
};

const en: Record<keyof typeof es, string> = {
  "sidebar.sessions": "Sessions",
  "chat.sessions": "Sessions",
  "sidebar.newSession": "New session",
  "sidebar.close": "Close",
  "sidebar.empty": "No sessions yet. Create your first one with «+».",
  "sidebar.options": "Options",
  "sidebar.rename": "Rename",
  "sidebar.delete": "Delete",
  "chat.noSession": "No session",
  "chat.running": "running",
  "chat.loading": "loading…",
  "chat.loadingSession": "loading session…",
  "chat.reasoning": "Thinking",
  "chat.workDir": "Working directory",
  "chat.model": "Model",
  "chat.loadOlder": "Load {n} older",
  "chat.messagesCount": "{a} of {b} messages",
  "chat.thinkingPlaceholder": "Copilot is thinking…",
  "chat.inputPlaceholder": "Type a message… ('/' for commands)",
  "chat.stop": "Stop turn",
  "chat.send": "Send",
  "chat.attach": "Attach files (8 max, 5 MB each)",
  "chat.remove": "Remove",
  "chat.copy": "copy",
  "chat.copied": "copied",
  "chat.copyTitle": "Copy reply",
  "chat.executing": "executing…",
  "chat.emptyTitle": "What are you working on?",
  "chat.emptyText":
    "This session sends your messages to the Copilot CLI, which can read code, edit files and run commands in {cwd}.",
  "chat.sug1": "Explain the structure of this repository",
  "chat.sug2": "Summarize pending git changes",
  "chat.sug3": "Write and run a hello world in Python",
  "chat.permissionTitle": "The agent requests permission",
  "chat.permissionHint": "the turn is paused until you respond",
  "chat.helperAskTitle": "The agent has a question",
  "chat.helperAskHint": "reply and the agent continues",
  "chat.helperAskPlaceholder": "Type your answer…",
  "chat.deny": "Deny",
  "chat.allow": "Allow",
  "chat.permAllowOnce": "Allow this time",
  "chat.permAllowAlways": "Allow always",
  "chat.permRejectOnce": "Reject this time",
  "chat.permRejectAlways": "Reject always",
  "err.loadSessions": "Could not load sessions",
  "err.rename": "Could not rename (error {n})",
  "err.renameNet": "Could not reach the API to rename the session",
  "err.delete": "Could not delete (error {n})",
  "err.deleteNet": "Could not reach the API to delete the session",
  "err.busyPerm": "The session awaits your answer about a pending permission.",
  "err.permStale":
    "That permission request is no longer valid (the daemon restarted or it expired). Send your message again if it is still needed.",
  "err.busyTurn":
    "The session is finishing a previous turn; wait a few seconds or switch sessions and resend.",
  "footer.themeAuto": "Theme: auto (system)",
  "footer.themeLight": "Theme: light",
  "footer.themeDark": "Theme: dark",
  "footer.helpTitle": "Help & About",
  "about.line": "A web interface for the GitHub Copilot CLI, built as a community project.",
  "about.disclaimer":
    "Unofficial community project. It is not affiliated with, endorsed by, or sponsored by GitHub, Microsoft or OpenAI. “GitHub Copilot” is a trademark of GitHub, Inc.",
  "about.repo": "Source code on GitHub",
  "about.issues": "Report an issue",
  "about.back": "Back to chat",
};

export const dict: Record<Lang, Record<string, string>> = { en, es };

export function detectLang(): Lang {
  // 1) flag del launcher (--lang, inyectada por el server en window.__WEB_LANG)
  if (typeof window !== "undefined") {
    const v = window.__WEB_LANG;
    if (v === "en" || v === "es") return v;
  }
  // 2) elección previa del usuario (legacy del toggle eliminado)
  try {
    const v = localStorage.getItem("lang");
    if (v === "en" || v === "es") return v;
  } catch {}
  // 3) idioma del navegador (por defecto)
  if (typeof navigator !== "undefined" && navigator.language?.startsWith("es"))
    return "es";
  return "en";
}

/** formato simple con {vars} */
function fmt(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

const Ctx = createContext<Lang>("en");

export function LangProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [lang, setLang] = useState<Lang>("en");
  useEffect(() => setLang(detectLang()), []);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  return (
    <Ctx.Provider value={lang}>{children}</Ctx.Provider>
  );
}

export function useLang(): Lang {
  return useContext(Ctx);
}

/** hook de traducción: t("key", vars) */
export function useT() {
  const lang = useLang();
  return (
    key: string,
    vars?: Record<string, string | number>
  ): string => fmt(dict[lang]?.[key] ?? dict.en[key] ?? key, vars);
}

/** locale para fechas según idioma */
export function localeOf(lang: Lang): string {
  return lang === "es" ? "es-ES" : "en-US";
}