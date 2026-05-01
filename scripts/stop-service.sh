#!/usr/bin/env bash
set -euo pipefail

LABEL="com.chen.cursor-mobile"
launchctl bootout "gui/$UID/${LABEL}" >/dev/null 2>&1 || true
echo "Stopped ${LABEL}"
