# Decisions — POC Copilot Web

## Branding / marca
- Proyecto comunitario NO oficial: el disclaimer de no afiliación con GitHub/
  Microsoft/OpenAI es obligatorio en README y en la página About de la web
  ("GitHub Copilot" es marca de GitHub, Inc.). La versión visible (About y
  releases) vive en `package.json` y se incrementa en cada release GH Actions.

## PRINCIPIO 0 — Zero-materialized data: copilot ACP data is the only truth
- La web NO posee ningún dato: todo lo que muestra o manipula vive en el CLI/daemon y se
  accede SIEMPRE por el canal ACP (session/list, session/load, session/prompt, updates).
  Nada persistido en la web: sin .data, sin sqlite propio, sin ficheros de sesiones/
  turnos/mensajes. Nunca leer ficheros internos del CLI (~/.copilot/session-state/… —
  mala praxis; solo el CLI borra/lee su estado).
- Lo único "local" es estado en RAM reconstructible (globalThis): sessionLog (updates del
  canal, replay frío de session/load + live), cmdCache (paleta), overlay 0-turn (sesiones
  creadas sin primer prompt) y transitorio (runningTurns, pendingPermission). Drafts y
  horas de mensajes: solo en el navegador.
- Regla derivada: si algo no está en el canal ACP, NO se inventa ni se guarda — la UI
  muestra lo que hay y el error honesto cuando falla (delete/rename requieren
  verificación session/list; sin confirmación → 502 visible).

## LÍMITES ACP verificados (probe 1.0.80, oct 2026)
- session/load NO reproduce agent_thought_chunk ni da timestamps por mensaje →
  pensamientos y horas solo existen calientes (RAM); tras reinicio desaparecen del replay
  frío. No se persisten (Principio 0). UI: sin ts se oculta la fila de hora (sin "·"
  suelto); sin hora mentirosa.
- El agente NO expone el modelo por canal oficial (initialize/configOptions/updates sin
  clave "model"; solo mode Agent/Plan/Autopilot). El chip "Model:" de la barra de estado
  solo se muestra si el operador pasó --model al launcher (COPILOT_MODEL); nunca se
  adivina.
- El daemon NO ecoa user_message_chunk en vivo (solo en replay): acp.prompt() registra el
  texto del usuario sintéticamente en sessionLog; nunca en inyecciones slash.
- Turnos con solo slash informativos no crean registros en el CLI (la sesión vive en el
  overlay hasta el primer prompt).
- El CLI no registra los permisos denegados en el replay (chips de denegado no
  reproducibles frío — aceptado).

## Producto / reglas de interacción
- Trabajar SIEMPRE con el daemon ACP (copilot --acp --port N): session/new|load|list|
  prompt|close, updates, permission_request/resolved. No hay fallback a `copilot -p`.
- Permisos: la card en la web es LA UI del permiso (allow/deny del usuario). SIN
  resolución automática de ningún tipo (ni timer, ni auto-approve si el stream muere, ni
  auto-deny). Un permiso solo se resuelve con el click del usuario; con el cliente muerto
  la card se re-muestra (429 {busy,pending}) y el mensaje se reenvía tras resolverla.
- DELETE/rename: inyección de /session delete|rename a la sesión ops + verificación por
  session/list; sin confirmación del CLI → 502 visible y reversión del optimismo (sin
  tombstones).
- Turno zombi observable: GET de sesión expone running; el cliente sondea mientras el
  daemon siga procesando un turno aunque su stream SSE muriera.
- Idioma por defecto: lo decide el navegador; el launcher puede fijarlo con --lang
  (runtime, sin rebuild). Toggle manual eliminado.
- Barra de estado del composer: "Working directory: <cwd> [⎇ rama]" (izquierda) +
  "Model: <model>" (derecha); la rama se consulta con git estándar (GET /api/status/[id],
  poll al foco y cada 15 s porque el usuario puede cambiarla).
- Móvil: shell con h-dvh + interactive-widget=resizes-content (barra de dirección
  dinámica y composer visible con el teclado).
- Interacción: cursor pointer en cualquier botón/link/summary (global en globals.css).

## Materialización UI (convenciones)
- Reasoning como parts {kind:"reasoning"} intercalados entre texto y tools (se ve como en
  el CLI: pensamiento, frase, herramienta, pensamiento…). Los deltas se CONCATENAN (nunca
  unir con \n — v0.0.18).
- Permisos: meta del chip del tool real, nunca chip duplicado; denegado = chip en error
  "(denegado)"; solo permisos sin tool propio (kind commands) tienen chip "permiso · …".
- Turno denegado sin texto del modelo: línea meta system "permiso rechazado — no hubo
  respuesta del agente" (live e hidratación, misma frase).
- Cajón de sastre: avisos del CLI sin chip propio van como {kind:"system"} (línea mono
  dim); el resto de avisos internos (turn_*, session.*) no se pinta.

## OPS (procesos, git, build)
- OPS-03: presupuesto de pids (~256). Reglas: mutaciones de git SOLO con el git shim
  (~/.local/bin/git; si falla por permisos, chmod 777 en .git y reintentar); al matar
  next-server matar también su sh -c par y kill -CHLD 1 (zombies); nunca 2 servidores ni
  compilar con el server activo (parar → build → arrancar 1 vez → curl); 1 build+restart
  por lote; si "fork: Resource temporarily unavailable" cerrar procesos no esenciales.
- OPS-04: Next build necesita experimental.cpus: 1 en next.config.ts (workers agotan
  pthread_create).
- OPS-05: con trailingSlash: true TODAS las rutas de API llevan slash final (308 sin él;
  urllib no sigue 308 preservando el método).
- OPS-06: cold auth de daemons. Un spawn heredando el entorno del agente/operador
  nace "Logged out" y session/new → -32000 "Authentication required" (veneno del env
  del loader CodePods: COPILOT_LOADER_PID/COPILOT_AGENT_SESSION_ID/…). Remedio en el
  launcher: el daemon spawnea con env whitelisted (PATH/HOME/SHELL/LANG/TERM/…,
  proxies + COPILOT_PROVIDER_*/COPILOT_MODEL leídos de `.env.local`). Tras un restart
  del pod regenerar `.env.local` desde el env vivo del loader (`/proc/<pid copilot
  --continue>/environ`, pares COPILOT_PROVIDER_*/COPILOT_MODEL) — el launcher lo lee
  y es autosuficiente; verificado E2E: session/new 201 en frío.
- Daemon ACP tras restart: `node bin/copilot-web.mjs --port 3100` lo spawnea detached
  con env saneado y lo reutiliza si ya probea el puerto; --model y el helper solo
  aplican a daemon recién spawneado (si reutiliza: warn honesto e ignorar).
- MCP helper: la tool ask_user NO conoce su sesión → la card se muestra en la(s)
  sesión(es) con turno en curso; long-poll 5 min con expiración honesta (+5 min oculta
  la card); cero persistencia (Principio 0); sin tocar la config global del CLI
  (--additional-mcp-config @/tmp/…json por proceso daemon). Rama feature/mcp-helper
  (única diferencia vs poc: el MCP).
