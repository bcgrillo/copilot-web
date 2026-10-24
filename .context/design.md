# Design — copilot-web (arquitectura actual)

## Arquitectura

```
Browser (Next.js pages/SSE client)
   │  fetch JSON + SSE (trailing slash en todas las rutas de API)
   ▼
Next.js server (src/app/api/*)   ← lo arranca bin/copilot-web.mjs (launcher)
   │  JSON-RPC over TCP
   ▼
daemon ACP: copilot --acp --port 3222 [--allow-all-*] [--model m]  ⇄  Copilot
             (por defecto SIN allow-all: los permisos llegan por ACP y la
              web los resuelve con cards allow/deny; --copilot-args para optar)
```

### Piezas
- Launcher `bin/copilot-web.mjs`: opts (--port, --acp-port, --cwd, --copilot-args,
  --lang, --model, --build, --no-daemon, --no-helper); reutiliza/spawnea el daemon detached;
  env del server: PORT, ACP_PORT, CHAT_CWD, COPILOT_ACP_ARGS, COPILOT_WEB_LANG, COPILOT_MODEL.
  El daemon NO hereda el entorno del operador: env whitelisted (OPS-06) compuesto
  con el provider/model leído de `.env.local` (no versionado).
- `src/lib/acp.ts`: cliente JSON-RPC del daemon (session/new|load|list|prompt|close,
  updates → sessionLog en RAM, pendingPermission, runningTurns).
- `src/lib/copilotStore.ts` + `store.ts`: listado = session/list al vuelo (desc por
  updatedAt) + overlay RAM 0-turn; findSession para las routes; MAX 300.
- `materialize.ts`: sessionLog → parts {kind:"user"|"text"|"reasoning"|"tool"|"system"}
  (deltas concatenados), reasoning intercalado como en el CLI.
- API: sessions (CRUD por ACP), chat (POST prompt → SSE en vivo), sessions/[id]
  (hidratación materializada), status/[id] (cwd + rama git estándar + model),
  permissions (resolución), commands (paleta slash).
- UI: Sidebar (lista, nueva, rename, delete), Chat (burbujas, chips de tools, reasoning,
  draft por sesión en localStorage, barra de estado bajo el composer, auto-reenvío tras
  permiso, poll de running), tema claro/oscuro (icono en footer), idioma del navegador o
  --lang (src/lib/i18n.tsx, sin toggle).
- i18n: COPILOT_WEB_LANG (script pre-hidratación en layout) → localStorage legacy →
  navigator → "en". Paridad 1:1 de claves es/en.
- MCP helper (rama feature/mcp-helper): launcher escribe /tmp/copilot-web-helper-<port>.json
  y añade --additional-mcp-config @fichero al daemon; `mcp/ask-user.mjs` (MCP stdio,
  tool ask_user → POST a la web + long-poll); endpoints /api/helper/* con store RAM
  (`src/lib/helperAsk.ts`); card azul HelperAskCard en Chat mientras corre el turno.
  Detalles y decisiones: docs/mcp-helper.md.

### Reglas transversales
- Zero-materialized data; límites ACP documentados en decisions.md.
- Permisos sin resolución automática: la card es la única resolución (click).
- trailingSlash: true → rutas de API siempre con slash final.
- Publicación: servicio web de CodePods (puerto 3100 en el pod actual).
- Pipeline GitHub: release workflow (npm pack del launcher + scripts/install.sh) en
  preparación; rama MCP helper aparte (feature/mcp-helper, tool ask_user).
