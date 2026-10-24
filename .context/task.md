# task.md — POC: Interfaz web para Copilot CLI

## Objetivo
Web app (POC rápida) con gestor de sesiones + ventana de chat que envía mensajes al CLI
`copilot` y muestra sus respuestas. Se mantiene la misma sesión salvo cambio explícito.

## Estado
- Branch: `feature/mcp-helper` (poc = `feature/copilot-web-poc`; única diferencia: MCP)
- **v0.0.32** (header móvil + ajustes): header en móvil con logo h-8 a la
  izquierda (igual que el sidebar, sin salto al abrir) y menú de sesiones h-8 a
  la derecha; lápiz pegado al título y menos sutil (foreground/60). Selector de
  acento en grid 2×8 (16 tonos, orden por hue, +amarillo). Punto del favicon
  eliminado (dobla con la Notification del navegador; quedan badges de sidebar +
  notificación oculta). Quirk: fork EAGAIN transitorio en el contenedor →
  reintentos; builds solo con el server parado.
- **v0.0.31** (badges + notifs + header rename): "pendiente de ver" por sesión —
  contador rojo en el sidebar cuando el turno termina o llega un permiso y la
  sesión no se está mirando (activa+visible); se limpia al visitar/enviar. Título
  de pestaña `(N) Nombre sesión` con "Beta" fuera; punto rojo en el favicon
  dinámico; Notification API opt-in (toggle en Config; localStorage `cwUnread` +
  `cwNotify`; clic en la notificación enfoca la ventana). Header del chat: `#id`
  sin "sess" y renombrado desde el header (lápiz desktop / tocar el título en
  móvil). Ops post-restart: `curl :3222` 000 SIEMPRE (daemon TCP JSON-RPC, no
  HTTP; vivo = EADDRINUSE en foreground); relanzar web con
  `cd copilot-web && npm run serve -- --no-daemon --cwd /workspace --model
  default` (reusa daemon 910/921, sesiones intactas); NUNCA lanzar el serve
  desde /workspace (npm ENOENT).
- **v0.0.25.3** (fixes beta): móvil — el cwd/rama del status-bar se ocultan por
  debajo de `sm` (sin espacio; el modelo sigue a la derecha) y el textarea baja
  a 0.9rem en móvil (`text-[0.9rem] md:text-sm`) para que el placeholder quepe
  en 1 línea. Dark real: `@custom-variant dark (&:where(.dark, .dark *))` en
  globals.css — antes las variantes `dark:` iban por `prefers-color-scheme`
  (default v4) y un móvil con SO claro + web en dark manual perdía
  `dark:prose-invert` (texto oscuro sobre oscuro); el CSS compilado ahora es
  `.dark\:prose-invert:where(.dark,.dark *)`. README (en/es): límite de auth
  reformulado con terminología correcta (authN/authZ, single-user roadmap).
  Quirk: build falla con pool de threads (pids.max=256 del contenedor, 46
  zombies del init) → parar el server web durante el build y relanzar.
- **v0.0.25.2** (d8afb4a): About + Config como popups (backdrop translúcido
  claro/oscuro sobre el chat, Esc/backdrop/✕). Config: idioma (auto/navegador,
  EN, ES — cambio en vivo), modo (auto/claro/oscuro) y COLOR del acento (15
  paletas, brillo derivado por tema vía `--emerald`; data-accent aplicado
  pre-paint en layout, persiste en localStorage). Daemon ACP: estado en vivo
  GET `/api/daemon` (pid/puerto/modelo vía /proc) + botón de reinicio POST
  `{action:"restart"}` que matan daemon+helper huérfanos y respawn con argv
  fiel al launcher (--model + helper MCP + allow-tool, env saneado) — E2E:
  daemon reaparece con helper y acepta session/new. NOTA: el POST necesita
  trailing slash (`/api/daemon/`) por el redirect 308 de Next (fetch del
  navegador lo sigue solo). Footer: ayuda abre AboutModal; botón settings
  abre SettingsModal. `/about` (ruta) reusa AboutContent. **PRUEBA reversible
  del logo**: sidebar/about usan `<Logo text-emerald>` SIN badge (antes:
  badge emerald h-8 + logo h-6 blanco); si no gusta, volver en Sidebar.tsx
  y About.tsx a `span bg-emerald + Logo h-6 text-primary-foreground`.
- **v0.0.25**: branding + tema auto + About. Logo SVG propio
  (renombrado a `copilot-web/public/copilot-web.svg`, `Logo.tsx` inline con
  fill currentColor; sustituye al robot en sidebar + EmptyState), favicon
  dark-aware (`src/app/icon.svg`, negro→blanco con prefers-color-scheme),
  tema tri-estado auto/light/dark (SunMoon; default auto que sigue al sistema
  + listener en vivo), página `/about` con disclaimer de NO afiliación,
  link repo + issues y versión de `package.json` (bump 0.0.25), README con
  disclaimer. Build/tsc/E2E curl verificados. **Merge a `dev` hecho y
  pusheado** (`737f986`, v0.0.17–v0.0.25 + v0.0.25; quedamos con la rama MCP
  helper; poc queda como archivo) — siguiente fase: pipelines, instalador.
- **To-do (fase pipelines/tests)** — añadir suite de tests del proyecto y
  workflow de CI en GitHub Actions, con badge `tests` dinámico en los READMEs
  (hoy existen estáticos "pending" en README.md y README.es.md junto al resto
  de badges: license/beta/issues/release). Incluir en los próximos trabajos de
  pipelines (release.yml ya está; falta CI + instalador).
- **To-do (auth básica)** — implementar un sistema de autenticación básico
  (authN/authZ, usuario único) para la UI y las API routes; hoy la web abre sin
  barreras y cualquiera que alcance el puerto tiene acceso completo al Copilot.
  Candidatos mínimos: token compartido por env (--auth-token) + cookie
  HttpOnly con middleware de Next, o Basic Auth en el launcher. Documentado ya
  en README (Known limits) con la nota de "bind to localhost / proxy" +
  roadmap. Contexto: la exposición pública de esta POC hoy la protege el login
  de CodePods, no la propia app.
- **v0.0.24**: card de permiso renderiza las opciones reales del agente
  (allow_once/allow_always/reject_once…; botones por kind, rechazar izq rojo /
  permitir dcha verde, frase arriba + botones debajo en línea con opciones),
  respuestas `{reqId, optionId}` validadas (400 inválida / 404 caducada),
  allow_always memoriza por comando (E2E), helper `--allow-tool
  copilot-web-helper(ask_user)` (sin permiso, E2E). Pendiente review del
  usuario + sync a poc (todo excepto el flag del helper).
- **v0.0.22**: decision cards al ancho del textarea + composer oculto mientras hay
  decisión pendiente; ask_user con opciones en vertical + "Otra respuesta (texto
  libre)" siempre; `[⎇rama]` sin doble espacio; badge POC → Beta. Sincronizar items
  generales (cards/composer, status bar, Beta) a `feature/copilot-web-poc`.
- **v0.0.21**: MCP helper ask_user IMPLEMENTADO + verificado E2E real (agente llama la
  tool, card en web, respuesta devuelve el resultado al agente) + fix auth cold
  (env whitelisted del daemon + .env.local como fuente provider/model; session/new 201
  en frío). Docs: mcp-helper.md (estado/decisiones final), design/decisions/README/changelog.
