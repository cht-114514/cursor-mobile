#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
export CODEX_MOBILE_PORT="${CODEX_MOBILE_PORT:-8787}"
export CODEX_MOBILE_BIND="${CODEX_MOBILE_BIND:-auto}"
export CODEX_MOBILE_ENGINE="${CODEX_MOBILE_ENGINE:-cursor}"

tailscale_ip() {
  if command -v tailscale >/dev/null 2>&1; then
    tailscale ip -4 2>/dev/null | awk 'NR==1 {print $1}'
  elif [ -x "/Applications/Tailscale.app/Contents/MacOS/Tailscale" ]; then
    /Applications/Tailscale.app/Contents/MacOS/Tailscale ip -4 2>/dev/null | awk 'NR==1 {print $1}'
  fi
}

if [ -z "${CODEX_MOBILE_WEB_ORIGIN:-}" ]; then
  TAILSCALE_IP="$(tailscale_ip || true)"
  if [ -n "$TAILSCALE_IP" ]; then
    export CODEX_MOBILE_WEB_ORIGIN="http://${TAILSCALE_IP}:${CODEX_MOBILE_PORT}"
  elif [ "$CODEX_MOBILE_BIND" != "auto" ]; then
    export CODEX_MOBILE_WEB_ORIGIN="http://${CODEX_MOBILE_BIND}:${CODEX_MOBILE_PORT}"
  else
    export CODEX_MOBILE_WEB_ORIGIN="http://127.0.0.1:${CODEX_MOBILE_PORT}"
  fi
fi

exec npm run start
