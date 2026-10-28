#!/bin/sh
# copilot-web — beta installer
# Runs in two ways:
#   1. inside a checkout (scripts/install.sh): installs dependencies, builds
#      the Next.js app and starts the single-command launcher.
#   2. standalone (only install.sh downloaded from a release): fetches the
#      latest release tarball on its own, then continues like (1).
# Set COPILOT_WEB_NO_START=1 to install and build without starting.
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
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

# --- standalone bootstrap ---------------------------------------------------
# Outside a checkout? Download the latest release tarball next to the script
# and keep going with the extracted tree.
if [ ! -f "$APP/package.json" ]; then
  if ! command -v curl >/dev/null 2>&1; then
    echo "error: curl is required to download copilot-web outside a checkout" >&2
    exit 1
  fi
  echo "[copilot-web] no local copy found — fetching the latest release tarball"
  RELEASE_JSON="$(curl -fsSL https://api.github.com/repos/bcgrillo/copilot-web/releases/latest)"
  TARBALL_URL="$(printf '%s\n' "$RELEASE_JSON" |
    grep -o '"browser_download_url": *"[^"]*/copilot-web-[^"]*\.tar\.gz"' |
    head -n 1 | sed 's/.*"browser_download_url": *"//; s/"$//')"
  if [ -z "$TARBALL_URL" ]; then
    echo "error: could not find a tarball in the latest release" >&2
    exit 1
  fi
  echo "[copilot-web] downloading $TARBALL_URL"
  curl -fsSL "$TARBALL_URL" | tar -xzf - -C "$SCRIPT_DIR"
  ROOT="$SCRIPT_DIR"
  APP="$ROOT/copilot-web"
fi

# --- install & build -------------------------------------------------------
cd "$APP"
if [ -f package-lock.json ]; then
  npm ci --no-audit --no-fund
else
  npm install --no-audit --no-fund
fi

npm run build

# --- CLI on PATH (best effort) ---------------------------------------------
# The launcher doubles as a CLI (users, --no-auth, --port, ...). Put it on
# PATH so `copilot-web --add-user admin` works without a global npm install.
CLI_DIR="$HOME/.local/bin"
mkdir -p "$CLI_DIR" 2>/dev/null
if ln -sf "$APP/bin/copilot-web.mjs" "$CLI_DIR/copilot-web" 2>/dev/null; then
  echo "[copilot-web] CLI: $CLI_DIR/copilot-web (--help for options)"
  case ":$PATH:" in
    *":$CLI_DIR:"*) : ;;
    *) echo "[copilot-web] note: add \"$CLI_DIR\" to PATH to use \`copilot-web\` anywhere" ;;
  esac
else
  echo "[copilot-web] CLI: node $APP/bin/copilot-web.mjs --help"
fi

echo
echo "[copilot-web] built. starting launcher (web :3100 + daemon :3222)"
echo "[copilot-web] press Ctrl+C to stop; restart any time with: npm run serve"
echo

# --- run --------------------------------------------------------------------
if [ "${COPILOT_WEB_NO_START:-0}" = "1" ]; then
  echo "[copilot-web] COPILOT_WEB_NO_START=1 — skipping launcher, run 'npm run serve'"
  exit 0
fi
exec npm run serve