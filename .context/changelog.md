## v0.1.2 (25/10/2026) — release publicada (repo público)
- fix: la UI muestra la versión real (sidebar/About leen
  copilot-web/package.json, que había quedado en 0.0.32 desde la era
  pre-pública). package.json 0.0.32 → 0.1.2; verificado en la build local
  (60/60 tests, bundle con 0.1.2, servidor :3100 recién reconstruido).
- Checklist de release documentado en decisions.md (bump de package.json
  antes de taguear).

## v0.1.1 (24/10/2026) — release publicada (repo público)
- READMEs: Quick Start con ruta SIN CLONAR (instalador autocontenido desde
  releases/latest: descarga él mismo el tarball) y git clone con la URL real
  del repo; eliminado el `npx copilot-web` (no hay paquete npm publicado —
  era falso).
- scripts/install.sh: modo standalone (fuera de checkout → descarga el tarball
  de la última release a la altura del script y sigue) + env opcional
  COPILOT_WEB_NO_START=1 para instalar/compilar sin arrancar.
- CI interno: .github/workflows/ci.yml en push/pull_request (npm ci, tsc
  --noEmit, build, npm test con capa ACP mockeada); badge real de CI en los
  READMEs (se retira el placeholder "tests-pending").
- Verificado: bootstrap standalone probado con curl/API reales (URL correcta;
  la descarga del asset está bloqueada por el proxy del sandbox — mockeada en
  el test con el mismo tarball local), npm ci ×2 sobre el árbol extraído y
  build limpio del proyecto.
- Publicada: squash dev→main (b85d12d "Dev to Main: v0.1.1…", árboles
  idénticos), tag v0.1.1 en dev y release en el repo público (workflow
  release success: tarball copilot-web-v0.1.1.tar.gz 119KB + install.sh
  standalone 2.9KB). CI verde en main y dev del repo público (primer run
  del nuevo ci.yml). Badges READMEs → release v0.1.1.
- Bug corregido en publicar.sh: usaba --tags (empujaría TODOS los tags
  locales) y los tags no se añadían realmente a REFS; ahora cada tag va
  explícito en la lista de refs.

## v0.1.0 (24/10/2026) — primera beta pública (repo público bcgrillo/copilot-web)
- Refactor completo del código (commit 028ae46): comentarios y strings del
  server en EN, nombres/estructura revisados; `lib/content.ts` (helpers de
  extracción compartidos live/hidratación) y `lib/limits.ts` (MAX_FILES=8,
  5 MB, guard 20 s) nuevos; 8 dependencias sin uso eliminadas del
  package.json (framer-motion, shiki, sonner, remeda, CVA, radix
  collapsible/slot/toast). UI copy i18n intacta (dict es/es es contenido).
- Suite de tests con vitest (60 tests, 8 ficheros): lib entera (materialize,
  content, store, copilotStore, helperAsk, cw, api, accents) + server SSE del
  turno (`api/chat/route`): 404/400/429/adjuntos, orden de eventos SSE
  (message_start/delta/tool/permission/message/done), filtros replay+Info,
  cards de permiso y guard de 20 s con fake timers. La capa ACP queda
  SIEMPRE mockeada (`vi.mock`) — los tests no tocan el daemon ni sesiones
  reales.
- Fix real descubierto por los tests: `isObj` en content.ts/materialize.ts
  daba `""` con listas de bloques (los arrays son objetos) — corregido;
  `textContentOf` acepta strings planos de forma defensiva.
- `npm run test` añadido al package.json.

## v0.0.32 — Header móvil con logo + lote de ajustes (feature/mcp-helper)
- Header en móvil (sidebar oculto): logo de la app a la izquierda (h-8, mismo
  tamaño que el del sidebar para que no salte al abrir) y menú de sesiones a la
  derecha (h-8, iconos alineados); el lápiz de renombrar queda pegado al título
  y menos sutil (foreground/60 → foreground en hover).
