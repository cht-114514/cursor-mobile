import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function makeExecutable(filePath: string, body: string) {
  await fs.writeFile(filePath, body, "utf8");
  await fs.chmod(filePath, 0o755);
}

async function waitFor(getStatus: () => string | undefined, expected: string, timeoutMs = 1600) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (getStatus() === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  expect(getStatus()).toBe(expected);
}

async function setup(script: string, maxTasks = "3", engine = "codex") {
  vi.resetModules();
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cursor-mobile-runner-"));
  const dataHome = path.join(tempRoot, "data");
  const projectDir = path.join(tempRoot, "project");
  const binDir = path.join(tempRoot, "bin");
  await fs.mkdir(projectDir, { recursive: true });
  await fs.mkdir(binDir, { recursive: true });
  await makeExecutable(path.join(binDir, "codex"), script);

  process.env.CODEX_MOBILE_HOME = dataHome;
  process.env.CODEX_MOBILE_MAX_TASKS = maxTasks;
  process.env.CODEX_MOBILE_CODEX_BIN = path.join(binDir, "codex");
  process.env.CODEX_MOBILE_CURSOR_BIN = path.join(binDir, "codex");
  process.env.CODEX_MOBILE_ENGINE = engine;
  process.env.PATH = `${binDir}:${process.env.PATH}`;

  const database = await import("../src/db/database.js");
  const runner = await import("../src/services/codexRunner.js");
  return { ...database, ...runner, tempRoot, projectDir };
}

let cleanup: (() => Promise<void>) | undefined;
const originalPath = process.env.PATH;

beforeEach(() => {
  cleanup = undefined;
});

afterEach(async () => {
  await cleanup?.();
  delete process.env.CODEX_MOBILE_HOME;
  delete process.env.CODEX_MOBILE_MAX_TASKS;
  delete process.env.CODEX_MOBILE_CODEX_BIN;
  delete process.env.CODEX_MOBILE_CURSOR_BIN;
  delete process.env.CODEX_MOBILE_ENGINE;
  delete process.env.CAPTURE_ARGS;
  delete process.env.CAPTURE_STDIN;
  if (originalPath) process.env.PATH = originalPath;
});

