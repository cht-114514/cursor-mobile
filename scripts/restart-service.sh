#!/usr/bin/env bash
set -euo pipefail

LABEL="com.chen.cursor-mobile"
launchctl kickstart -k "gui/$UID/${LABEL}"
echo "Restarted ${LABEL}"
echo "Run scripts/status-service.sh or open /api/health to see the current resolved URL."
