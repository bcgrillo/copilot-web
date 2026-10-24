# task.md — Public-ready: refactor + tests + docs (feature/publish-ready)

Rama `feature/publish-ready` (desde origin/dev 2f9a150). Objetivo: dejar el
proyecto listo para publicar y luego (CON el usuario) merge a dev, publicación,
pipeline y release.

## Frente 1 — Refactor/revisión completa — HECHO (028ae46)
- Comentarios EN en todos los ficheros; strings del server EN (dict es/es del
  i18n intacto: es contenido del producto).
- Nombres/estructura revisados; `lib/content.ts` (textOfParts, toolInputDetail,
  cleanToolOutput… compartido live/hidratación) y `lib/limits.ts` nuevos.
- 8 deps sin uso eliminadas; `npm install` regeneró el lockfile.
- Fix: chat/route.ts quedó roto a mitad de edición en la sesión previa —
  reparado (bloque tool_call_update + cierre de `if (detail)`).
- tsc limpio; build limpio; server re-verificado (/, /about, /api/sessions).

## Frente 2 — Suite de tests con capa ACP mockeada — HECHO (0757317, 9c6d114)
- `npm run test` = vitest run (vitest.config.ts: alias `@`, entorno node).
- 60 tests / 8 ficheros, todos verdes, tsc limpio:
  - lib: materialize, content, store, copilotStore, helperAsk, cw, api, accents.
  - api/chat route: validación (404/400/429+pending, adjuntos), orden de
    eventos SSE, replay+Info filters, cards permiso, guard 20 s (fake timers).
- La capa ACP SIEMPRE mockeada (`vi.mock("@/lib/acp")`): los tests no tocan
  el daemon :3222 ni sesiones reales del CLI.
- Bug real corregido por los tests: `isObj` daba `""` con arrays de bloques
  (content.ts + materialize.ts); `textContentOf` acepta strings.

## Frente 3 — Documentación consolidada — HECHO (esta sesión)
- design.md: sección Tests + notas MCP helper fusionado (fuera la rama vieja).
- decisions.md: decisión Testing (mock ACP); notas de rama feature/mcp-helper
  retiradas (fusionada en dev).
- changelog.md: entrada v0.0.33 (sin publicar): refactor + suite + deps.
- README: badge tests (pendiente de CI) y roadmap ya lo mencionaban; sin
  cambios de fondo.

## Siguiente (con el usuario, NO hacer sin confirmar)
1. Aviso de feature lista → merge a dev (squash, con el user).
2. Publicación + pipeline CI (lint/tsc/build/test) + release v0.0.33.
3. Todo abierto relevante: base-path-param, check delete/rename en CLI nuevas,
   file-edit-diff-view, búsqueda de sesiones, eventos intercalados (todo.md).

## Estado ops
- Server web :3100 vivo (build + restart verificados al cierre del frente 1).
- Daemon :3222 vivo — NUNCA tocarlo/matarlo desde tareas.
- Ritual: matar solo PIDs del web-server; `set -a && source .env.local && set +a &&
  npm run build`; relanzar con `npm run serve -- --no-daemon --cwd /workspace
  --model default` desde copilot-web; curl / y /about = 200.
- `npx tsc` está ROTADO en este entorno (instala tsc@2.0.4) → usar
  `./node_modules/.bin/tsc --noEmit`.