describe("CodexTaskManager", () => {
  it("can run with cursor engine adapter", async () => {
    const ctx = await setup(`#!/usr/bin/env bash
if [ "\${1:-}" = "--version" ]; then printf 'fake-cursor\\n'; exit 0; fi
if [ "\${1:-}" = "debug" ]; then printf '{"models":[]}\\n'; exit 0; fi
if [ "\${1:-}" != "agent" ]; then printf 'unexpected args\\n' >&2; exit 2; fi
printf '%s\\n' "$@" > "$CAPTURE_ARGS"
printf '{"type":"system","session_id":"cursor-session","model":"Composer 2 Fast"}\\n'
printf '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"cursor ok"}]},"session_id":"cursor-session"}\\n'
printf '{"type":"result","subtype":"success","result":"cursor ok","session_id":"cursor-session"}\\n'
`, "3", "cursor");
    cleanup = async () => {
      ctx.db.close();
      await fs.rm(ctx.tempRoot, { recursive: true, force: true });
    };
    process.env.CAPTURE_ARGS = path.join(ctx.tempRoot, "cursor-args.txt");

    const project = ctx.repo.createProject("Project", ctx.projectDir);
    const result = ctx.taskManager.sendChat({ projectId: project.id, prompt: "hello cursor" });
    await waitFor(() => ctx.repo.getTask(result.run.id)?.status, "completed");

    const args = await fs.readFile(process.env.CAPTURE_ARGS, "utf8");
    expect(result.run.model).toBe("composer-2-fast");
    expect(args).toContain("--sandbox\ndisabled");
    expect(args).not.toContain("--sandbox\nenabled");
    const session = ctx.repo.getSession(result.session.id);
    expect(session?.agentSessionId || session?.codexSessionId).toBe("cursor-session");
    expect(ctx.repo.listMessages(result.session.id).find((message) => message.role === "assistant")?.content).toBe("cursor ok");
  });

  it("keeps a stopped running task cancelled", async () => {
    const ctx = await setup(`#!/usr/bin/env bash
if [ "\${1:-}" = "--version" ]; then printf 'fake-codex\\n'; exit 0; fi
if [ "\${1:-}" = "debug" ]; then printf '{"models":[]}\\n'; exit 0; fi
cat >/dev/null
trap 'exit 143' TERM
sleep 2
`);
    cleanup = async () => {
      ctx.db.close();
      await fs.rm(ctx.tempRoot, { recursive: true, force: true });
    };

    const project = ctx.repo.createProject("Project", ctx.projectDir);
    const result = ctx.taskManager.sendChat({ projectId: project.id, prompt: "cancel me" });
    await waitFor(() => ctx.repo.getTask(result.run.id)?.status, "running");
    ctx.taskManager.cancel(result.run.id);
    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(ctx.repo.getTask(result.run.id)?.status).toBe("cancelled");
    expect(ctx.repo.listMessages(result.session.id)).toHaveLength(1);
  });

  it("flushes a final JSON line without a trailing newline", async () => {
    const ctx = await setup(`#!/usr/bin/env bash
if [ "\${1:-}" = "--version" ]; then printf 'fake-codex\\n'; exit 0; fi
if [ "\${1:-}" = "debug" ]; then printf '{"models":[]}\\n'; exit 0; fi
cat >/dev/null
printf '{"type":"item.completed","item":{"type":"agent_message","text":"final without newline"}}'
`);
    cleanup = async () => {
      ctx.db.close();
      await fs.rm(ctx.tempRoot, { recursive: true, force: true });
    };

    const project = ctx.repo.createProject("Project", ctx.projectDir);
    const result = ctx.taskManager.sendChat({ projectId: project.id, prompt: "hello" });
    await waitFor(() => ctx.repo.getTask(result.run.id)?.status, "completed");

    const assistant = ctx.repo.listMessages(result.session.id).find((message) => message.role === "assistant");
    expect(assistant?.content).toBe("final without newline");
  });

  it("rejects sessions from another project before creating messages or tasks", async () => {
    const ctx = await setup(`#!/usr/bin/env bash
if [ "\${1:-}" = "--version" ]; then printf 'fake-codex\\n'; exit 0; fi
cat >/dev/null
`);
    cleanup = async () => {
      ctx.db.close();
      await fs.rm(ctx.tempRoot, { recursive: true, force: true });
    };

    const projectA = ctx.repo.createProject("A", ctx.projectDir);
    const projectBDir = path.join(ctx.tempRoot, "project-b");
    await fs.mkdir(projectBDir);
    const projectB = ctx.repo.createProject("B", projectBDir);
    const session = ctx.repo.createSession({ projectId: projectA.id, title: "A session", model: "gpt-5.5", effort: "medium" });

    expect(() => ctx.taskManager.sendChat({ projectId: projectB.id, sessionId: session.id, prompt: "wrong project" })).toThrow(
      /selected project/,
    );
    expect(ctx.repo.listMessages(session.id)).toHaveLength(0);
    expect(ctx.repo.listTasks()).toHaveLength(0);
  });

  it("retries a failed run into a new successful run", async () => {
    const stateFile = path.join(os.tmpdir(), `cursor-mobile-retry-${Date.now()}`);
    const ctx = await setup(`#!/usr/bin/env bash
if [ "\${1:-}" = "--version" ]; then printf 'fake-codex\\n'; exit 0; fi
if [ "\${1:-}" = "debug" ]; then printf '{"models":[]}\\n'; exit 0; fi
cat >/dev/null
if [ ! -f "${stateFile}" ]; then
  touch "${stateFile}"
  printf 'ERROR first run failed\\n' >&2
  exit 2
fi
printf '{"type":"item.completed","item":{"type":"agent_message","text":"retry ok"}}\\n'
`);
    cleanup = async () => {
      ctx.db.close();
      await fs.rm(ctx.tempRoot, { recursive: true, force: true });
      await fs.rm(stateFile, { force: true });
    };

    const project = ctx.repo.createProject("Project", ctx.projectDir);
    const result = ctx.taskManager.sendChat({ projectId: project.id, prompt: "retry me" });
    await waitFor(() => ctx.repo.getTask(result.run.id)?.status, "failed");

    const retry = ctx.taskManager.retry(result.run.id);
    await waitFor(() => ctx.repo.getTask(retry.id)?.status, "completed");
    expect(ctx.repo.listMessages(result.session.id).at(-1)?.content).toBe("retry ok");
  });

  it("stores attachments, passes images with -i, and appends file paths to stdin", async () => {
    const ctx = await setup(`#!/usr/bin/env bash
if [ "\${1:-}" = "--version" ]; then printf 'fake-codex\\n'; exit 0; fi
printf '%s\\n' "$@" > "$CAPTURE_ARGS"
cat > "$CAPTURE_STDIN"
printf '{"type":"item.completed","item":{"type":"agent_message","text":"attachments ok"}}\\n'
`);
    cleanup = async () => {
      ctx.db.close();
      await fs.rm(ctx.tempRoot, { recursive: true, force: true });
    };
    process.env.CAPTURE_ARGS = path.join(ctx.tempRoot, "args.txt");
    process.env.CAPTURE_STDIN = path.join(ctx.tempRoot, "stdin.txt");

    const project = ctx.repo.createProject("Project", ctx.projectDir);
    const result = ctx.taskManager.sendChat({
      projectId: project.id,
      prompt: "Use these references",
      attachments: [
        {
          name: "notes.txt",
          mime: "text/plain",
          contentBase64: Buffer.from("reference notes", "utf8").toString("base64"),
        },
        {
          name: "mock.png",
          mime: "image/png",
          contentBase64: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64"),
        },
      ],
    });
    await waitFor(() => ctx.repo.getTask(result.run.id)?.status, "completed");

    const args = await fs.readFile(process.env.CAPTURE_ARGS, "utf8");
    const stdin = await fs.readFile(process.env.CAPTURE_STDIN, "utf8");
    expect(args).toContain("-i");
    expect(args).toContain("mock.png");
    expect(stdin).toContain("Attached files are saved on this Mac");
    expect(stdin).toContain("notes.txt");
    expect(stdin).toContain("mock.png");
    expect(ctx.repo.listMessages(result.session.id).find((message) => message.role === "assistant")?.content).toBe("attachments ok");
  });
});