- Pendiente: llevar el fix del launcher (env saneado, SIN MCP) a feature/copilot-web-poc.
- **Lote beta COMPLETADO** (revisión pendiente del usuario):
  - CLI launcher `bin/copilot-web.mjs` — commit `e0f1f4e` (warm/cold E2E OK)
  - **i18n en/es** — commit `e1a2304`: dict 46 claves + LangProvider (default EN,
    detecta ES del navigator, persiste en `localStorage.lang`), toggle EN/ES en el footer,
    Sidebar/Chat/page traducidos y strings server en inglés (materialize/routes/acp;
    chips de permiso → `permission ·`, `(denied)`). `formatTs` usa locale por idioma.
    E2E real post-build: turno eco `i18n-e2e` completo con ts en vivo 22:13:27→29
    y replay frío sin ts (Principio 0 intacto). Server relanzado en :3100.
  - **README beta** — commit `d946e7d` (`README.md` raíz: ACP web adapter for
    Copilot CLI, quick start con `scripts/install.sh`, tabla de options del launcher,
    límites beta, privacidad) + `scripts/install.sh` (checks node>=20/npm/copilot,
    npm ci + build + `npm run serve`).
  - **Pipeline de releases** — commit `d946e7d`: `.github/workflows/release.yml`
    (on tag `v*` + workflow_dispatch; build en Node 20; tarball con copilot-web/ sin
    node_modules/.next/.env.local + install.sh + README; gh release). Sin tags push —
    para cuando el usuario decida cortar release.
  - **MCP helper** — DONE como scaffold en rama aparte `feature/mcp-helper` @ `3fc29d5`
    (NO fusionar aún): `copilot-web/mcp/ask-user.mjs` (servidor MCP stdio; probes
    initialize/tools/list OK) + `docs/mcp-helper.md` (registro verificado en CLI
    1.0.80: `~/.copilot/mcp-config.json`, workspace `.mcp.json`, y
    `--additional-mcp-config @archivo` por sesión = vía elegida del launcher).
    Decisiones pendientes en el doc (correlación sesión, timeout, UI de respuesta).
- ✔ **fix pensamiento partido** — commit en curso: materialize unía deltas de
  thought con "\n" → palabras partidas al terminar el turno. Concatenación
  simple + E2E (deltas == msg == materializado) — v0.0.18.
- ✔ v0.0.19: pensamientos como parts intercalados (vivo + caliente), Alt+Enter = Shift+Enter, etiqueta reasoning i18n, README→GPL-3.0. LÍMITE: session/load no reproduce thoughts (decisions.md). E2E: 2 bloques reasoning intercalados verificados (SSE + GET caliente); frío 0 (honesto).
- Server actual: launcher detached en :3100 (10 sesiones OK) + daemon ACP :3222.
- Nota ops: `npx tsc`/`next` con Permission denied en este contenedor → usar
  `node node_modules/typescript/bin/tsc`, `chmod +x node_modules/.bin/next` antes de build.

## Historial (compactado)
- Branch: `feature/copilot-web-poc` @ `9dc7378`
- ✔ **UX: tools visibles + razonamiento temprano** (commit `9dc7378`, E2E en verde):
  - Diagnóstico del reporte "saltos de línea perdidos": los datos Y el render están CORRECTOS (contenido `1\n2\n…10` en stream/store; remark-breaks convierte `\n`→`<br>` probado por SSR node). El fallo era PERCEPCIÓN: el modelo escribe los números pegados cuando planifica salidas intercaladas (store sesión 17 real: `**1****2**…**10**`) y los tool_calls eran INVISIBLES en la app Next (page.tsx los ignoraba: "silencioso en POC").
  - `/api/chat`: timeline de tools del turno (tool_call push por toolCallId; tool_call_update match por id, fallback último pending), passthrough SSE `event: tool` y persistencia `message.tools`.
  - `page.tsx`: estado live `toolSteps` por sesión; placeholder 'pendiente-turno' desde el PRIMER reasoning_delta (antes invisible hasta el primer texto), renombrado en message_start, reemplazado por el mensaje final.
  - `Chat.tsx`: chips de tool (ámbar pulsante pending / check verde completed) en la fila "running" y persistidos bajo cada mensaje; razonamiento auto-expandido mientras solo hay thought.
  - E2E curl: interleaved "A"/sleep 2/"B" → tool_call + updates + `tools` persistido; "1..10 una por línea" → contenido `\n` íntegro.
- ✔ **copilot-web (Next) MIGRADO a ACP** (commit `48c7406`, E2E suite completo en verde):
  - `src/lib/acp.ts`: cliente ACP-TCP singleton (dial con timeout + auto-spawn lazy de `copilot --acp --port ${ACP_PORT||3222}` detached, initialize, acpRequest, createAgentSession, session/load con replay guard (`agent.loading` por sessionId — mismo fix que la lite), subscribeUpdates por sessionId, isLoading, prompt con load lazy, cancelSession (notification), closeAgentSession). Errores de auth de session/new → 502 limpio.
  - `/api/chat` reescrito: ACP `session/prompt` + updates → SSE con el miso contrato (reasoning_delta/delta/message_start/message{usage,stopReason}/done). Adjuntos → `resource_link` file:// (dir temporal /tmp/copilot-web-att-*).
  - `/api/cancel` NUEVO: `session/cancel` nativa, botón stop en UI custom (icono ➤⇄■, botón rojo mientras corre).
  - `/api/sessions` y `/api/sessions/[id]`: crear/cerrar sesión AGENTE junto al store local. `src/lib/copilot.ts` (era JSONL spawn) borrado.
  - E2E (sesión b40fefe0): reasoning streaming, recuerdo "42" en misma sesión, adjunto leído REAL (clave X9K2-LL44), cancel trunca el turno y cierra el stream en ~15s, **la demo: kill del prod Next + restart + misma sesión → session/load replay y recall completo** ("42; evolución de los lenguajes de programación").
  - Quirks del server copilot ACP (cosméticos, anotados): cancel devuelve `stopReason: end_turn` (no "cancelled"); el reasoning sigue ~10s tras el cancel; el usage del turno cancelado reporta el del turno anterior (bug de reporting del agente).
  - NOTA migración: las sesiones históricas de la era JSONL (ids viejos) no son retomables por el agente (su contexto vivía en el proceso spawn por mensaje); muestran su historial persistido pero un chat nuevo por ellas dará error "not found" de session/load → crear sesión nueva.