- Selector de acento: 2 filas de 8 (16 tonos) con orden por hue; añadido
  amarillo (#eab308 / #facc15). Los 4 extra pedidos exigen retirar 3 cercanos
  (sky/purple/rose ≈ blue/violet/red) — pendiente de decidir con el usuario.
- Notificaciones: fuera el punto rojo del favicon (doblo con el aviso del
  navegador); se mantienen los badges del sidebar + Notification API oculta.
  El hint de Config ya no habla de "sesión en segundo plano": el disparador es
  la pestaña oculta, con cualquier sesión. Clic en la notificación aterriza en
  la sesión pendiente y la vuelta a la pestaña re-pina el scroll al fondo.
- Título de la pestaña con prefijo restaurado: `Copilot Web · sesión` (solo
  se quitó el "Beta"); se estaba sustituyendo por el nombre a secas.

## v0.0.31 — Pendiente de ver (badges) + notificaciones + header con renombrado (feature/mcp-helper)
- Badges de "pendiente de ver" por sesión: contador rojo junto al nombre en el
  sidebar cuando la sesión no es la activa (o la pestaña está oculta) y ocurre
  un evento — turno terminado o permiso pendiente. Se limpia al visitar/enviar.
- Título de la pestaña dinámico: `(N) Nombre de sesión` (fuera el "Beta");
  favicon dinámico con punto rojo si hay pendientes.
- Notificación de sistema opt-in (Notification API) si la pestaña está oculta:
  toggle en Config (sección Nueva), con permiso solo al activar; clic enfoca la
  ventana. Almacén: `cwUnread` (Record<sessId, n>) y `cwNotify` en localStorage.
- Header del chat: `#abcdef01` (fuera el prefijo "sess"); renombrado de la
  sesión activa con lápiz sutil (desktop) o tocando el título (móvil); Enter/
  blur confirman, Esc cancela.

## v0.0.30 — Sin banner busyPerm + Check verde fijo (feature/mcp-helper)
- Al enviar con un permiso pendiente ya NO aparece el banner adicional: la card
  de permiso es la única UI (el mensaje queda en cola y se reenvía al responder).
- El check de tools completadas es verde fijo (emerald-500), independiente del
  acento del tema (coherente con los botones permitir).
## v0.0.29 — Fix favicon dinámico + foco en sesión nueva (feature/mcp-helper)
- Favicon: la hidratación de Next restauraba el href del link estático y el icono
  "volvía al blanco". Ahora el favicon dinámico usa un link propio (#cw-fav-dyn)
  al final del head (el último rel=icon gana) protegido por MutationObserver.
- Sesión nueva: el composer recibe el foco automáticamente al crearla.
## v0.0.28 — Verde semántico en permisos + favicon dinámico con acento (feature/mcp-helper)
- Botones "permitir" de la card de permisos a verde esmeralda FIJO (bg-emerald-500), independiente del acento elegido; rechazar sigue en rojo fijo (verde/rojo semánticos).
- Favicon dinámico: mismo logo, coloreado con el acento del usuario (claro 500/dark 400) vía data-URL en themeInit (pre-JS-hidratación), reacciona en vivo a tema/acento/sistema; el favicon estático ?v= queda como fallback.
## v0.0.26 — Lote UI beta rápida (feature/mcp-helper)

- **Cambio de esquema de versiones: siempre 3 dígitos (semver).** Este lote era
  "0.0.25.4" y pasa a ser v0.0.26; la beta oficial abrirá en v0.1.x.
- (8) Versión sutil `v{package.json#version}` en el footer del sidebar (izquierda de los botones, mono 10px, muted-foreground/70).
- (9) Sidebar en móvil: full ancho (w-full → sm:w-72) y fondo más claro translúcido como el popup (bg-background/80 backdrop-blur-md; en sm+ restaura bg-card/50).
- (10) ModalShell fullscreen en móvil: la tarjeta ocupa toda la pantalla (sin radius/border, p-5, scroll; sm+ restaura popup centrado max-h-85dvh/max-w-lg) — aplica a About y Settings por igual.
- (11) Botón de envío en color de tema (bg-emerald → sigue el acento data-accent elegido).
- (12) Burbujas del usuario en gris sutil por tema en vez de blanco/negro: token nuevo --user-bubble (#e4e4e7 light / #2c2c31 dark) mapeado a @theme inline → bg-user-bubble, texto text-foreground; chip de adjuntos dentro de la burbuja a bg-foreground/10.
- (13) To-dos registrados: 'session-search' (buscador de sesiones en el sidebar) y 'interleaved-events' (mensajes intercalados estilo gh cli durante procesos en marcha).
- Nota: el favicon .ico no existe (404 esperado); el icono es favicon.svg (?v=pkg.version para cache-bust).

## v0.0.25.2 — About/Config modales + acento + daemon (feature/mcp-helper)
- About y Config como popups (ModalShell backdrop bg-background/80 + blur, Esc/backdrop/✕).
- Config: idioma auto/EN/ES en vivo (setLangChoice + evento copilot-web:lang),
  modo auto/claro/oscuro, color del acento (15 paletas data-accent en
  globals.css; html.dark ajusta el brillo 500→400; todo el UI ya lee
  var(--emerald)).
- layout themeInit aplica accent pre-paint (localStorage "accent", regex
  /^[a-z]{3,12}$/; sin flash).
- GET /api/daemon: alive/pid/port/model (probe + /proc). POST {action:"restart"}:
  SIGTERM/SIGKILL al daemon (+helper ask-user huérfanos) y respawn con argv del
  /proc viejo completado a la intención del launcher (--model default +
  --additional-mcp-config @helper + --allow-tool) y env saneado
  (whitelist DAEMON_ENV); espera probe 20 s. E2E: pid 111682→116558, helper y
  model en cmdline, session/new OK tras el restart.
- /about usa AboutContent compartido (ruta + modal idénticos).
- Footer: ayuda abre modal (antes <a> a /about); botón nuevo de settings.
- PRUEBA reversible del logo (sidebar/about): sin badge, text-emerald directo.

# Changelog

## v0.0.25 — branding, tema auto, About y disclaimer (feature/mcp-helper)
- **Logo propio**: `public/copilot-web.svg` (renombrado del SVG aportado) inline
  como `Logo.tsx` con `fill="currentColor"` (sobre emerald sale blanco, sobre
  texto hereda el tema). Sustituye al icono robot en la cabecera del sidebar y
  en el EmptyState.
- **Favicon dark-aware**: `src/app/icon.svg` (App Router lo sirve solo) con
  `@media (prefers-color-scheme: dark)` → relleno negro en claro, blanco en
  oscuro.
- **Tema tri-estado**: auto/light/dark (lucide `SunMoon`/`Sun`/`Moon`, ciclo al
  click). Default **auto** (sigue al sistema; `themeInit` del layout aplica
  antes de hidratar y con listener `matchMedia` reacciona en vivo; una elección
  explícita persiste en `localStorage.theme`).
- **Página de About** (`/about`, i18n en/es, icono CircleHelp junto al toggle
  de tema): disclaimer estándar de **no afiliación** con GitHub/Microsoft/
  OpenAI (marca "GitHub Copilot"), enlaces al repo y a crear issues, y nº de
  versión desde `package.json` (bump a 0.0.25; a partir de aquí las releases
  de GH Actions irán incrementándolo). README con el mismo disclaimer.

## v0.0.24 — permisos con las opciones del agente (allow_always / reject_once…) (feature/mcp-helper)
- **La card de permiso renderiza las opciones REALES que ofrece el agente**
  (spec ACP `request_permission.options`): copilot envía
  `allow_once`/"Allow once", `allow_always`/"Always allow", `reject_once`/"Deny"
  (sin `reject_always` para bash; si un agente lo ofrece se muestra igual —
  fallback al `name`/kind raw). Rechazos a la izquierda en rojo, permisos a la
  derecha en verde; con opciones la card va vertical (frase arriba, botones
  debajo en línea, mismo ancho del composer); sin opciones conserva los botones
  deny/allow clásicos. Labels por kind desde i18n (`chat.perm*` es/en).
- **allow_always funciona de verdad** (verificado E2E contra el daemon):
  responder `optionId:"allow_always"` → el mismo comando exacto en la misma
  sesión NO vuelve a pedir permiso (memoria del CLI, nada persistido en la web
  — Principio 0). `reject_once` ejecuta y deniega; NO recuerda.
- Puente ACP honesto de extremo a extremo: `sessionLog`/SSE `permission`
  reenvía `options[]`, 429 busy `pending{}` también; respuestas con
  `{reqId, optionId}` validadas contra las opciones vivas de
  `respondPermission` (invalid → 400 con mensaje, caducada → 404; la UI retira
  card stale en ambos casos). Atajo booleano allow/deny sigue vivo (fallback).
- **MCP helper sin permisos**: el launcher pasa
  `--allow-tool "copilot-web-helper(ask_user)"` al spawn del daemon (solo rama
  mcp-helper) — ask_user ya no genera card de permiso del CLI, solo la card de
  pregunta propia. Verificado E2E real.

## v0.0.23 — permisos reales, UX de decisión y scroll pegado (feature/mcp-helper)
- **Daemon sin allow-all por defecto**: el launcher ya no pasa
  `--allow-all-*` al spawn de `copilot --acp`; el CLI pregunta permisos por
  ACP y la web los resuelve con las cards allow/deny. `--copilot-args
  "allow-all"` sigue disponible para optar explícitamente. Verificado E2E:
  card de permiso (reqId, tool "Create file"), allow → tool ejecutada,
  deny/invalid → 404/400 limpios.
- Permisos caducados resueltos con feedback: reutilizar una sesión con cards
  de un daemon anterior (reqIds ya inexistentes) ya no deja la card atascada
  en silencio; el POST devuelve 404 y la UI retira la card, limpia el estado
  sticky y muestra un error explicativo (`err.permStale`, i18n es/en).
- Botón **Deny en rojo** (variante destructiva) en las cards de permiso.
- Ask card: input + botón de envío **siempre visibles** (envío deshabilitado
  sin texto), sin necesidad de pulsar "Other" para escribir; opciones en
  vertical encima.
- Barra de estado ("Working directory: ... [⎇rama]" + model) **nunca
  desaparece**, aunque el composer se oculte con decisiones pendientes.
- Scroll pegado al fondo con ResizeObserver: si el área de chat encoge o el
  input/crecen las cards y el usuario estaba al fondo (umbral 100px), se
  repiega al fondo de inmediato; si el usuario está arriba leyendo, no se
  le arranca el scroll.
- Al reutilizar un daemon ya en marcha, el status-bar ya no pierde el
  "Model: xxx": se lee el COPILOT_MODEL del env real del daemon vivo
  (/proc), warn honesto solo si el --model de esta ejecución difiere.

## v0.0.22 — decision cards y pulido de UI (feature/mcp-helper)
- Cards de decisión (permisos y ask_user) al mismo ancho que el textarea y el
  composer se oculta mientras haya una decisión pendiente (rebote del foco
  evitado: el draft por sesión se guarda en cada pulsación).
- ask_user: opciones en vertical (una debajo de otra, botones a ancho completo)
  y botón "Otra respuesta (texto libre)" siempre disponible; sin opciones
  (kind=info) se muestra el input directamente.
- Barra de estado: `[⎇rama]` sin doble espacio.
- Branding: badge "POC" → "Beta" (sidebar, título de página y footer).

## v0.0.21 — MCP helper `ask_user` (rama feature/mcp-helper) + auth de arranque en frío
- MCP helper completo y verificado E2E real: el agente llama
  `copilot-web-helper-ask_user`, aparece una card de pregunta en el chat (azul),
  el usuario responde (texto libre o botones con `kind=choice`) y el turno
  continúa con la respuesta (long-poll, timeout honesto a los 5 min).
- Launcher: al spawnear el daemon escribe `/tmp/copilot-web-helper-<port>.json`
  y añade `--additional-mcp-config @fichero` (sin tocar la config global del
  CLI). `--no-helper` para desactivar; reutilizar daemon → warn honesto.
- Web: `src/lib/helperAsk.ts` (store RAM, caduca pendientes a los 5 min),
  `GET/POST /api/helper/ask/`, `POST /api/helper/answer/<id>/` (410 doble
  respuesta / 404 desconocida), card `HelperAskCard` (poll 1.5 s solo con
  turno en curso), claves i18n `chat.helperAsk*`.
- Auth cold (OPS-06): el daemon se spawnea con env whitelisted (NO hereda el
  entorno del operador — el env del loader CodePods bloquea `session/new` con
  "Authentication required") + provider/model desde `.env.local` (el launcher
  lo lee; tras restart del pod regenerarlo desde el env del loader). E2E:
  `session/new` 201 en frío con daemon spawneado por el launcher.

## v0.0.20 — status-bar, drafts y footer finales (feature/copilot-web-poc)
- Barra de estado del composer: `Working directory: <cwd> [⎇ rama]` +
  `Model: <model>` (la rama via git nativo `/usr/bin/git` — el `git` del PATH
  es el shim CodePods; poll 15 s + refresco al foco porque puede cambiar).
- Draft por sesión persistido en el navegador y restaurado al cambiar de sesión.
- Footer limpio: icono de tema con título, sin textos "light/dark" ni icono
  de idioma (el idioma viene de navegador o `--lang`).
- Launcher `--lang`/`--model` honesto (reutilizar daemon → warn) y docs
  consolidados (design/decisions reescritas, README beta).

## v0.0.19 — pensamientos en tramos intercalados + Alt+Enter + licencia
- Los pensamientos ya no van en un único bloque: son parts `{kind:"reasoning"}`
  intercalados en orden real (pensamiento, frase, herramienta, pensamiento…),
  en vivo y en rehidratación caliente, como el CLI.
- Alt+Enter inserta salto de línea igual que Shift+Enter (no envía).
- Etiqueta del bloque "razonamiento" traducida (Thinking/razonamiento).
- README: sección License actualizada a GPL-3.0 (el LICENSE del repo es GPL v3).
- LÍMITE DOCUMENTADO: el replay frío de session/load NO trae
  agent_thought_chunk (ACP no los reproduce) — tras reinicio del web las
  sesiones frías muestran el texto/tools sin pensamiento, por Principio 0
  no inventamos ni persistimos esa data.

## v0.0.18 — fix: pensamiento con saltos extraños al materializar
- `materialize.ts` unía cada delta de `agent_thought_chunk` con `\n`; los
  fragmentos de ACP son micro-porciones ("hab", "ilitado") → palabras partidas.
  Ahora se concatenan tal cual (igual que `reasoningBuf` en vivo). E2E:
  deltas == msg == materializado, texto continuo.

## v0.0.17 — i18n en/es (feature/copilot-web-poc)
- Diccionario 46 claves + LangProvider; default inglés, detección ES por navigator, persistencia en `localStorage.lang`; toggle EN/ES en el footer.
- Sidebar, Chat y footer traducidos; sugerencias del estado vacío traducidas.
- Strings del server en inglés (materialize, chat/sessions routes, acp): chips de permiso `permission ·`, resolvers `permission granted/denied ·`, sufijo `(denied)`; `formatTs` con locale por idioma (es-ES/en-US).
- E2E: build + relanzado en :3100; turno eco `i18n-e2e` con ts en vivo y replay frío sin ts.

## Integración en dev (acumulado POC completa)
- v0.0.1–v0.0.16: copilot-web (Next 15 :3100, basePath CodePods) sobre daemon ACP :3222 sesión única, chat streaming SSE con tools/permisos/chips, sidebar al vuelo (session/list + overlay 0-turn), rename/delete por slash CLI con verificación y errores visibles, cero datos materializados (Principio 0), spinner de apertura, horas solo-en-caché-viva, móvil h-dvh.

## v0.0.15 — apertura sin flash + horas solo-en-viva
- Spinner "cargando sesión…" en el área del chat mientras el GET hidrata (fin del flash de "sesión nueva" al clicar); estado vacío solo si el GET confirma 0 mensajes.
- Sellado de hora de llegada (ts ISO) en updates en vivo del sessionLog (replay frío sin ts: ACP no trae timestamps por mensaje — verificado contra daemon 1.0.80). materialize propaga ts a user/assistant; la UI oculta la fila de hora cuando no hay ts (sin "·" huérfano); ChatMessage.ts ahora opcional.

## v0.0.14 — lista de sesiones al vuelo
- sessions.json eliminado: session/list + overlay RAM 0-turn; títulos siempre del CLI (fuera origin/renamed); .data fuera.
## v0.0.13 — limpieza de datos
- Fuera fallback sqlite (copilotStore solo usa session/list) y sessions-content-backup.json; sessions.json = metadatos mínimos (0-turn/renamed/origin/orden).
## v0.0.12 — cero-materialización ACP + delete/rename reales (feature/copilot-web-poc)
- sessionLog en RAM como única fuente del histórico; materialize.ts; fuera eventsLog/webTurns/tombstones; delete `/session delete --yes` y rename `/session rename` inyectados por CLI con verificación session/list; errores de fondo visibles con reversión; E2E TODOS OK; experimental.cpus:1 para builds con pids limitado.
## v0.0.1 — bootstrap (feature/copilot-web-poc)
- Estructura `.context/`, branch de POC.
- Verificado entorno: copilot CLI 1.0.80, Node 22, npm OK; pendiente auth web.
## v0.0.24.1 — sin "Info: <ruta>" fantasma
El daemon ACP inyecta tras ciertas tools (create/edit con permiso) un chunk de
texto "Info: <ruta>" que duplica lo que ya enseña el chip de la tool y pega el
mensaje real sin espacio ("Info: /path✅ Creado…"). Ahora se oculta en
presentación (stream vivo y materialize/reload) si es el primer chunk de texto
del turno y hubo una tool antes: regex `^Info:\s*\S+\s*$` (`DAEMON_INFO_RE`).
El stream ACP no se toca (PRINCIPIO 0). Verificado E2E: vivo sin "Info:" y
reload limpio.
## v0.0.27 — UX móvil: avatar/burbujas/drawer (feature/mcp-helper)
- Avatar del asistente encima del contenido en móvil (flex-col → sm:flex-row) en AssistantMessage, LiveBlock y placeholder de puntos.
- Burbujas más anchas: usuario 80%→90%, asistente 85%→90%.
- Drawer móvil: solo el close (X) arriba a la derecha; botón + del header solo en desktop y ahora con color del tema (bg-emerald).
- FAB "+" flotante en móvil con acento (h-14, rounded-full, sombra, safe-area, sobre el footer).
- Status-bar móvil: se conserva cwd y rama; solo se oculta el label "Working directory:".
