#!/usr/bin/env bash
set -euo pipefail

LABEL="com.chen.cursor-mobile"
launchctl print "gui/$UID/${LABEL}"
