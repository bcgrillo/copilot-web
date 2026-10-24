
# todo.md

## Próximos pasos (con el usuario)
- [x] merge dev: usuario squash-mergea feature/publish-ready (hecho 24/10,
  squash 2bf063b) + main (Dev to Main: Checkpoint 2, e3154bd).
- [x] publish: primera subida al repo público bcgrillo/copilot-web (main+dev,
  e3154bd/2bf063b) con ./publicar.sh.
- [x] release v0.1.0: tag en dev, workflow release.yml en el repo público
  (tarball + gh release --generate-notes). Badges READMEs a v0.1.0.
- [x] pipeline CI (GitHub Actions): ci.yml con tsc/build/vitest (mock ACP) en
  push y PR; badge real en los READMEs (antes "tests-pending").
- [x] quick start READMEs: ruta sin clonar (install.sh standalone) + git clone
  con URL real; fuera el npx falso. → v0.1.1 (publicar).
- [x] release v0.1.1: squash dev→main (b85d12d) + tag + publicar — release
  success en repo público (tarball + install.sh standalone); CI verde
  (main+dev). Bug de publicar.sh corregido (--tags → refs explícitas).
- [ ] limpieza ramas lualab-xyz: quedan origin/checkpoint-24-10-2026 y
  origin/feature/mcp-helper (candidatas a borrar).

## Deployment
- [ ] base-path-param: aceptar el prefijo público directamente como parámetro
  del launcher (`--base-path <path|url>` en vez de ASSET_PREFIX /
  NEXT_PUBLIC_BASE_PATH en .env.local): el launcher lo inyecta como env en el
  build (`npm run build`) y en el serve. Ver docs/base-path-deployment.md.

## Compatibilidad CLI
- [ ] check-session-delete-rename: comprobar delete y rename de sesión en
  versiones recientes de copilot-cli (probado con 1.0.80 OK, con 1.0.103 KO).
  Aislar qué cambió (flags/API/directorios de sesión) y adaptar el server.

## Roadmap público (readme)
- [ ] basic-auth: login single-user para la web (authN/authZ).
- [ ] session-search: filtrar sesiones por título desde la sidebar.
- [ ] queued-turn-messages: permitir escribir mensajes MIENTRAS corre un turno:
  se encolan y se intercalan en el flujo en curso, como en el Copilot CLI (no
  es mostrar eventos en línea — es envío concurrente de mensajes encolados).
- [ ] bash-prefix-memory: memoria de prefijos de shell aprobados con
  `allow_always`, por sesión, para no re-preguntar por cada comando exacto.

## File edit/creation rendering (estilo CLI)
- [ ] file-edit-diff-view: mostrar creación/edición de ficheros en el chat
  como el CLI — contenido para ficheros nuevos, diff unificado para
  ediciones, colapsable junto a los chips de tool actuales.
