# task.md — Split back/front + agentes no-copilot (análisis)

## api-front-split (26/10+) — objetivo
Separar despliegues: back (API + daemon ACP) y front en contenedores
distintos (CodePods tendrá front propio, fork de este repo, contra el back
de cada container). Además: evaluar genericidad del back para opencode,
codex, etc.

### Análisis: acoplamiento front↔ACP
- El front NO habla ACP nunca. Su único contrato: SSE de /api/chat
  (+ eventos propios: delta/text/thought/tool/reasoning_done/permission)
  y REST propio (/api/sessions*, /api/commands, /api/status,
  /api/permission, /api/cancel, /api/daemon, /api/helper/*).
- TODO el acoplamiento copilot vive en el back (acp.ts 674 líneas):
  1. transporte: daemon TCP NDJSON :3222 (`copilot --acp`)
  2. dialecto copilot: session/new (authMethods/modes), session/prompt
     blocks, session/update, request_permission
  3. ops de sesión host-side: workspace.yaml (ESPECÍFICO copilot,
     workaround CLI ≥1.0.89) + fallback slash
  4. helper MCP ask_user (copilot MCP)
  5. knobs: COPILOT_ACP_ARGS, SESSION_OPS_MODE
- Genericidad: conceptos (text/thought/tool deltas, sesiones, permisos)
  casi universales. Agentes ACP-compliant (opencode ya lo soporta; hay
  adapters gemini, claude code): swap de adapter, front intacto.
  Non-ACP (codex): capa traductora -> nuestra schema interna.
- Plan: interface AgentProvider (lifecycle/sessions/stream/permissions/
  cwd) en src/lib/agents/{copilot,opencode,codex}; acp.ts queda como
  cliente ACP shared + adapter copilot para sus rarezas.

### Análisis: split físico
- Opción A (ahora): CORS + API base. middleware.ts CORS en /api/*
  (incluye SSE; preflight para PATCH/DELETE; ambos con y sin trailing
  slash), NEXT_PUBLIC_API_URL en src/lib/api.ts BASE, y API_DISABLED=1
  opcional para front puro (routes 404). Builds idénticos, dos envs.
- Opción B (después/repos): pnpm workspace apps/api + apps/web (static
  export, UI es client-only). Más limpio para forks; migración mayor.
- Params necesarios: NEXT_PUBLIC_API_URL (front→back abs),
  CORS_ALLOW_ORIGIN (back), API_DISABLED=1 (front), COPILOT_ACP_PORT,
  SESSION_OPS_MODE. No hay auth propia (SSE EventSource no lleva
  headers; auth externa en proxy CodePods).

### v0.1.4 — implementado (26/10)
- APP_MODE=all|api|front (default all) — ver .context/changelog.md v0.1.4.
  Guardas runtime (guardApi en rutas) + middleware edge (UI 404 + CORS).
  En self-hosted el middleware también lee env en runtime.
- Split E2E verificado con dos servicios codepods (cw-back :3103 api +
  cw-front :3104) contra el daemon compartido :3222. Hallazgo: `next start`
  re-evalúa ASSET_PREFIX/env en runtime — el shell pisa .env.local.
- Opción A HECHO (CORS + API base + modos). Opción B (repos/apps separados)
  y AgentProvider quedan para siguiente ciclo.

## Estado actual (v0.1.4 — RELEASE LISTA)
- Rama `feature/api-front-split` ( último commit 570e5a0, pushed); release
  v0.1.4 = split + auth dual-token.
- Tests: 117/117 verde en 16 ficheros (suite pid-safe, usersCli primero);
  nuevos: auth HTTP routes (login/refresh/state) + usersCli subprocess;
  bin/users.ts con error paths limpios; openapi 401 reasons + --no-auth
  documentados en spec (test assert). tsc --noEmit OK.
- Docs: README.md + README.es.md (badge v0.1.4, bullets auth, limits/roadmap
  caducos fuera); changelog v0.1.4 marcada publicada; cw-sync hecho
  (users.ts, openapi spec/test, 4 test files nuevos en /workspace/cw-split).
- Siguiente paso: squash a dev → main → tag v0.1.4 → `./publicar.sh v0.1.4`.
- Pendiente siguiente ciclo: AgentProvider (opencode/codex), split repos.

## session-rename-delete-patch — workaround rename/delete para CLI 1.0.89+ (integrado)
- (Trabajo host-side del user, rama feature/session-rename-delete-patch,
  integrado en esta feature: acp.ts + api/sessions/[id]/route.ts.)
- Diagnóstico: desde 1.0.89 (verificado 1.0.103) los slashes `/rename`/
  `/session rename` responden "Session renamed to: X" SIN efecto (no-op bajo
  ACP) y `/session delete` responde "handled by the CLI host"; no existe
  método ACP oficial (initialize solo declara sessionCapabilities: close+list).
- Workaround (provisional, conmutable): el host gestiona directamente el
  store persistido del CLI — rename edita ~/.copilot/session-state/<id>/
  workspace.yaml (name + user_named=true, mismo write que hace la TUI) y
  delete cierra el driver y borra el dir session-state.
  SESSION_OPS_MODE=slash restaura la vía original por prompt cuando GitHub
  lo repare (issue pendiente).
- E2E verificado contra 1.0.103 vía API web: rename sobrevive a nuevos
  turnos (user_named), delete desaparece de session/list, sesiones ajenas
  intactas.

## v0.1.4 (25/10 19:10+) — fix puntito daemon (config)
- El puntito "ACP daemon running" en SettingsModal usaba `bg-emerald`, que
  cambia con el acento (data-accent: green/lime/teal/cyan/sky). Fijo:
  `bg-green-500` (verde literal, independiente del acento y del tema).
  tsc OK. Los demás bg-emerald (turno en curso sidebar/chat) se mantienen.

## v0.1.3 (25/10 18:35+) — lote UI fixes — CÓDIGO LISTO
Cinco fixes pedidos por el user:
1. Móvil: altura del logo no se salta entre sidebar (py-4) y header de sesión
   (ahora py-4 también; título leading-tight + id a 10px para comprimir).
2. Razonamiento en vivo: se cierra UNO A UNO cuando un segmento termina —
   servidor sella el último reasoning al empezar texto/tool (evento
   reasoning_done con index) + sellado local en delta como respaldo; la UI
   renderiza reasoning done colapsado (open={!p.done}).
3. Mockup del README actualizado (assets/mockup.png, ya en git staged).
4. URLs de mensajes del usuario autolinkeadas (linkify, nueva pestaña).
5. Bloques de código: botón copiar sutil al hover (esquina superior derecha).
Tests: 65/65 (nuevo live.test.ts con sealLastOpenReasoning). tsc OK, build
OK, servidor :3100 relanzado y 200. Daemon :3222 intacto.
Pendiente: squash dev→main + bump package.json + tag v0.1.3 + publicar
(con el user).

## v0.1.2 (25/10) — versión visible de la UI
- El user detecta "v0.0.32" en sidebar/About: leen copilot-web/package.json,
  nunca bumpado (pre-pública era 0.0.32; v0.1.1 publicó tarballs con esa
  versión). Fix: npm version 0.1.2 + lock; 60/60 tests; rebuild + serve
  local OK (bundle con 0.1.2). Nota sandbox: 14 helpers ask-user zombie
  (MCP sin cerrar) dejaban spawn EAGAIN en vitest — kill selectivo
  (NO daemon :3222 ni copilot :continue).
- Publicado: tag v0.1.2 + release (con el user). Checklist release
  (bump package.json antes de taguear) → decisions.md.

## v0.1.1 (24/10 23:40+) — arranque sin clonar + CI — CÓDIGO LISTO
Pide del user: arreglar Quick Start (`git clone <github repo>` sin URL real y
el `npx copilot-web` que nunca existió) + activar el badge de build/test.
- READMEs EN/ES: ruta sin clonar (curl a releases/latest/download/install.sh,
  autocontenido) + git clone con URL real + texto del launcher corregido.
- scripts/install.sh: modo standalone (descarga tarball de latest release si
  no vive en un checkout) + COPILOT_WEB_NO_START=1 opcional.
- .github/workflows/ci.yml: push/PR → npm ci + tsc --noEmit + build + npm test
  (mock ACP). READMEs: badge tests-pending → badge real de Actions.
- Test del bootstrap: curl/API reales OK (la descarga del asset está bloqueada
  por el egress del sandbox → mock con el mismo tarball); npm ci sobre el
  árbol extraído ×2 OK; build de proyecto OK (pids.max=256 del contenedor: el
  config ya usa cpus:1; fallar si /tmp lleno o stack previo vivo).
- Publicado: squash dev→main + tag v0.1.1 + publicar (con el user; release
  success, CI verde). Badges → v0.1.1 (post-release sync).

## Hecho (ciclo v0.1.0 — cerrado)

Ciclo completo ejecutado el 24/10/2026 y verificado end-to-end.

## Hecho
1. Refactor/revisión completa "publish-ready" (028ae46, rama feature/publish-ready,
   fusionada vía squash a dev 2bf063b).
2. Suite de tests con capa ACP mockeada: 60 tests / 8 ficheros (0757317, 9c6d114).
3. Docs consolidadas (1c575cb) + feedback roadmap READMEs (317fd9b) + mockup (8708bc1)
   + títulos "Copilot Web" (98c1d01) + enlace spec ACP (ca96dbe).
4. Repo público bcgrillo/copilot-web publicado con ./publicar.sh: main=e3154bd,
   dev=2bf063b.
5. Release: tag v0.1.0 (sobre dev, decidido por el user) → push a ambos repos →
   workflow release.yml en el público (run 40143153157, **success**) → release
   creada: copilot-web-v0.1.0.tar.gz (116KB) + install.sh assets uploaded.
6. Docs post-release en dev (25a7eed): badges release → v0.1.0, changelog v0.1.0,
   decisions versionado aplicado, todo.md al día.

## Estado ops (v0.1.4 auth — LIVE)
- main :3100 + daemon :3222 (helper MCP token) con auth dual-token.
- cw-back :3103 (APP_MODE=api, CORS codepods origin) y cw-front :3104
  (APP_MODE=front, build ASSET_PREFIX=/api/proxy/copilot-web/cw-front,
  API=/api/proxy/copilot-web/cw-back; fix: prefijos públicos del proxy).
- Verificado E2E: login admin OK, 401 sin token, Bearer 200 (main+back),
  refresh rotación OK, CORS preflight 204.
- Servidor :3100 en /workspace/cw-split es COPIA front-split (sin auth UI).

## Logout (8f6420c, pending re-test user)
- Botón LogOut al final del footer (derecha del toggle de tema), solo con
  authGate==="ok" (auth ON + firmado); limpia tokens y muestra Login.
  i18n footer.logout es/en. tsc OK + 100/100 (12/12, corrida secuencial
  por pid-limit del contenedor) + rebuild/restart verificado.
## Mejoras visuales login (a673730, pending re-test user)
- Login rediseñado (Login.tsx + i18n.tsx es/en): marca (logo + "Copilot
  Web") fuera de la card arriba; título "Sign in" dentro; instrucción con
  copilot-web --help en <code>; labels Username/Password bold fuera de los
  inputs; botón bg-emerald (tema) con icono lucide LogIn; versión sutil
  bajo la card. tsc + suite 100/100 + rebuilds + relanzamiento verificados.

## Pendiente (siguiente tarea)
- Pipeline CI interno pre-beta (lint/tsc/build/test por PR; badges de tests).
- Deuda técnica (SQL/todo.md): base-path-param, check-session-delete-rename,
  queued-turn-messages, basic-auth, session-search, bash-prefix-memory,
  file-edit-diff-view.

## Estado ops
- Server web :3100 vivo en dev (root/about = 200). Daemon ACP :3222 vivo —
  NUNCA tocarlo.
- ./publicar.sh sincroniza lualab → bcgrillo/copilot-web (gitignored, solo local).
- `npx tsc` está ROTO en este entorno (instala tsc@2.0.4) → usar
  ./node_modules/.bin/tsc --noEmit desde copilot-web/.
