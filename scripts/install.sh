#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1"
    exit 1
  fi
}

need node
need npm
if ! command -v cursor-agent >/dev/null 2>&1 && ! command -v cursor >/dev/null 2>&1 && ! command -v codex >/dev/null 2>&1; then
  echo "Missing required command: cursor-agent, cursor, or codex"
  exit 1
fi

if ! command -v tailscale >/dev/null 2>&1; then
  echo "Tailscale was not found. Install it before using iPhone remote access."
fi

if [ ! -f .env ]; then
  cp .env.example .env
fi

mkdir -p "$HOME/.codex-mobile"/{logs,uploads,tmp}
npm install

echo "Cursor Mobile is installed."
echo "Start it with: npm run dev"
