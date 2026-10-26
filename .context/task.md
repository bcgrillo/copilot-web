# task.md — Ciclo v0.1.3 (lote UI fixes) + patch rename/delete

## Estado actual (validation + commit patch integrado)
- Tests: 65/65 verde (`vitest run --pool=forks --no-file-parallelism` — los
  workers por defecto agotan threads del cgroup pids.max=256; usar esa forma
  mientras el entorno esté tenso). tsc --noEmit OK.
- Commit `2b78c1a` en feature/v0.1.3-ui-fixes: patch host-side rename/delete
  integrado (acp.ts + route.ts + task/todo). Pushed (checkpoint).

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