- ✔ **POC lite rewired a ACP** (commit `240a8d4`, E2E suite verificado):
  - `acp-daemon.js`: daemon TCP :3222 ⇄ stdio de `copilot --acp` PERSISTENTE (las sesiones ACP viven en memoria del proceso agente; session/load solo funciona contra proceso vivo → daemon separado sobrevive reinicios del server).
  - `server.js`: cliente ACP completo (initialize/session/new/session/prompt/session/load/session/cancel), SSE con thought+message chunks, tool_call(_update), usage_update (tokens), cancel nativo, adjuntos como bloques ACP `resource_link` (URI file:// real → el agente los lee con su tool Read: verificado, hace "Viewing nota.txt" y devuelve el contenido exacto), auto-spawn del daemon, dial() race arreglada (clearTimeout al conectar; el timeout fijo destruía el socket a mitad del prompt).
  - `index.html`: botón stop, líneas de tool events, uso de tokens en cabecera.
  - E2E: tools (title+status), contexto tras reinicio del server vía session/load ("already loaded" cuenta como éxito y se marca como known), adjunto txt ACP, cancel a los 5s (133 eventos streamed, sin error). Sin env BYOK → session/new da error "Authentication required".
- ✔ **CORREGIDO tras evaluar la doc ACP con el usuario — `--port` SÍ funciona en 1.0.80** (commit `8a580fb`): el flag no sale en `--help` pero se acepta; `copilot --acp --port 3222` sirve NDJSON JSON-RPC por TCP verificado con probe. Arquitectura SIMPLIFICADA: eliminado `acp-daemon.js`; `server.js` spawnea el copilot ACP directamente (detached, lazy en el primer chat) y conecta por TCP. E2E: auto-spawn, round-trip, agente sobrevive reinicio del server, y recall COMPLETO del historial vía session/load (cita la primera pregunta literalmente).
  - Subtlety de protocolo descubierta: en modo TCP `session/load` REPLAYA el histórico como session/update (agent_message_chunk...) → si no se filtran, se mezclan con el turno activo. Fix: flag `agent.loading` → dispatchUpdate ignora updates durante el load.
  - Aprendizaje: `--help` de esta build no lista todos los flags; LA DOC oficial documenta `--port` (TCP mode). Re-chequear docs antes de asumir limitación de versión.
- ⏸️ PENDIENTE (bloqueado): prueba visual vía URL pública. El proxy `copilot-web/copilot-static/` devuelve 404 por parte de codepods.brunogrillo.dev; el backend local de la POC está sano (root 200, E2E ACP completo pasando). Sospecha: el proxy no enruta rutas de servicios no registrados en la MCP o cambia su mapping al reiniciar. Próximo paso: verificar el registro del servicio copilot-static con la MCP codepods.
- Branch: `feature/copilot-web-poc` @ `a58a1e2`
- **SALTOS DE LINEA arreglados**: `remark-breaks` en el markdown de respuestas (un `\n` simple se renderiza como salto, estilo chat). Commit `a58a1e2`.
- **Review kit Blazity/shadcn-chatbot-kit (MIT, gratis)**: hecho a mano replicando lo esencial. Integrarlo entero exige shadcn init + Vercel AI SDK (`useChat`) → refactor de todo el layer SSE. Aporta realmente: acciones por mensaje (copiar/valorar) y estados visuales de tool-execution. Decisión: cherry-pick de componentes individuales, no dependencia global. Pendiente de añadir: botón copiar en burbuja assistant.
- **SHADCN**: kit de referencia aplicado a mano con Tailwind (burbujas, sugerencias, reasoning colapsable, dark mode). NO es el kit real (template de pago). Acciones por mensaje aún no.
- **STREAMING REAL implementado**: el CLI emite `assistant.message_start` → `assistant.message_delta` → `assistant.message` (final) y `assistant.reasoning_delta`. Backend reenvía deltas por SSE; cliente actualiza burbuja en vivo + reasoning progresivo + cursor inicial. Persistencia solo del mensaje final (1 burbuja, sin duplicados). Verificado E2E con timestamps.
- DIAGNÓSTICO FINAL del 404: el proxy de CodePods STRIPPEA el prefijo público antes de llegar a Next. Config de deploy: sin basePath, `assetPrefix` con URL pública absoluta (prefija /_next/* en el HTML), `NEXT_PUBLIC_BASE_PATH` para los fetch del cliente, `trailingSlash: true`. Corriendo en PROD (`npm start`, no dev). Verificado local: raíz 200, assets hash 200, chat SSE PING-OK.
- Nota operación: NO pasar a prod con dev corriendo, NO buildear con dev arriba (CPU satura; .next corrompido). Un solo proceso, build limpio tras `rm -rf .next`.
- ASSET_PREFIX (`.env.local`, no versionado) usa la URL pública **https://** completa (evita mixed content sobre HTTPS). Rebuild necesario al cambiarlo.
- Pendiente: ~~confirmación visual~~ **CONFIRMADO por usuario**: la web pública carga con diseño y funcional. Siguientes candidatos (pendientes de decidir): acciones por mensaje (copiar/valorar), botón stop de turnos, merge a dev (requiere confirmación explícita). actual (branch: feature/copilot-web-poc)
- ✔ Saltos de línea arreglados con remark-breaks en ambas variantes UI (confirmado E2E: message final `HOLA\nMUNDO`).
- ✔ Kit Blazity shadcn-chatbot-kit (MIT) evaluado e integrado como VARIANTE conmutable:
  - Deps: cva, framer-motion, remeda, radix (collapsible/slot/toast), shiki, sonner.
  - Componentes en `src/components/kit/*` con imports re-cableados; `cn()` en `src/lib/utils.ts`.
  - `KitChat.tsx` compone Chat + Toaster + toast de feedback POC; mapeo de mensajes con `parts` (reasoning/text).
  - Toggle "UI custom"/"UI kit" bottom-right en page.tsx, persiste en localStorage (`uiVariant`).
  - Cosmético pendiente: clases shiki sin CSS (bloques de código sin colores; aceptable en POC).
  - Commit `6c139e4` (build limpio ~21s, prod arriba, E2E SSE OK). Pendiente prueba visual del toggle por el usuario. branch actual: feature/copilot-web-poc
- ✔ Feedback usuario variante kit: salía "muy ancha y sin límite de alto". Copiado el encaje de la demo del repo (`apps/www/app/demo/page.tsx`): wrapper centrado `max-w-3xl` `h-full` dentro de flex-1 y Chat `className="grow"`. Commit `529a764`.
- ✔ Adjuntos funcionales (commit `529a764`, E2E 200): el kit expone FileList por `handleSubmit({experimental_attachments})`; KitChat base64 → `/api/chat` guarda en tmp → imágenes/documentos nativos como `--attachment` del CLI (solo soporta image/native doc; verificado PNG), texto/código inline en el prompt con fence. Guard: 8 ficheros, 5 MB, tmp borrado al cerrar/abortar. Nota 📎 en el user msg (display).
- 🔜 Pendiente: botón stop/interrupt (ACP nativo), colores shiki, prueba visual usuario (sizing + adjuntos), merge a dev tras confirmación.
- ✔ UI custom mejorada (commit `79e9f61`... `79f9e61`): fecha/hora en ambas burbujas (HH:MM hoy, "20 oct 14:23" si no), botón copiar con feedback, botón adjuntar 📎 con chips (máx 8, 5 MB) — mismo híbrido que el kit. Prefiere esta UI: **el kit se CONSERVA para comparar** (se eliminará más adelante).
- ✔ Razonamiento PERSISTIDO (mismo commit): buffer en route.ts (deltas + evento final autoritativo), guardado en la sesión y enviado en el mensaje final SSE. E2E: 735 chars recuperados al recargar. También en la POC lite.
- 📌 Cliente 100% (sin back) descartado con evidencia: preflight OPTIONS del endpoint BYOK devuelve 204 SIN Access-Control-Allow-Origin (fetch del navegador bloqueado) y el navegador no puede spawn/stdio del CLI. → la capa mínima viable es un server pequeño + página estática (POC lite, abajo).
- ✔ POC 2 "lite" (commit `a24d7d1`): `static-poc/` Node puro SIN framework (sirve index.html + /api/sessions CRUD + /api/chat SSE con el MISMO contrato que la app Next, adjuntos incluidos). `copilot --acp` queda para v2 (stop nativo, proceso persistente). E2E humo OK: txt adjunto inline → respuesta correcta; razonamiento streaming + persistido; sesión humo borrada. Publicado: **copilot-static** puerto 3200.
  http://codepods.brunogrillo.dev/api/proxy/copilot-web/copilot-static/ (el cliente deriva la base del fetch de location.pathname → sirve local y vía proxy).
- 📌 Evaluado ACP (`copilot --acp`, stdio o TCP): protocolo estándar agente↔cliente (Zed/JetBrains), usos: IDE, CI/CD, **frontends propios** (nuestro caso), multi-agente. Valor futuro: proceso persistente por sesión (no spawn por mensaje), cancelación nativa (session/cancel), eventos estructurados (tool_call, diffs, plan), permisos como protocolo, UI desacoplada del agente (cualquier cliente ACP). Decisión: v2 si se quiere stop/natividad; el puente JSONL actual funciona.
- ✔ Scaffold completo en `copilot-web/` (Next.js 15 + Tailwind v4, style shadcn).
- ✔ Backend: `/api/sessions` CRUD, `/api/chat` SSE spawn `copilot -p --session-id --output-format json -s`.
- ✔ Auth BYOK resuelta: vars del agente → `copilot-web/.env.local` (git-ignored); Next las carga.
- ✔ E2E verificado por curl: streaming, tool events, contexto persistente entre turnos, done dedup.
- ✔ Publicado en CodePods: servicio `copilot-web` puerto 3100.
  http://codepods.brunogrillo.dev/api/proxy/copilot-web/copilot-web/
- ✔ basePath aplicado (confirmado por usuario): `.env.local` APP_BASE_PATH +
  NEXT_PUBLIC_BASE_PATH, fetch del cliente usa apiUrl(). Assets y chat verificados
  vía ruta prefijada local.
- ⏳ Pendiente: check visual del usuario y merge a dev tras confirmar POC OK.

## Notas de trabajo
- El CLI web no hereda credentials (runtime filtra env); BYOK vive en .env.local.
- Una ejecución simultánea por sesión (HTTP 429 si duplicada).
- Servidor dev corriendo detached: `npm run dev` (log: /tmp/next-dev.log).- ✔ Partes ordenadas (commit `25f4f4c`): sonda JSON-RPC directa (TCP :3222) confirma que ACP NO delimita tramos de texto — solo los tool_call marcan frontera, y hay 2ª tanda de thoughts tras cada tool. Modelo nuevo: MessagePart[] (text|tool) en orden de llegada en el SSE 'message' + store; la UI renderiza burbuja/chip alternados, razonamiento único arriba abierto durante todo el turno (acumula también los thoughts pos-tool). Mensajes legacy sin parts → fallback visual anterior. E2E: parts [A, tool, B] en vivo y persistidas; "1..5 por líneas" íntegro ('1\n2\n3\n4\n5', 1 part).
- ✔ Confirmado por el usuario (21 oct): el efecto interleaved funciona ("mejor ahora!") — burbujas/chips intercalados + razonamiento visible y persistente durante el turno.
- ✔ Conciliación con el store del CLI (commit `6b9c2ec`): `~/.copilot/session-store.db` (API no oficial, solo-lectura vía node:sqlite, WAL) expone TODAS las sesiones del cwd, incluidas las del daemon ACP y las de CLI interactivo; la tabla `turns` trae user/assistant completos (⚠ lag de escritura: no aparece el turno hasta flush posterior del CLI). `reconcile()` en GET /api/sessions y [id]: materializa las desconocidas (origin recovered) + histórico best-effort, nunca machaca las nuestras; borrado de recuperadas con tombstone (`.data/deleted.json`). La UI ordena por última actividad (updatedAt/último ts/createdAt) y abre la última activa al entrar (localStorage lastSession). E2E: 21+32 materializadas, revive de sesión pre-ACP via session/load (inputTokens 15k = contexto restaurado), DELETE no resucita. El contexto real de una revivida lo restaura el propio agente aunque el histórico importado venga incompleto.
- ✔ Sin materializar contenido (commit `240c408`): el histórico ya NO se duplica en sessions.json. `store.ts` SOLO METADATOS (nombre/fechas/origen/orden) con migración one-shot (backup en `.data/sessions-content-backup.json`); `touch()` sube la sesión al terminar cada prompt. Fuente de contenido = `~/.copilot/session-state/<id>/events.jsonl` del CLI (append en vivo, escrito por el binario en TODOS los modos) parseado bajo demanda por `lib/eventsLog.ts` → burbujas con partes ordenadas fusionadas por interactionId (mismo modelo que el modo live; los chips de tools se marcan completed/error correlacionando toolCallId, aunque el start llegue con iid null y la burbuja ya emitida). Fallback a turns del DB cuando no hay events.jsonl. API: GET /api/sessions meta-only ordenado server por updatedAt (refrescado contra el store del CLI en cada reconcile → actividad fuera de ACP arriba); GET /api/sessions/:id hidrata el contenido; chat/route.ts ya no persiste mensajes (SSE alimenta el UI; convergencia con re-hidratación al terminar el turno). E2E: 54 sesiones meta-only; 4982da09 muestra el turno que `turns` pierde; 32/32 parqués parsean sin fallo; ciclo fresco completo (crear→prompt→parse→top del list); delete no resucita; rename meta (no toca updatedAt); backup creado (177KB → 11KB).
- 📌 Rename al CLI: `/rename` es interactivo; `--name` solo al crear con `-p`; no hay subcomando offline → el nombre custom sigue en NUESTROS metadatos (barato); los nombres del CLI (--name) fluyen como `name` de las recuperadas vía `sessions.summary`.
- ✔ Deep-link de sesión (commit pendiente de push): `?s=<session-id>` en la URL; la página lo lee al cargar (prioridad sobre lastSession) y sincroniza la URL con replaceState al cambiar de sesión. Elegido sobre `/sessions/[id]`: no pelea con el prefijo público del proxy.
- ✔ Reinicio del contenedor verificado: build completo, servicios 3100/3200/3222 arriba, E2E fresco OK. Nota ops: el daemon ACP necesita el entorno BYOK (`source copilot-web/.env.local` antes de `copilot --acp --port 3222`) — tras un restart no hereda credenciales.
- ✔ Mobile usable (commit `2d5fff8`): Sidebar como drawer en <md con hamburger en el header del chat (backdrop + cierre al seleccionar/crear), composer táctil (paddings reduced en px-4, textarea 16px en mobile para evitar zoom iOS, envío con <form>), botones flotantes subidos sobre el composer. Desktop intacto.
- 📌 Hallazgo: misma sesión abierta en CLI + web → el prompt del web se queda SIN respuesta mientras el CLI conduce la sesión (bloqueo per-driver copilot-side, ya visto en el "caso duro"). Mitigación en el web (mismo commit): al pulsar stop, si el agente no responde al cancel en 1.5s se aborta el SSE → el finally libera el estado y la re-hidratación converge con el parseo real del events.jsonl. Recomendación: una sesión, un driver a la vez.
- ✔ Feedback mobile (commit siguiente): toggles MOVIDOS al footer del sidebar; Sidebar deja de reordenar por createdAt (bug cliente vs server); lag del textarea fijado con memo (re-render de markdown por tecla). Hallazgo importante del flujo colgao: el mensaje escrito en la web cuando el CLI estaba en turno LLEGÓ a la cola del CLI y se entregó al fin del turno — copilot encola por sesión; el guard en el web (20s sin 1er chunk → error + cancel) hace el bloqueo visible e inmediato.
- 📌 Topología del bloqueo (21 oct 22:06): los prompts web sobre una sesión CON CLI activo no los sirve el daemon: los REENVIA al CLI (llegan como user turn del driver; por eso el web "cuelga" hasta que el CLI termina turno). Verificado: inuse.1265.lock (daemon) + inuse.3623.lock (CLI) simultáneos sobre 66c720b0. Si el CLI se cierra con lock vivo, el daemon puede quedarse esperando. Mitigaciones: guard 20s (feedback) + `/workspace/restart-acp-daemon.sh` (daemon owner limpio, sirve la web directamente sin CLI).
- Permisos interactivos en web (f0a1325): `session/request_permission` ya se pinta (card Permitir/Denegar sobre el composer + auto-permiso a 8s). FIX importante: la respuesta ACP correcta es `{outcome:{outcome:"selected",optionId}}` con el optionId REAL de params.options; la forma previa `{outcome:{choice:"allow_once"}}` era aceptada por ACP pero interpretada por copilot como **denied-interactively-by-user** (los turnos "colgados" = permiso denegado implícito). E2E OK con kind write (create) y shell (bash): permission.requested→approved→tool success.
- Anti-flash: anclaje de scroll pre-paint (useLayoutEffect) al abrir sesión + ventana de render de 40 msgs con "cargar anteriores" (ancla posición). Razonamiento en vivo: auto-scroll interno.
- "Colgado" del rm explicado (22 oct): el permiso SÍ llegó (mismo kind shell) pero se resolvió `cancelled: Session aborted` — el stream web se cortó (reload/navegación/stop-abort) y el abort enviaba session/cancel matando el turno mid-permiso. FIX: el abort del stream ya NO cancela; el turno sigue en el daemon y converge en events.jsonl. E2E: stream cortado a 4s → turno completo + fichero creado + running liberado (nuevo prompt 200).
- Fallback de permisos = APROBADO (22 oct): (a) auto-permiso a 8s ya era allow; (b) NUEVO approveAllForSession: permisos pendientes se conceden si el stream muere (reload/abort) en vez de quedar huérfanos ("Session aborted" callado). TODO en código: quitar el hack cuando ACP dé política estable.
- Hallazgos de protocolo ACP (22 oct, verificados contra daemon 1.0.80):
  - `available_commands_update` llega tras session/new Y tras prompts (snapshot completo, no incremental): 32 comandos con name/description/input.hint.
  - Los slash se invocan como texto en `session/prompt` (ej. `/session info`, `/usage`); comandos informativos NO invocan el modelo. Los UI-only (diff/resume/theme/settings...) NO están en el snapshot y se reenvían al modelo como pregunta normal.
  - `session/list` no subcomando: `/session list` imprime la ayuda de uso. `/rename <name>` y `/session delete <id> --yes` SÍ funcionan vía prompt: renombre se PROPAGA al title oficial de session/list; el delete borra de verdad (y si es la sesión actual lo gestiona el host CLI).
  - Regla de visibilidad: las sesiones SIN turno de modelo NO aparecen en session/list (ni tras /rename o /usage); el title de una listable puede reflejar su último prompt (caso /theme).
- ✔ Paleta de comandos slash en la web (commit `e79b82b`): cache server-side por sessionId (acp.ts, globalThis) del snapshot; GET /api/commands/[id] (seed en session/new y al abrir sesión) + forward SSE `commands` en vivo; paleta en el composer de la variante custom (filtro por prefijo, ↑/↓/Tab/Esc, Enter completa, envío tal cual del texto). E2E: 32 comandos cacheados; `/usage` ejecutado sin modelo ("Requests: 0 Premium") con histórico bien parseado. Pendiente: paleta en variante kit, decisión de cero-materialización (replaces sqlite).
- ✔ Chips expandibles con salida + denegado en rojo (commit `bd8edbe`): `tool_call` trae `rawInput` en el stream ACP (→ chip vivo con `$ <command>`), `tool_call_update` NO trae rawOutput en 1.0.80 — la SALIDA completa vive en events.jsonl (`tool.execution_complete.data.result.content`): chip `<details>` expandible al rehidratar. Permission chips hidratados (permission.requested/completed con fullCommandText). Denegar = tool real en ROJO "(denegado)" (vía toolCallId en permission_request/resolved ahora reenviado) + chip de permiso en rojo; NO queda en ámbar y el chat muestra el chip. E2E: echo (chip + salida hidratada) y Create file denegado en vivo (rojo, no colgado). Sesiones E2E borradas vía `/session delete <id> --yes`.
- ⏳ PENDIENTE de decidir: cero-materialización (list=session/list; PATCH=prompt /rename; DELETE=prompt /session delete; meta mínimo {id,createdAt,title-ish} para crearlas; quitar sqlite/copilotStore legacy).
- ✔ FIX "el comando sale y se quita" (VERIFICADO) (commit `82efde6`): reproducido — los slash INFORMATIVOS sin modelo (/usage, /session info...) NO escriben events.jsonl (ni session.db) en 1.0.80: la burbuja vivía solo durante el turno y moría al rehidratar (messages:[] en GET). Fix minimal-invasivo: `lib/webTurns.ts` apunta turnos de la web en ~/.copilot-web/turns/<id>.jsonl (recordTurn en chat/route.ts al fin del turno, user+assistant, mismo modelo ChatMessage); hidratación de [id]/route.ts fusiona events ?? webTurns (dedupe por role+content contra events) con fallback turnsFor; DELETE borra el fichero. E2E: /usage persiste tras recarga; echo no duplica. Compatible con cero-materialización (solo turnos que el CLI no registra).
- ✔ Limpieza (commit `7c689cc`): fuera `static-poc/` y variante kit (KitChat.tsx + components/kit/ + botón de alternar del footer; page.tsx solo custom). Fix UI pendiente de build anterior: botón "..." de sesión SIEMPRE visible (opacity-0 group-hover moría en táctil) + cursor-pointer en botones (nueva sesión, cerrar drawer, "...", ítems de menú, toggle oscuro). Pendiente: quitar deps huérfanas del package.json (radix, framer-motion, cva, remeda...) cuando toque.
- ✔ Chips tipo TERMINAL + intercalado real + salida completa (commit `8787e84`): ToolChips rediseñado como bloque mono (header `$ comando` con estado; salida en <details> expandible `max-h-44`), mensajes de usuario que empiezan por "/" se pintan como línea terminal `❯ cmd` (no burbuja).eventsLog unifica detail: `toolRequests` prellena el chip con `$ cmd`, execution_start completa el chip ya creado, execution_complete PRESERVA `$ cmd\n\n<out>`, tail `<shellId:…>` del CLI se limpia (`cleanToolOut`). chat/route live: updates vivos preservan el comando; al cerrar el turno extrae la salida real de events.jsonl (`toolOutputById`) porque el stream no trae rawOutput en 1.0.80 (turno "mudo" en vivo ahora también acaba con salida). E2E: echo vivo (detail `$ cmd\n\nout`), /session info, hidratación x4 turnos con orden intercalado OK. Sesión demo renombrada "Demo chips terminal (borrable)".
- ✔ OPS contenedor (tras 3.º reinicio): causa del agotamiento = commits git nativos del CONTENEDOR (uid 55917) dejaron `.git/objects/xx` chowneados → el git del shim corre en el HOST como ubuntu y no puede escribir árboles ("insufficient permission"); + pids del cgroup (~256) con daemon ACP (2 procs) + next-server (2) + build (workers). Fix y reglas en decisions.md (OPS-03).
- ⏳ Pendiente: check visual del usuario (chips terminal) y merge a dev tras confirmar POC OK.
- ✔ Régimen post-reinicio #4 (commit `10a8dbf`): (a) paleta slash moría al reiniciar el SERVIDOR WEB (cache in-memory sin bootstrap) → `ensureCommands()`: una `session/new` desechable repuebla el snapshot al primer GET vacío (sessions sin turnos no ensucian session/list); (b) "..." invisible en touch/viewport md+: Tailwind v4 envuelve group-hover en `@media(hover:hover)` → añadido `[@media(hover:none)]:opacity-100`; (c) OPS crítico descubierto: el daemon ACP reiniciado SIN credenciales (`Authentication required` en session/new) — el `source .env.local` NO exporta vars (asignement plano) → exportar con `set -a; source copilot-web/.env.local; set +a` y después `copilot --acp...`. E2E: daemon autenticado (32 cmds), paleta API 32, chat turn "daemon-ok-1".
- ⏳ Pendiente: check visual del usuario (chips terminal) y merge a dev tras confirmar POC OK.
- ✔ Fixes UI #5 (commit `a332dbf`→`a332b32`): (a) "..." SIEMPRE visible era exceso del `[@media(hover:none)]` (dispositivos híbridos/touch emulación lo casan a viewport md+) → regla final: variante arbitraria `[.group:hover_&]:opacity-100` SIN media-gate (Tailwind v4 envuelve el builtin group-hover en `@media(hover:hover)`) + focus-visible + max-md + menú abierto; verificado el selector sin wrapper en el CSS build; (b) paleta vacía en la ENTRADA inicial/refresh: loadCommands solo corría en selectSession/createSession (click), no en el arranque con lastSession/deep-link → ahora corre en el efecto de activeId. E2E: primer GET tras rebuild devuelve 32 cmds (probe ensureCommands).
- ⏳ Pendiente: check visual del usuario y merge a dev tras confirmar POC OK.
- ✔ Triple fix "materialización" (commit `2e295ac`), repro en sesión `1a2da738` (7→6 mensajes): (1) DUPLICADO de turnos de modelo: la vista live (webTurns) vs events.jsonl difieren en contenido (el CLI no persiste chunks intermedios tipo "Info: ..." entre tools) → dedupe exacto fallaba; ahora dedupe por SOLAPAMIENTO de contenido (≥40 chars, un contenido contiene al otro, gana el más largo); (2) slash al FINAL del todo: los extras de webTurns se concatenaban al final → merge ORDENADO por ts (los eventos del CLI y los records web usan ISO-Z comparables, tie-break por índice) → /allow-all off aparece en su posición cronológica aunque lleguen turnos nuevos; (3) la respuesta del comando como mensaje de chat: CommandBlock pliega user-slash + siguiente assistant (si es solo texto, sin tools) en un bloque ❯ cmd mono con "salida" expandible; LiveBlock con LiveTurn.userPrompt pinta la salida del streaming como continuación del bloque.
- ⏳ Pendiente: check visual del usuario y merge a dev tras confirmar POC OK.
- ✔ Triple fix render del chat #6 (`permisochips`): (1) la burbuja DUPLICADA del output del comando era un bug de render: el set `folded` controlaba lo que CommandBlock recibía como `out` pero el mensaje plegado SEGUÍA renderizándose en la rama else → ahora `folded.has(m.id)` → skip; (2) CommandBlock reestilizado como acordeón idéntico a ToolChips (mismo details/summary/chevron/paddings, sin etiqueta "salida"); (3) permisos = META del chip del tool real (events.jsonl trae toolCallId en permission.requested/completed): ya no se crea el chip duplicado "permiso · ..." cuando existe tool real; denegado → aspa roja + "(denegado)" en el título del chip; permisos sin tool propio (comandos/urls) conservan chip propio; (4) cajón de sastre: nuevo part kind "system" (línea meta mono dim) — eventsLog pinta `session.compaction_start/complete` (⚙ compactando historial (105.5k / 128k tokens)… / ⚙ historial compactado) y `system.message` cortos (≤240 chars, excluido el prompt de sistema); AssistantMessage/LiveBlock renderizan SystemLine. Probe sintético + E2E real OK (sesión 1a2da738 sin chip duplicado; /usage vivo OK).
- ⏳ Pendiente: check visual del usuario (acordeón de comandos, meta de permisos, SYS lines) y merge a dev tras confirmar POC OK.
- ⏳ FIX #7 burbujas user (commit `bc840b2`): reporte "mis burbujas salen como del agente" — al reescribir el map del IIFE en el fix #6 (`2e295ac`) se perdió la rama `MemoUserBubble` y los mensajes normales de usuario caían al render de AssistantMessage. Restaurado: `role==="user"` → burbuja, `/cmd` → CommandBlock (output pllegado = siguiente), else → AssistantMessage. Web reconstruida en :3100. Pendiente check visual + merge a dev.
- ✔ FIX #12 turno zombi observable (commit pendiente): "al refrescar la pantalla el permiso se desengancha: autorizas/deniegas pero no llegan updates hasta re-refrescar". Causa: tras el reload la web no tenía NI stream NI polling del turno que seguía vivo en el daemon; `running` (server) no se exponía. Fix: (1) acp.ts exporta `runningTurns` (Set en globalThis, compartido por chat POST y GET); (2) GET /api/sessions/[id] añade `running` al session payload; (3) page.tsx `startPoll(id)` — sondeo 1.5 s mientras `running`, actualiza messages/stickyPerms en cada tick y al ver idle dispara `retryAfterPoll` (la cola de mensajes del 429 se reenvía cuando el turno de verdad termina, no a los 3 s a ciegas); hydrateDetail arranca el sondeo si GET trae running, y respondPermission lo arranca al resolver una card STICKY (la LIVE la sigue cubriendo el stream); (4) Chat.tsx: la card sticky también se pinta en el estado running-sin-permisos-live (ventana de sondeo). E2E: refresh-sim → GET {running:true, pending} → deny → t+2 running:false + pending null + turno denegado materializado (tool + system ⚙).
- ✔ FIX #11 sin fallback de permisos (commit `f23fc21`, E2E en verde): "no quiero autodeny ni fallback, es un tema delicado". Eliminada TODA resolución automática de permisos (regla en decisions.md): (1) acp.ts fuera `approveAllForSession` (auto-aprobaba si el stream moría) → nueva `pendingPermissionFor(sessionId)` sin efectos; caso sin reqId (<0) → noop deliberado; PendingPerm guarda title. (2) chat/route.ts: finish() sin fallback + POST /api/chat en busy → 429 {busy:true, pending}. (3) sessions/[id] GET → campo `pending` en la sesión. (4) web: Chat.tsx cards usan `permCards` (live o sticky) con texto "el turno queda en pausa hasta tu respuesta" (fuera el "se concede automáticamente…" caduco); page.tsx: state stickyPerms + retryRef + hydrateDetail lee pending (limpia/pon card) + send(targetId) maneja 429 busy (remueve burbuja local — el mensaje no se entregó — guarda cola de reintento; reintento silencioso tope 3 si busy sin pending) y send con éxito limpia la cola; respondPermission al resolver limpia sticky por reqId y reenvía el mensaje en cola a los 3 s.
- ✔ FIX #10 sin auto-permiso + fin del chip transitorio (commit `1443930`, E2E en verde): "quita la autorización automática tras n segundos" + "el chip de Permiso denegado aparece unos segundos y desaparece". Cambios: (1) acp.ts sin timer de 8 s — el permiso pende indefinidamente hasta respuesta (fallback approveAllForSession solo si el stream muere); (2) permission_request con toolCallId NO crea chip "permiso ·" propio (era la causa del chip transitorio: existía solo en los parts del turno vivo y moría al hidratar) — meta del chip del tool (deniable set); permission_resolved marca el tool real "(denegado)"/error y tool_call_update failed cierra el heal; (3) turno denegado sin texto: system "⚙ permiso rechazado — no hubo respuesta del agente", también en hidratación (eventsLog denied flag en flush) → paridad live/events verificada E2E: deny a +35 s → live [tool (denegado) error + system ⚙] y GET idéntico; allow a +12 s completó tool+respuesta+fichero; 9024e15a esperó >5 min sin resolverse (timer fuera). (4) Regla global cursor pointer para botones/links/summary (globals.css) + regla en decisions.md. Quirk nuevo: SSE con python http.client no entrega eventos (bloqueo indefinido) — E2E de streams por curl --http1.1; los reqId para POST /api/permission son {reqId:number, allow:bool}.
- ✔ FIX #9 denegación (commit `618e9ea`, E2E en verde): reporte en sesión 363fc43e (rechazar permiso → chips ámbar, permiso como chip colgado, "(sin respuesta…)" y burbuja del agente duplicada). Diagnóstico con E2E limpio (sesión d17a4e87): el daemon manda tool_call_update status "failed" DESPUÉS de la resolución sintética y updateToolPart sobreescribía el "error"→"failed" (ámbar); el registro webTurns del turno guardaba chips sin marcar + placeholder como texto (duplicado con el mensaje vacío de events). Fix: (1) updateToolPart failed≡error y error sticky; (2) tool_call_update failed con chip perm- pendiente hermano → cierra ambos (permiso denegado + "(denegado)") — curación para el caso en que la resolución synthetic no aplicó; (3) turno sin texto y con chips → system line "⚙ permiso rechazado — no hubo respuesta del agente" (sin burbuja placeholder; placeholder clásico solo si no hay tools); (4) merge de hidratación descarta el record placeholder si events tiene el mensaje vacío del turno; (5) ToolChips pinta "failed" en rojo. Verificado: E2E deny → 3 parts correctas + content ''; hidratación 2 mensajes; sesión 363fc43e → 10 mensajes sin duplicado. Pendiente check visual + merge a dev.
- ⏳ FIXES #8 (adjuntos + reasoning): (1) DUPLICADO de mensaje user con adjunto (sesión 0a41c50c): el CLI anota los adjuntos en events.jsonl como `[Resource link: file://…]` y la web grababa el texto plano en webTurns con ts de fin de turno — el dedupe ≤40 chars no casaba (14 chars) y la copia web caía tras la respuesta. Merge de [id]/route.ts: contención sin mínimo cuando la copia de events lleva anotación (gana events), ≥40 guard para el caso "la web es más rica" y para assistant; verificado 3→2 mensajes. (2) UserBubble parsea `[Resource link: …]` → chip 📎 + nombre de fichero (sin link funcional). (3) Reasoning restilizado como los chips de tool: 🧠 a la izquierda, chevron ml-auto a la derecha, mono/summary/paddings idénticos. Pendiente check visual + merge a dev.
- ✔ CERO-materialización ACP (aprobado por el usuario: "capa que traduce, no añade features", "Sí a todo" a la limpieza): FUERA webTurns, eventsLog, tombstones, turnsFor, recordTurn y parse de events.jsonl (~/.copilot NO se toca nunca — regla del usuario). Fuente única: sessionLog en RAM (replay session/load + updates en vivo + user_message_chunk sintético del chat) → materialize(AcpUpdate[]) → ChatMessage[]. DELETE/PATCH ya no simulan: (1) DELETE → closeAgentSession + inyección `/session delete <id> --yes` a la sesión ops + verificación de AUSENCIA en session/list (si falla → 502 y la sesión sobrevive honestamente); (2) PATCH → inyección `/session rename <name>` a la sesión objetivo + verificación en session/list (fallo → 502, reversión). 0-turn → gestión local justificada (el CLI no lista lo que no tiene turnos). Errores de fondo VISIBLES en la UI (banner + reversión del optimismo), requisito literal del usuario. E2E completo `.e2e-final.py` RESULT: TODOS OK (turno bash+permiso, materializado caliente con burbuja usuario única + chip completado con salida, idempotente, rename, delete, 0-turns). Quirks: builds Next fallan por pids de cgroup → `experimental.cpus: 1` en next.config (build verde estable); server `trailingSlash:true` → POSTs con slash final (308 sin él); el daemon no ecoa user_message_chunk en vivo → acp.prompt(sessionId, blocks, userText) lo registra sintético (el replay nunca duplica porque loadSession limpia el log). GET de sesión vieja sin caché verificada (replay session/load materializa user+chips+system).
- ⏳ Pendiente: check visual del usuario + merge a dev tras confirmar POC OK.
- ✔ Limpieza de datos (aprobada por el usuario): FUERA fallback sqlite del CLI (reconcileDb/DatabaseSync en copilotStore — solo session/list del daemon; si cae, seguimos con lo conocido) y FUERA sessions-content-backup.json (+ migración one-shot en store). .data queda SOLO con sessions.json: metadatos mínimos imprescindibles = 0-turn (CLI no las lista), renamed, origin, orden. Build verde + verificación: 53 sesiones, replay frío OK, 32 cmds.
- ⏳ Pendiente: check visual del usuario + merge a dev tras confirmar POC OK.
- ✔ Sin sessions.yaml ni fichero de lista: sessions.json ELIMINADO (aprobado por el usuario). La lista = session/list del CLI (al vuelo, ya viene ordenada por actividad — verificado 50 sesiones exact desc) + overlay RAM para 0-turn (store.ts: sólo {id,name,createdAt}); al primer turno el CLI manda y el overlay deja de aportar. Títulos SIEMPRE del CLI: fuera de SessionSummary origin/renamed; rename con turnos = CLI + verificación (sin escritura local); rename 0-turn = overlay RAM. .data/ desaparecido. E2E: crear 0-turn visible, rename 0-turn, primer prompt (pasa a CLI), materializado (1 burbuja, chip con salida), rename CLI adoptado, delete fuera — TODO OK.
- ✔ Limpieza de sesiones CLI (petición explícita): DELETE por API en bucles con listado fresco + protección explícita de 66c720b0-2ef9-… → 74 sesiones borradas, quedan EXACTAS 10 (las más recientes), lista estable en relecturas. Nota: en la 1ª pasada masiva session/list devolvió una lista intermedia anómala (45 tras 40 deletes verificados); reiterando el barrido convergió y se mantuvo en 10 (comportamiento eventual-consistente del daemon; sin tombstones locales).
- ✔ Spinner en apertura + horas solo-en-viva (v0.0.15): al clicar sesión, spinner "cargando sesión…" (Loader2) en el área del chat hasta que el GET hidrata (fin del flash de landing de "sesión nueva"); el estado vacío solo se pinta con GET confirmado. Sellado de hora de llegada (ts, ISO) SOLO en updates en vivo del sessionLog (replay frío no sella — ACP no lo da, verificado contra daemon: session/update sin claves temporales) y materialize lo propaga a user/assistant; UI oculta la fila de hora cuando no hay ts (fin del "· " huérfano tras copiar). Reconciliación sin reinicio existe: GET de sesión no cacheada = session/load replay (sin ts).
- ✔ Móvil h-dvh (v0.0.16): shell `h-dvh` (antes h-screen = viewport grande de Android Chrome → recorte por la barra de dirección) + meta `interactive-widget=resizes-content` (el teclado encoge el layout, composer nunca tapado). tsc+build verde, meta y clase verificadas en el HTML/CSS compilado.
- ✔ MERGE A DEV (confirmado por el usuario): dev creada desde main → merge --no-ff de feature/copilot-web-poc (v0.0.1–v0.0.16) → push. La POC queda integrada; seguimos trabajando en feature/*.
- ✔ PRINCIPIO 0 añadido a decisions.md: "Zero-materialized data — copilot ACP data is the only truth" (nada persistido en la web; solo caches RAM reconstruibles; sin leer ficheros del CLI; lo que no está en el canal ACP no se inventa).
- ⏳ Pendiente: check visual del usuario + merge a dev tras confirmar POC OK.

### Lote 6.2 (v0.0.24) — opciones de permiso del agente (feature/mcp-helper)
- Pregunta del usuario: "cuando tenemos que aprobar permisos, ¿no hay aceptar
  siempre / rechazar siempre?" + layout propuesto (frase arriba; 4 botones en
  línea, rechazar izq / permitir dcha) + ¿se puede whitelist-ear ask_user?
- ✔ Probe crudo contra el daemon (scripts /tmp/acp-req-probe.mjs +
  /tmp/acp-same-probe.mjs, cliente NDJSON): copilot envía 3 kinds reales
  (allow_once, allow_always, reject_once; reject_always definido en la spec
  pero no enviado para bash). allow_always: MISMO comando exacto no re-pregunta;
  comando distinto sí (memoria del CLI/daemon; la web no persiste nada).
- ✔ types.ts: `PermissionOption` + `options?` en `PermissionReq`.
- ✔ acp.ts: parsea options crudas → `pendingPerms` + SSE/429/sessionLog las
  incluyen; `respondPermission(reqId, boolean|string)` valida optionId contra
  las opciones vivas (invalid → 400; caducada → 404).
- ✔ api/permission: acepta `{reqId, optionId}` o `{reqId, allow}`.
- ✔ Chat.tsx: card con opciones reales (por kind, labels i18n, rechazar izq
  rojo / permitir dcha verde, frases arriba + botones debajo en línea);
  fallback deny/allow si options vacía.
- ✔ Launcher mcp: `--allow-tool "copilot-web-helper(ask_user)"` (fresh daemon).
- ✔ E2E real: options llegan por SSE; allow_always → T2 mismo comando SIN
  permiso; reject_once → tool denegada + re-pregunta en T4 (no memoriza);
  invalid → 400; allow_once → ejecuta.
- ✔ E2E helper sin permiso: ask_user → card de pregunta en web + respuesta
  fluye; CERO permiso del CLI.
- Pendiente: commit+push, sync a poc (general sin flag del helper), review
  usuario, cleanup /tmp probes.

### Lote 6 (v0.0.23) — permisos reales + UX de decisión + scroll (feature/mcp-helper)
- ✔ Daemon SIN allow-all por defecto (launcher + acp.ts): `--copilot-args` opt-in; verificado E2E real — mensaje sin flags → evento SSE `permission` (reqId:0, "Create file"), POST /api/permission allow:true → tool ejecutada + end_turn/done + fichero creado; reqId desconocido → 404 limpio, body inválido → 400.
- ✔ Stale perms (allow "no funcionaba"): respondPermission maneja 404 → retira card, limpia sticky, muestra err.permStale (i18n es/en) en vez de silencio.
- ✔ Deny en rojo (destructive) en cards de permiso.
- ✔ HelperAskCard: input + send siempre visibles (disabled sin texto), opciones vertical encima, sin toggle "Other".
- ✔ Status bar SIEMPRE visible (fuera del !cardsActive; bottomRef envuelve también el composer para el ResizeObserver).
- ✔ Scroll pegado con ResizeObserver (umbral 100px, onScroll→markPinned, instantáneo no smooth); cardsActive movida arriba (evitado TDZ en deps del efecto).
- ✔ README (tabla de opciones + nota de permisos) y design.md actualizados; changelog v0.0.23.
- Pendiente: tsc/build ya verdes; sync de items generales a feature/copilot-web-poc (v0.0.20.3); commit+push.
- ✔ Fix footer (v0.0.23.1): reuse de daemon perdía "Model: xxx" (opts.model="" en reuse) → readDaemonModel lee COPILOT_MODEL del env real del daemon vivo; verificado en status route (model:"default" restaurado).

### Pendiente (idea 23/10): memoria especial allow_always para shell
La memoria allow_always del daemon para comandos es por comando ENTERO exacto
(en CLI TUI el "aprobar siempre" parece tener más alcance). Por eso rm sobre
ficheros distintos re-pregunta cada vez. Idea: que el puente, al elegir
allow_always en un permiso kind=shell, memorice en RAM (PRINCIPIO 0) un
prefijo/token del comando y auto-respondiese allow_always en futuras
request_permission coincidentes sin card. Diseñar alcance y UX antes.

### Lote 8-13 (v0.0.25.4, feature/mcp-helper) — UI beta rápida (completado)
- (8) ✔ Versión sutil en footer del sidebar (izquierda, mono 10px muted-foreground/70, `v{pkg.version}` import de package.json).
- (9) ✔ Sidebar en móvil: full ancho (w-full → sm:w-72) + fondo más claro traslúcido igual que el popup (bg-background/80 backdrop-blur-md → sm:bg-card/50 sm:backdrop-blur-none).
- (10) ✔ ModalShell fullscreen en móvil (items-stretch, card sin radius/border/padding reducido, scroll; sm: restaura popup centrado 85dvh max-w-lg) — afecta a About y Settings por igual.
- (11) ✔ Botón de envío en color de tema (bg-emerald, aplica el acento data-accent elegido).
- (12) ✔ Burbujas del usuario con gris sutil por tema en vez de blanco/negro: token nuevo --user-bubble (#e4e4e7 light / #2c2c31 dark) mapeado a @theme inline → bg-user-bubble, texto text-foreground; chip de adjunto ajustado a bg-foreground/10.
- (13) ✔ To-dos: 'session-search' (buscador de sesiones front) + 'interleaved-events' (mensajes intercalados estilo gh cli durante procesos) en todos_v2.
- ✔ tsc + build verdes (build con web parada, quirk pids conocido); restart web verificado: / 200, /about/ 200, favicon.svg 200.
- Pendiente: verificación visual del usuario en móvil real; logo trial sigue abierto.

### Versión 3 dígitos + roadmap público (24/10/2026)
- ✔ Regla de versionado (decisions.md): siempre 3 dígitos; 0.0.25.4 ≡ v0.0.26;
  beta oficial = v0.1.x. package.json bumped a 0.0.26 (footer/favicon se
  actualizan solos vía pkg.version).
- ✔ Roadmap (to-dos) en README.md y README.es.md (auth, CI pipelines + badge
  tests, session search, interleaved events, shell allow_always memory), con
  nota de que ninguno bloquea la beta. To-do 'ci-tests-badge' registrado
  (faltaba en todos_v2).
- Badges de release de ambos READMEs → v0.0.26.

### Lote móvil v0.0.27 (feature/mcp-helper) — avatar/burbujas/drawer (completado)
- ✔ Chat móvil: avatar del asistente ENCIMA del contenido (flex-col → sm:flex-row) en
  AssistantMessage, LiveBlock y placeholder de puntos; también el comando ❯ ya era columna.
- ✔ Burbujas más anchas: usuario 80%→90%; asistente/LiveBlock 85%→90%.
- ✔ Drawer móvil: arriba a la derecha SOLO el close (X, md:hidden); el botón + del header
  solo queda en desktop (hidden md:flex) y ahora con color del tema (bg-emerald,
  igual que el botón de enviar).
- ✔ FAB "+" flotante en móvil (h-14 rounded-full bg-emerald + accent, sombra,
  safe-area-inset-bottom, sobre el footer del sidebar, md:hidden) sustituye al del header.
- ✔ Corrección del usuario: el status-bar en móvil NO oculta cwd/rama, solo el label
  "Working directory:" (la ruta + [⎇rama] se ven como en desktop, truncadas).
- ✔ build ritual OK con limpieza de 5 helpers ask-user huérfanos (todos hijos del daemon
  vivo 116569; NO son leaks de daemons muertos: 1 por turno/pregunta, se quedan Z al
  matarlos). Web arriba: /, /about/, favicon 200.
- Idea evaluada (solo razonar): favicon dinámico con acento del tema → viable vía
  data-URL en cliente (Opción B), pendiente de decisión del usuario.

### v0.0.28 (feature/mcp-helper) — verde semántico + favicon dinámico (completado)
- ✔ Botones de la card de permisos: permitir (esta vez/siempre) pasan de bg-emerald
  (token ligado al acento → dejaba de ser verde con otros temas) a bg-emerald-500
  fijo; rechazar sigue rojo fijo. Verde/rojo semánticos independientes del acento.
- ✔ FAVICON DINÁMICO con el tema (prueba pedida, Opción B data-URL): layout.tsx lee
  el path d de public/favicon.svg (fs en runtime) + inyecta en themeInit el mapa de
  15 acentos (light 500/dark 400 de ACCENTS) → setFav genera data-URL SVG y cambia
  link[rel=icon] (creándolo si faltase); el estático ?v= queda como fallback.
  Reacción en vivo: cambios de sistema (mq listener), ciclo de tema del footer y
  acento en Config vía window.__cwApplyTheme (syncThemeAndFavicon en lib/cw.ts).
  accents.ts pierde "use client" (módulo puro compartido por server/client).
  Validado en Node: data-URL ~11.4KB parseable, fills correctos (rose claro,
  emerald oscuro #34d399).

### v0.0.29 (feature/mcp-helper) — fix favicon + foco al composer (completado)
- ✔ Bug favicon: al hidratar, Next pisaba el link[rel=icon] gestionado por React
  (href data-URL → estático ?v=, icono volvía a blanco). Fix: link PROPIO
  (#cw-fav-dyn) appendeado al final (el último rel=icon gana) + MutationObserver
  que lo mantiene último si Next reinsterta iconos. El estático queda como
  fallback sin JS.
- ✔ Nueva sesión: foco automático al composer (focusNonce state en page.tsx que
  sube en createSession; Chat lo observa y hace inputRef.focus()).
- ✔ Limpieza operativa: ~24 serve/next-server huérfanos acumulados agotaban
  pids.max (256) → build fallaba (SWC SIGABRT). Liberados PIDs y build OK.
  Nota: el init del contenedor es `tail` y no reaparce zombies (78 acumulados).
- Verificado: / 200, /about/ 200, favicon.svg 200; script cw-fav-dyn ×2 +
  MutationObserver ×3 en HTML servido.

### v0.0.30 (feature/mcp-helper) — banner busyPerm fuera + Check verde fijo (completado)
- ✔ Banner "La sesión espera tu respuesta..." borrado: la card de permiso ya
  explica el estado; el 429-busy solo re-muestra la card y encola el mensaje
  (retryRef) sin texto extra. Claves err.busyPerm eliminadas de i18n (en+es).
- ✔ Chip de tool completada: icono Check ahora text-emerald-500 FIJO (no sigue
  el acento), igual que los botones allow (X rojo ya era fijo).
- ✔ Régimen post-restart #5: el freeze mató web+daemon; relanzado todo con el
  launcher (helper JSON regenerado solo, daemon con --cwd /workspace --model
  default). Nota diagnóstica: curl a :3222 da 000 SIEMPRE (TCP crudo JSON-RPC,
  no HTTP) — no es señal de muerte; EADDRINUSE en copilot foreground = vivo.
