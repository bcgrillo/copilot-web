#!/bin/bash
# Reinicia el daemon ACP sin drivers previos: pasa a ser OWNER de las sesiones
# y sirve la web directamente (sin reenviar al CLI). Úsalo tras cerrar el CLI.
set -a; source /workspace/copilot-web/.env.local; set +a
pkill -f "copilot --acp" 2>/dev/null; sleep 1
nohup copilot --acp --port 3222 > /tmp/acp-daemon.log 2>&1 &
sleep 2
(echo > /dev/tcp/127.0.0.1/3222) && echo "ACP daemon arriba (owner limpio)"
