#!/usr/bin/env bash
set -euo pipefail

PORT="${CODEX_MOBILE_PORT:-8787}"
PIDS="$(lsof -ti "tcp:${PORT}" 2>/dev/null || true)"

if [ -z "$PIDS" ]; then
  echo "No process is listening on port ${PORT}."
  exit 0
fi

echo "Processes listening on port ${PORT}:"
echo "$PIDS"
echo "Stopping them now."
kill $PIDS
