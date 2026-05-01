import { config as loadDotenv } from "dotenv";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { execFileSync } from "node:child_process";

const execFileAsync = promisify(execFile);
const rootEnv = path.resolve(process.cwd(), "../../.env");
const tailscaleCandidates = ["tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"];
loadDotenv({ path: rootEnv });
loadDotenv();

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.floor(parsed);
}

export const appConfig = {
  port: positiveInteger(process.env.CODEX_MOBILE_PORT, 8787),
  bind: process.env.CODEX_MOBILE_BIND || "auto",
  webOrigin: process.env.CODEX_MOBILE_WEB_ORIGIN || "http://localhost:5173",
  dataHome:
    process.env.CODEX_MOBILE_HOME ||
    path.join(os.homedir(), ".codex-mobile"),
  homeDir: os.homedir(),
  maxConcurrentTasks: positiveInteger(process.env.CODEX_MOBILE_MAX_TASKS, 3),
  engine: (process.env.CODEX_MOBILE_ENGINE || "cursor") as "codex" | "cursor",
};

export async function resolveTailscaleIp(): Promise<string | undefined> {
  for (const command of tailscaleCandidates) {
    try {
      const { stdout } = await execFileAsync(command, ["ip", "-4"], {
        timeout: 1500,
      });
      const ip = stdout.trim().split(/\s+/)[0];
      if (ip) return ip;
    } catch {
      // Try the next common installation path.
    }
  }
  return undefined;
}

export function tailscaleCommand(): string {
  return tailscaleCandidates[0];
}

export async function resolveCodexCommand(): Promise<string> {
  const codexCandidates = [
    process.env.CODEX_MOBILE_CODEX_BIN,
    "codex",
    "/Applications/Codex.app/Contents/Resources/codex",
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
    path.join(os.homedir(), ".local/bin/codex"),
    path.join(os.homedir(), ".codex/bin/codex"),
  ].filter(Boolean) as string[];

  for (const command of codexCandidates) {
    try {
      const { stdout } = await execFileAsync(command, ["--version"], {
        timeout: 3000,
      });
      if (stdout.trim()) return command;
    } catch {
      // Try the next common install path.
    }
  }
  return process.env.CODEX_MOBILE_CODEX_BIN || "codex";
}

export async function resolveCursorCommand(): Promise<string> {
  const cursorCandidates = [
    process.env.CODEX_MOBILE_CURSOR_BIN,
    "cursor-agent",
    "cursor",
    "/opt/homebrew/bin/cursor-agent",
    "/usr/local/bin/cursor-agent",
    path.join(os.homedir(), ".local/bin/cursor-agent"),
  ].filter(Boolean) as string[];

  for (const command of cursorCandidates) {
    try {
      const { stdout } = await execFileAsync(command, ["--version"], {
        timeout: 3000,
      });
      if (stdout.trim()) return command;
    } catch {
      // Try the next common install path.
    }
  }
  return process.env.CODEX_MOBILE_CURSOR_BIN || "cursor-agent";
}

export async function resolveAgentCommand(): Promise<string> {
  return appConfig.engine === "cursor" ? resolveCursorCommand() : resolveCodexCommand();
}

export async function resolveBindHost(): Promise<string> {
  if (appConfig.bind !== "auto") return appConfig.bind;
  try {
    const ip = await resolveTailscaleIp();
    if (ip) return ip;
  } catch {
    return "127.0.0.1";
  }
  return "127.0.0.1";
}

function readProxyValue(text: string, key: string): string | undefined {
  const match = text.match(new RegExp(`${key}\\s*:\\s*(.+)`));
  return match?.[1]?.trim();
}

export function getProxyEnvironment(): NodeJS.ProcessEnv {
  const existingHttps = process.env.HTTPS_PROXY || process.env.https_proxy;
  const existingHttp = process.env.HTTP_PROXY || process.env.http_proxy;
  const existingAll = process.env.ALL_PROXY || process.env.all_proxy;
  if (existingHttps || existingHttp || existingAll) {
    return {
      HTTPS_PROXY: existingHttps,
      HTTP_PROXY: existingHttp,
      ALL_PROXY: existingAll,
      NO_PROXY: process.env.NO_PROXY || process.env.no_proxy || "127.0.0.1,localhost,*.local",
    };
  }

  try {
    const text = execFileSync("scutil", ["--proxy"], { encoding: "utf8", timeout: 1500 });
    const httpsEnabled = readProxyValue(text, "HTTPSEnable") === "1";
    const httpEnabled = readProxyValue(text, "HTTPEnable") === "1";
    const socksEnabled = readProxyValue(text, "SOCKSEnable") === "1";
    const httpsHost = readProxyValue(text, "HTTPSProxy");
    const httpsPort = readProxyValue(text, "HTTPSPort");
    const httpHost = readProxyValue(text, "HTTPProxy");
    const httpPort = readProxyValue(text, "HTTPPort");
    const socksHost = readProxyValue(text, "SOCKSProxy");
    const socksPort = readProxyValue(text, "SOCKSPort");
    return {
      HTTPS_PROXY: httpsEnabled && httpsHost && httpsPort ? `http://${httpsHost}:${httpsPort}` : undefined,
      HTTP_PROXY: httpEnabled && httpHost && httpPort ? `http://${httpHost}:${httpPort}` : undefined,
      ALL_PROXY: socksEnabled && socksHost && socksPort ? `socks5://${socksHost}:${socksPort}` : undefined,
      NO_PROXY: "127.0.0.1,localhost,*.local",
    };
  } catch {
    return {};
  }
}
