# task.md — Publicación v0.1.0 (beta oficial) — CERRADA

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
