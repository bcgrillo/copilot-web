# Deploying behind a path prefix (CodePods-style proxy)

You can publish copilot-web under a URL path instead of `/`, e.g. when a reverse
proxy strips a public prefix before reaching the Next.js server:

```
browser → https://host/api/proxy/copilot-web/copilot-web/...  (public URL)
        → proxy strips prefix → http://localhost:3100/...     (server URL)
```

## The three moving parts

| Piece | Where | Value in this repo (CodePods) |
| --- | --- | --- |
| `ASSET_PREFIX` | `.env.local` → next.config.ts `assetPrefix` | `https://codepods.brunogrillo.dev/api/proxy/copilot-web/copilot-web` (absolute) |
| `NEXT_PUBLIC_BASE_PATH` | `.env.local` → client fetches (`src/lib/api.ts`) and `<head>` links (favicon, `src/app/layout.tsx`) | `/api/proxy/copilot-web/copilot-web` (path only) |
| `trailingSlash: true` | next.config.ts | canonicalizes URLs with a final slash so the proxy never sees redirects (which it cannot resolve) |

The server routes always stay at root — the proxy **strips** the prefix before
forwarding. Only the browser needs to see full prefixed URLs:

- `/_next/*` assets → prefixed via `assetPrefix`.
- Client-side `fetch("/api/...")` calls → prefixed via `BASE` in `src/lib/api.ts`
  (`process.env.NEXT_PUBLIC_BASE_PATH ?? ""`).
- Links emitted into `<head>` (`favicon.svg`) → prefixed manually with
  `NEXT_PUBLIC_BASE_PATH` in `src/app/layout.tsx` (Next's App Router would emit
  root-relative `href`s that 404 behind the proxy).

## Gotchas (learned the hard way)

1. **`NEXT_PUBLIC_*` variables are baked at build time.** If the build ran
   without them, the client keeps requesting root URLs. Write `.env.local`
   first, then run `npm run build` (or start the launcher with `--build`).
   Changing the prefix later requires a rebuild.
2. **The value must match the proxy route.** With CodePods the public path
   follows the service name (`open_service` name → `/api/proxy/<name>/<name>`).
   `ASSET_PREFIX` is absolute (browser resolves it against the host);
   `NEXT_PUBLIC_BASE_PATH` is just the path.
3. **API endpoints need the trailing slash when testing**: Next's
   `trailingSlash: true` turns `GET /api/sessions` into a 308 redirect to
   `/api/sessions/`, and some HTTP clients/proxies do not follow it.
4. The **daemon is unaffected**: it is plain TCP (JSON-RPC) on :3222, never
   exposed through the HTTP proxy.

## Checklist

```bash
cd copilot-web
cat > .env.local <<'EOF'
ASSET_PREFIX=https://myhost.example.com/mypath
NEXT_PUBLIC_BASE_PATH=/mypath
EOF
npm run build
npm run serve             # or the launcher; proxies must strip /mypath
curl -sI http://localhost:3100/                    # local: 200 (no prefix server-side)
curl -sI https://myhost.example.com/mypath/api/sessions/  # proxy: 200, prefixed OK
```