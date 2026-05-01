import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

async function makeExecutable(filePath: string, body: string) {
  await fs.writeFile(filePath, body, "utf8");
  await fs.chmod(filePath, 0o755);
}

async function waitForJson(url: string, timeoutMs = 3000): Promise<any> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function waitForAssistantMessage(url: string, content: string, timeoutMs = 3000): Promise<any> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const data = await waitForJson(url, timeoutMs);
    if (data.messages?.some((message: any) => message.content === content)) return data;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(`Timed out waiting for assistant message ${content}`);
}

async function postJson(url: string, body: unknown): Promise<any> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(response.ok).toBe(true);
  return response.json();
}

let child: ChildProcessWithoutNullStreams | undefined;
let cleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    await new Promise((resolve) => child?.once("exit", resolve));
  }
  child = undefined;
  await cleanup?.();
  cleanup = undefined;
});

describe("server smoke", () => {
  it("starts with a temp home and runs a basic chat lifecycle", async () => {
    const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cursor-mobile-smoke-"));
    const dataHome = path.join(tempRoot, "data");
    const binDir = path.join(tempRoot, "bin");
    await fs.mkdir(binDir, { recursive: true });
    await makeExecutable(path.join(binDir, "codex"), `#!/usr/bin/env bash
if [ "\${1:-}" = "--version" ]; then printf 'fake-codex\\n'; exit 0; fi
if [ "\${1:-}" = "debug" ]; then printf '{"models":[{"slug":"gpt-5.5","display_name":"GPT-5.5"}]}\\n'; exit 0; fi
cat >/dev/null
printf '{"type":"session.created","session_id":"smoke-session"}\\n'
printf '{"type":"item.completed","item":{"type":"agent_message","text":"smoke ok"}}\\n'
`);
    cleanup = () => fs.rm(tempRoot, { recursive: true, force: true });

    const port = 19000 + Math.floor(Math.random() * 1000);
    child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
      cwd: serverRoot,
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        CODEX_MOBILE_CODEX_BIN: path.join(binDir, "codex"),
        CODEX_MOBILE_ENGINE: "codex",
        CODEX_MOBILE_HOME: dataHome,
        CODEX_MOBILE_BIND: "127.0.0.1",
        CODEX_MOBILE_PORT: String(port),
      },
    });

    const base = `http://127.0.0.1:${port}`;
    const projects = await waitForJson(`${base}/api/projects`);
    expect(projects.projects).toHaveLength(1);

    const health = await waitForJson(`${base}/api/health`);
    expect(health.service.url).toBe(base);
    expect(health.codex.ok).toBe(true);
    expect(health.models.usingFallback).toBe(false);

    const sent = await postJson(`${base}/api/chat/send`, {
      projectId: projects.projects[0].id,
      prompt: "smoke",
      model: "gpt-5.5",
      effort: "medium",
    });
    expect(sent.run.status).toBe("queued");

    const messages = await waitForAssistantMessage(`${base}/api/sessions/${sent.session.id}/messages`, "smoke ok");
    expect(messages.messages.map((message: any) => message.content)).toContain("smoke ok");
  });
});
