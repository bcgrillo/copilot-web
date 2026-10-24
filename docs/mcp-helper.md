# MCP "interfaz helper" — estudio y scaffold (rama `feature/mcp-helper`)

## Registro de servidores MCP en Copilot CLI (verificado 1.0.80)

Fuentes de configuración (`copilot mcp --help`):

| Fuente | Cómo |
| --- | --- |
| Usuario | `~/.copilot/mcp-config.json` (`copilot mcp add/list/get/remove`) |
| Workspace | `.mcp.json` o `.github/mcp.json` |
| Por sesión | CLI flag `--additional-mcp-config <json | @archivo>` (repetible; "augments" la del usuario) |

Vías viables para el helper **sin tocar la config global** del usuario:

1. **Launcher (elegida)**: `bin/copilot-web.mjs`, al spawnear `copilot --acp`,
   escribe en `/tmp` un JSON:
   ```json
   {"mcpServers": {"copilot-web-helper": {"type": "local", "command": "node",
    "args": ["<rootAbs>/mcp/ask-user.mjs"], "env": {"COPILOT_WEB_URL": "http://localhost:3100"}}}}
   ```
   y añade `--additional-mcp-config @/tmp/...json` a los args del daemon.
   Cero persistencia, muere con el launcher (Principio 0).
2. **`copilot mcp add copilot-web-helper -- node <abs>/mcp/ask-user.mjs`** —
   manual, persistente en `~/.copilot/mcp-config.json` (opción de la doc para
   quien no use el launcher).

Pendiente de verificar en una sesión real: la clave exacta para stdio
(`"type": "local"` vs sin `type` con `command`) y si `tools: "*"` es necesario.

## Tool `ask_user`

`mcp/ask-user.mjs` (scaffold v0): servidor MCP stdio (JSON-RPC por líneas).
- `initialize` / `tools/list` — verificado con probe JSON-RPC directo.
- `tools/call ask_user {question, kind?, options?}` → hace POST a la web
  (`COPILOT_WEB_URL`, default `http://localhost:3100`) y devuelve el texto.
  Hoy la web no tiene esos endpoints → el error sale honesto en el agente.

## Flujo propuesto (siguiente iteración)

1. El agente llama `ask_user("¿despliego a prod?")`.
2. Web expone `POST /api/helper/ask` (desde el MCP server) → registra en RAM
   una pregunta pendiente `{id, question}` y la emite por SSE a la(s)
   sesión(es) con turno en curso (correlación: la pregunta no sabe su
   sessionId; v0 = mostrarla en toda sesión con "ejecutando" activo).
3. UI: card de pregunta (como la de permiso), con input de texto libre o
   botones si `kind=choice` + `options`.
4. Usuario responde → `POST /api/helper/answer/<id>` (desde el cliente web)
   → el endpoint MCP long-poll devuelve la respuesta → el tool acaba → el
   agente continúa.

## Estado — IMPLEMENTADO (v0.0.21, verificado E2E real)

- ✅ wiring del launcher: `--helper` ON por defecto al spawnear daemon
  (`--no-helper` para desactivar); si el daemon se reutiliza, warn honesto.
- ✅ endpoints web: `GET /api/helper/ask/` (pendientes, polling de la UI),
  `GET /api/helper/ask/?id=X` (estado), `POST /api/helper/ask/` (el helper;
  con `poll:true` espera hasta 5 min vía long-poll), `POST /api/helper/answer/X/`
  (la card; duplicada → 410, desconocida → 404). Store RAM: `src/lib/helperAsk.ts`.
- ✅ card UI en `Chat.tsx` (`HelperAskCard`, azulado; input de texto libre
  `kind=info` + botón enviar, botones de opciones `kind=choice`): visible
  mientras la sesión tiene un turno en curso (poll 1.5 s).
- ✅ E2E real: el agente llamó `copilot-web-helper-ask_user`, la card apareció
  y con la respuesta del usuario el tool step completó ("The web adapter for
  Copilot CLI") y el turno terminó sin interferir con chips de shell.

## Decisiones (v0, las "pendientes" ya resueltas)

- Correlación pregunta→sesión: la tool no conoce su sessionId → la card se
  muestra en la(s) sesión(es) con turno en curso (suficiente para el caso
  normal: la sesión que pregunta es la que corre). Mejora future: registrar
  sessionId al recibir el MCP call (el CLI manda _meta por turno…).
- Timeout: 5 min (long-poll del lado web); pendientes caducadas se ocultan de
  la UI; el helper recibe `{"answered":false,"error":"timeout"}` → error
  honesto al agente, que continúa por su cuenta.
- UI de respuesta: ambos (texto libre por defecto, botones con `kind=choice`).
- Chip público del tool en el chat: `copilot-web-helper-ask_user`.