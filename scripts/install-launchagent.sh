#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.chen.cursor-mobile"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
LOG_DIR="$HOME/.codex-mobile/logs"
RUNTIME_DIR="${CODEX_MOBILE_RUNTIME_DIR:-$HOME/.codex-mobile/runtime}"
RUNTIME_RUNNER="$HOME/.codex-mobile/run-launchagent.sh"
PORT="${CODEX_MOBILE_PORT:-8787}"
ENGINE="${CODEX_MOBILE_ENGINE:-cursor}"
CURSOR_BIN="${CODEX_MOBILE_CURSOR_BIN:-}"

tailscale_ip() {
  if command -v tailscale >/dev/null 2>&1; then
    tailscale ip -4 2>/dev/null | awk 'NR==1 {print $1}'
  elif [ -x "/Applications/Tailscale.app/Contents/MacOS/Tailscale" ]; then
    /Applications/Tailscale.app/Contents/MacOS/Tailscale ip -4 2>/dev/null | awk 'NR==1 {print $1}'
  fi
}

TAILSCALE_IP="$(tailscale_ip || true)"
if [ -n "${CODEX_MOBILE_BIND:-}" ]; then
  BIND="${CODEX_MOBILE_BIND}"
elif [ -n "$TAILSCALE_IP" ]; then
  BIND="$TAILSCALE_IP"
else
  BIND="auto"
fi

if [ -n "${CODEX_MOBILE_WEB_ORIGIN:-}" ]; then
  WEB_ORIGIN="${CODEX_MOBILE_WEB_ORIGIN}"
elif [ -n "$TAILSCALE_IP" ]; then
  WEB_ORIGIN="http://${TAILSCALE_IP}:${PORT}"
else
  WEB_ORIGIN="http://127.0.0.1:${PORT}"
fi

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR" "$RUNTIME_DIR/apps/server" "$RUNTIME_DIR/apps/web"

if [ ! -d "$ROOT_DIR/apps/server/dist" ] || [ ! -d "$ROOT_DIR/apps/web/dist" ]; then
  echo "Missing built assets. Run npm run build before installing the service."
  exit 1
fi

rsync -a --delete "$ROOT_DIR/apps/server/dist/" "$RUNTIME_DIR/apps/server/dist/"
rsync -a --delete "$ROOT_DIR/apps/web/dist/" "$RUNTIME_DIR/apps/web/dist/"
rsync -a --delete "$ROOT_DIR/node_modules/" "$RUNTIME_DIR/node_modules/"
cp "$ROOT_DIR/package.json" "$RUNTIME_DIR/package.json"
cp "$ROOT_DIR/apps/server/package.json" "$RUNTIME_DIR/apps/server/package.json"

cat > "$RUNTIME_RUNNER" <<RUNNER
#!/usr/bin/env bash
set -euo pipefail

cd "$RUNTIME_DIR"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:\${PATH:-}"
export CODEX_MOBILE_PORT="\${CODEX_MOBILE_PORT:-${PORT}}"
export CODEX_MOBILE_BIND="\${CODEX_MOBILE_BIND:-${BIND}}"
export CODEX_MOBILE_WEB_ORIGIN="\${CODEX_MOBILE_WEB_ORIGIN:-${WEB_ORIGIN}}"
export CODEX_MOBILE_ENGINE="\${CODEX_MOBILE_ENGINE:-${ENGINE}}"
export CODEX_MOBILE_CURSOR_BIN="\${CODEX_MOBILE_CURSOR_BIN:-${CURSOR_BIN}}"

exec node apps/server/dist/index.js
RUNNER
chmod +x "$RUNTIME_RUNNER"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${RUNTIME_RUNNER}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${RUNTIME_DIR}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/service.out.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/service.err.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>CODEX_MOBILE_PORT</key>
    <string>${PORT}</string>
    <key>CODEX_MOBILE_BIND</key>
    <string>${BIND}</string>
    <key>CODEX_MOBILE_WEB_ORIGIN</key>
    <string>${WEB_ORIGIN}</string>
    <key>CODEX_MOBILE_ENGINE</key>
    <string>${ENGINE}</string>
    <key>CODEX_MOBILE_CURSOR_BIN</key>
    <string>${CURSOR_BIN}</string>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
</dict>
</plist>
PLIST

launchctl bootout "gui/$UID" "$PLIST" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$UID" "$PLIST"
launchctl kickstart -k "gui/$UID/${LABEL}"

echo "Cursor Mobile LaunchAgent installed at ${PLIST}"
echo "Runtime staged at ${RUNTIME_DIR}"
echo "URL: ${WEB_ORIGIN}"
if [ "$BIND" = "auto" ]; then
  echo "Tailscale IP was unavailable during install; the service will resolve its bind host at startup."
fi
