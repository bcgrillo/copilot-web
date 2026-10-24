#!/bin/sh
# copilot-web — beta installer
# Installs dependencies, builds the Next.js app and starts
# the single-command launcher (ACP daemon + web server).
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/copilot-web"

# --- checks ---------------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  echo "error: Node.js is required (>= 20). Install it from https://nodejs.org" >&2
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "error: Node.js >= 20 required (found $(node -v))" >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "error: npm is required (ships with Node.js)" >&2
  exit 1
fi
if ! command -v copilot >/dev/null 2>&1; then
  echo "warning: 'copilot' CLI not found in PATH." >&2
  echo "         Install GitHub Copilot CLI and authenticate (npm i -g @github/copilot)." >&2
  echo "         The web UI will start, but no ACP daemon can be spawned." >&2
fi

# --- install & build -------------------------------------------------------
cd "$APP"
if [ -f package-lock.json ]; then
  npm ci --no-audit --no-fund
else
  npm install --no-audit --no-fund
fi

npm run build

echo
echo "[copilot-web] built. starting launcher (web :3100 + daemon :3222)"
echo "[copilot-web] press Ctrl+C to stop; restart any time with: npm run serve"
echo

# --- run --------------------------------------------------------------------
exec npm run serve