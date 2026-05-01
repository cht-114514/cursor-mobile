# Cursor Mobile

Cursor Mobile is a local-first mobile companion for running Cursor Agent or Codex tasks on a Mac from an iPhone. It gives you a chat-first PWA, project/session history, file browsing, diagnostics, and a small macOS menu bar companion while keeping execution on your own machine.

The intended access model is private network first: run the service on your Mac, reach it from your iPhone over Tailscale, and avoid exposing agent control to the public internet.

## Features

- Mobile-first PWA for iPhone with chat, projects, sessions, attachments, files, and diagnostics.
- Local Mac service built with Node.js, TypeScript, Express, WebSocket, and SQLite.
- Cursor Agent support by default, with Codex support still available through the same task runner.
- Structured streaming from agent JSON events instead of terminal scraping.
- SwiftUI menu bar companion source for starting/stopping the local service and opening the mobile URL.
- Safety defaults for local files, hidden sensitive paths, and non-interactive agent runs.

## Architecture

```text
iPhone PWA  <---- Tailscale/private LAN ---->  Mac Node service  ---->  cursor-agent or codex
                                              |
                                              +---- SQLite index in ~/.codex-mobile
                                              +---- local project files under $HOME
```

The web app is served by the Mac service in production-style runs. During development, Vite serves the web UI and the server exposes the API/WebSocket layer.

## Requirements

- macOS
- Node.js 22 or newer
- npm 10 or newer
- Cursor CLI/agent (`cursor-agent` or `cursor`) or Codex CLI (`codex`)
- Tailscale for iPhone access outside localhost

## Quick Start

```sh
git clone https://github.com/chen/cursor-mobile.git
cd cursor-mobile
bash scripts/install.sh
npm run dev
```

The service prefers the Mac's Tailscale IPv4 address when `CODEX_MOBILE_BIND=auto`. If Tailscale is unavailable, it falls back to `127.0.0.1`.

## Production-Style Local Run

```sh
npm run build
npm run start
```

Open this URL from your iPhone after connecting both devices to the same Tailscale network:

```text
http://<tailscale-ip>:8787
```

You can check the Mac's Tailscale IP with:

```sh
tailscale ip -4
```

For a persistent macOS user service:

```sh
npm run build
npm run service:install
```

After pulling updates:

```sh
npm run build
npm run service:restart
```

## Configuration

Configuration is read from environment variables or `.env`.

```sh
CODEX_MOBILE_BIND=auto
CODEX_MOBILE_PORT=8787
CODEX_MOBILE_WEB_ORIGIN=http://localhost:5173
CODEX_MOBILE_HOME=
CODEX_MOBILE_ENGINE=cursor
CODEX_MOBILE_CURSOR_BIN=
HTTPS_PROXY=
ALL_PROXY=
```

The `CODEX_MOBILE_` prefix is retained for compatibility with the original local prototype.

## Safety Defaults

- App data lives in `~/.codex-mobile`.
- Agent data stays in the agent's own home directory, such as `~/.codex` for Codex.
- Up to 3 agent tasks run concurrently.
- A single session can only have one active run at a time.
- Chat sends use `approvalPolicy=never` by default so non-interactive runs do not hang on approvals.
- File management is rooted at `$HOME`.
- Sensitive paths such as `.ssh`, `.env`, key files, and hidden config folders are hidden by default.
- Deletes go to the macOS Trash when possible, with a safe `~/.Trash` fallback.

## Development

```sh
npm install
npm run dev
npm test
npm run build
```

Workspace layout:

- `apps/server` - TypeScript API, WebSocket hub, SQLite storage, and agent runner.
- `apps/web` - React/Vite mobile PWA.
- `apps/menubar` - SwiftUI menu bar companion source.
- `scripts` - install, launchd, and service helper scripts.

## Current Limitations

- This is an early local-first project and has not been hardened for public internet exposure.
- The menu bar companion is source-first and assumes local Node/npm/Cursor/Codex/Tailscale installs.
- Authentication is intentionally minimal because Tailscale/private network access is the expected boundary.

## License

MIT
