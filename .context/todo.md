
# todo.md

## Próximos pasos (con el usuario)
- [ ] merge dev: usuario squash-mergea feature/publish-ready cuando confirme
  que está todo listo (refactor + tests + docs).
- [ ] publish: primera subida al repo público bcgrillo/copilot-web (existe,
  vacío, accesible) con `./publicar.sh` cuando el usuario dé el ok, y después
  pipe + release allí (release.yml ya funciona tal cual).
- [ ] pipeline CI (GitHub Actions): lint/tsc/build/test en cada PR — SOLO
  interno, no va en el README público; se hace antes de la beta.

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
