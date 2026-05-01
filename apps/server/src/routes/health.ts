import { Router } from "express";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { appConfig, getProxyEnvironment, resolveAgentCommand, resolveBindHost, resolveTailscaleIp } from "../config/env.js";
import { getModelCatalog } from "../services/modelService.js";

const execFileAsync = promisify(execFile);
export const healthRouter = Router();

async function command(command: string, args: string[]) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { timeout: 3000 });
    return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error: any) {
    return { ok: false, error: error?.message || String(error) };
  }
}

healthRouter.get("/", async (_req, res) => {
  const proxyEnv = getProxyEnvironment();
  const agentCommand = await resolveAgentCommand();
  const [agentRuntime, tailscaleIp, launchAgent, models, resolvedBind] = await Promise.all([
    command(agentCommand, ["--version"]),
    resolveTailscaleIp(),
    command("launchctl", ["print", `gui/${process.getuid?.()}/com.chen.cursor-mobile`]),
    getModelCatalog(),
    resolveBindHost(),
  ]);
  res.json({
    service: {
      ok: true,
      port: appConfig.port,
      bind: appConfig.bind,
      resolvedBind,
      url: `http://${resolvedBind}:${appConfig.port}`,
      dataHome: appConfig.dataHome,
      maxConcurrentTasks: appConfig.maxConcurrentTasks,
      engine: appConfig.engine,
    },
    agentRuntime,
    agentCommand,
    codex: agentRuntime,
    codexCommand: agentCommand,
    tailscale: tailscaleIp ? { ok: true, stdout: tailscaleIp, stderr: "" } : { ok: false, error: "Tailscale IP unavailable" },
    launchAgent,
    proxy: {
      HTTPS_PROXY: Boolean(proxyEnv.HTTPS_PROXY),
      HTTP_PROXY: Boolean(proxyEnv.HTTP_PROXY),
      ALL_PROXY: Boolean(proxyEnv.ALL_PROXY),
      NO_PROXY: proxyEnv.NO_PROXY,
    },
    models: {
      ok: Array.isArray(models.models),
      count: Array.isArray(models.models) ? models.models.length : 0,
      default: models.models?.[0]?.slug,
      source: models.source,
      cached: Boolean(models.cached),
      usingFallback: Boolean(models.usingFallback),
      error: models.error,
    },
  });
});
