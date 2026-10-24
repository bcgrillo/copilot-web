
## Deployment
- [ ] base-path-param: aceptar el prefijo público directamente como parámetro
  del launcher (`--base-path <path|url>` en vez de ASSET_PREFIX /
  NEXT_PUBLIC_BASE_PATH en .env.local): el launcher lo inyecta como env en el
  build (`npm run build`) y en el serve. Ver docs/base-path-deployment.md.

## Compatibilidad CLI
- [ ] check-session-delete-rename: comprobar delete y rename de sesión en
  versiones recientes de copilot-cli (probado con 1.0.80 OK, con 1.0.103 KO).
  Aislar qué cambió (flags/API/directorios de sesión) y adaptar el server.

## File edit/creation rendering (estilo CLI)
- [ ] file-edit-diff-view: mostrar creación/edición de ficheros en el chat
  como el CLI — contenido para ficheros nuevos, diff unificado para
  ediciones, colapsable junto a los chips de tool actuales.
