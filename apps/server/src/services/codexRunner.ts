import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { repo } from "../db/database.js";
import { appConfig, getProxyEnvironment, resolveAgentCommand } from "../config/env.js";
import { eventHub } from "../ws/hub.js";
import { parseAgentJsonLine } from "./codexEventParser.js";
import { appendAttachmentContext, prepareAttachments } from "./attachmentService.js";
import type { AgentEngine, ChatSendInput, CreateTaskInput, MessageRecord, PreparedAttachment, Session, TaskRecord } from "../types.js";

interface RunningTask {
  task: TaskRecord;
  process: ChildProcessWithoutNullStreams;
  buffer: string;
  assistantText: string;
  lastErrorText?: string;
  attachments: PreparedAttachment[];
}

export type CancelOutcome = "cancelled" | "not_found" | "noop";

export interface CancelResult {
  task?: TaskRecord;
  outcome: CancelOutcome;
}

export interface TaskManager {
  sendChat(input: ChatSendInput): { session: Session; userMessage: MessageRecord; run: TaskRecord };
  createTask(input: CreateTaskInput): TaskRecord;
  listTasks(): TaskRecord[];
  cancel(taskId: string): CancelResult;
  retry(taskId: string): TaskRecord;
}

export class AgentTaskManager implements TaskManager {
  private queue: string[] = [];
  private running = new Map<string, RunningTask>();
  private attachments = new Map<string, PreparedAttachment[]>();
  constructor(private engine: AgentEngine = "codex") {}

  private defaultModel(): string {
    return this.engine === "cursor" ? "composer-2-fast" : "gpt-5.5";
  }

  private normalizeModel(model?: string | null): string {
    if (this.engine === "cursor" && (!model || model === "gpt-5.5" || model === "cursor-auto" || model === "auto")) return this.defaultModel();
    return model || this.defaultModel();
  }

  sendChat(input: ChatSendInput): { session: Session; userMessage: MessageRecord; run: TaskRecord } {
    const project = repo.getProject(input.projectId);
    if (!project) throw new Error("Project not found");

    const existingSession = input.sessionId ? repo.getSession(input.sessionId) : undefined;
    if (input.sessionId && !existingSession) throw new Error("Session not found");
    if (existingSession && existingSession.projectId !== project.id) {
      throw new Error("Session does not belong to the selected project");
    }

    const attachments = input.attachments || [];
    const userPrompt = attachments.length
      ? `${input.prompt}\n\nAttachments: ${attachments.map((item) => item.name).join(", ")}`
      : input.prompt;

    const result = repo.createChatRun({
      projectId: project.id,
      sessionId: existingSession?.id,
      prompt: userPrompt,
      model: this.normalizeModel(input.model || existingSession?.model),
      effort: input.effort || existingSession?.effort || "medium",
      sandbox: input.sandbox || "workspace-write",
      approvalPolicy: input.approvalPolicy || "never",
    });
    eventHub.publish({
      type: "message.created",
      sessionId: result.session.id,
      projectId: project.id,
      data: result.userMessage,
    });

    void this.enqueueWithAttachments(result.task, attachments, project.id, result.session.id);
    return { session: result.session, userMessage: result.userMessage, run: result.task };
  }

  createTask(input: CreateTaskInput): TaskRecord {
    return this.sendChat(input).run;
  }

  listTasks(): TaskRecord[] {
    return repo.listTasks();
  }

  private async enqueueWithAttachments(task: TaskRecord, attachments: ChatSendInput["attachments"], projectId: string, sessionId: string): Promise<void> {
    try {
      this.attachments.set(task.id, await prepareAttachments(task.id, attachments || []));
      this.queue.push(task.id);
      eventHub.publish({
        type: "run.queued",
        taskId: task.id,
        sessionId,
        projectId,
        data: task,
      });
      this.pump();
    } catch (error: any) {
      repo.setTaskStatus(task.id, "failed", error?.message || String(error));
      eventHub.publish({
        type: "run.failed",
        taskId: task.id,
        sessionId,
        projectId,
        level: "error",
        text: error?.message || String(error),
        data: repo.getTask(task.id),
      });
    }
  }

  cancel(taskId: string): CancelResult {
    const terminal = new Set<TaskRecord["status"]>(["completed", "failed", "cancelled"]);
    const snapshot = repo.getTask(taskId);
    if (!snapshot) return { outcome: "not_found" };
    if (terminal.has(snapshot.status)) {
      return { task: snapshot, outcome: "noop" };
    }

    if (this.queue.includes(taskId)) {
      this.queue = this.queue.filter((id) => id !== taskId);
      const task = repo.setTaskStatus(taskId, "cancelled");
      eventHub.publish({ type: "run.cancelled", taskId, sessionId: task?.sessionId, projectId: task?.projectId, data: task });
      return { task, outcome: "cancelled" };
    }
    const running = this.running.get(taskId);
    if (running) {
      const proc = running.process;
      this.running.delete(taskId);
      const task = repo.setTaskStatus(taskId, "cancelled");
      eventHub.publish({ type: "run.cancelled", taskId, sessionId: task?.sessionId, projectId: task?.projectId, data: task });
      proc.kill("SIGTERM");
      const killTimer = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          /* process may have exited */
        }
      }, 2000);
      proc.once("exit", () => clearTimeout(killTimer));
      this.pump();
      return { task, outcome: "cancelled" };
    }
    return { task: snapshot, outcome: "noop" };
  }

  retry(taskId: string): TaskRecord {
    const original = repo.getTask(taskId);
    if (!original) throw new Error("Task not found");
    const session = repo.getSession(original.sessionId);
    if (!session) throw new Error("Session not found");
    if (session.projectId !== original.projectId) {
      throw new Error("Session does not belong to the task project");
    }
    const active = repo.getActiveTaskForSession(original.sessionId);
    if (active) throw new Error("This session is already running.");
    const task = repo.createTask({
      projectId: original.projectId,
      sessionId: original.sessionId,
      prompt: original.prompt,
      model: original.model,
      effort: original.effort,
      sandbox: original.sandbox,
      approvalPolicy: original.approvalPolicy,
    });
    this.attachments.delete(task.id);
    this.queue.push(task.id);
    eventHub.publish({ type: "run.queued", taskId: task.id, sessionId: task.sessionId, projectId: task.projectId, data: task });
    this.pump();
    return task;
  }

  private pump(): void {
    while (this.running.size < appConfig.maxConcurrentTasks && this.queue.length) {
      const id = this.queue.shift()!;
      const task = repo.getTask(id);
      if (task) void this.run(task);
    }
  }

  private buildArgs(task: TaskRecord, attachments: PreparedAttachment[] = []): string[] {
    const session = repo.getSession(task.sessionId);
    const project = repo.getProject(task.projectId);
    if (!project) throw new Error("Project not found");

    if (this.engine === "cursor") {
      const cursorArgs = ["agent", "--print", "--output-format", "stream-json", "--workspace", project.path, "--trust"];
      if (task.model) cursorArgs.push("--model", task.model);
      if (task.approvalPolicy === "never") cursorArgs.push("--force");
      cursorArgs.push("--sandbox", "disabled");
      if (session?.agentSessionId) cursorArgs.push("--resume", session.agentSessionId);
      cursorArgs.push(appendAttachmentContext(task.prompt, attachments));
      return cursorArgs;
    }

    const imageArgs = attachments
      .filter((attachment) => attachment.image)
      .flatMap((attachment) => ["-i", attachment.path]);

    const common = [
      "--json",
      ...imageArgs,
      "-m",
      task.model,
      "-c",
      `model_reasoning_effort="${task.effort}"`,
      "-c",
      `approval_policy="${task.approvalPolicy}"`,
      "-c",
      `sandbox_mode="${task.sandbox}"`,
      "--skip-git-repo-check",
    ];

    if (session?.agentSessionId) {
      return ["exec", "resume", ...common, session.agentSessionId, "-"];
    }

    return ["exec", ...common, "--cd", project.path, "-"];
  }

  private async run(task: TaskRecord): Promise<void> {
    const project = repo.getProject(task.projectId);
    if (!project) return;
    let args: string[];
    let agentCommand: string;
    const attachments = this.attachments.get(task.id) || [];
    try {
      args = this.buildArgs(task, attachments);
      agentCommand = await resolveAgentCommand();
    } catch (error: any) {
      this.finishWithoutProcess(task, "failed", error?.message || String(error));
      return;
    }
    const child = spawn(agentCommand, args, {
      cwd: project.path,
      env: {
        ...process.env,
        ...getProxyEnvironment(),
      },
    });

    const startedTask = repo.setTaskStatus(task.id, "running") || task;
    const running: RunningTask = { task: startedTask, process: child, buffer: "", assistantText: "", attachments };
    this.running.set(task.id, running);
    eventHub.publish({ type: "run.started", taskId: task.id, sessionId: task.sessionId, projectId: task.projectId, data: startedTask });

    child.stdout.on("data", (chunk) => this.handleStdout(task.id, chunk.toString()));
    child.stderr.on("data", (chunk) => this.handleStderr(task.id, chunk.toString()));
    child.on("error", (error) => this.finish(task.id, "failed", error.message));
    child.on("exit", (code, signal) => {
      if (!this.running.has(task.id)) return;
      this.flushStdout(task.id);
      if (code === 0) this.finish(task.id, "completed");
      else this.finish(task.id, "failed", running.lastErrorText || `Agent exited with code ${code ?? "null"} signal ${signal ?? "null"}`);
    });
    if (this.engine === "codex") {
      child.stdin.write(appendAttachmentContext(task.prompt, attachments));
      child.stdin.end();
    }
  }

  private finishWithoutProcess(task: TaskRecord, status: "failed" | "cancelled", error?: string): void {
    const finalTask = repo.setTaskStatus(task.id, status, error);
    eventHub.publish({
      type: status === "cancelled" ? "run.cancelled" : "run.failed",
      taskId: task.id,
      sessionId: task.sessionId,
      projectId: task.projectId,
      level: status === "failed" ? "error" : "info",
      text: error,
      data: finalTask,
    });
    this.pump();
  }

  private handleStdout(taskId: string, chunk: string): void {
    const running = this.running.get(taskId);
    if (!running) return;
    running.buffer += chunk;
    const lines = running.buffer.split(/\r?\n/);
    running.buffer = lines.pop() || "";
    for (const line of lines) this.handleStdoutLine(taskId, line);
  }

  private flushStdout(taskId: string): void {
    const running = this.running.get(taskId);
    if (!running || !running.buffer.trim()) return;
    const line = running.buffer;
    running.buffer = "";
    this.handleStdoutLine(taskId, line);
  }

  private handleStdoutLine(taskId: string, line: string): void {
    const running = this.running.get(taskId);
    if (!running || !line.trim()) return;
    const event = parseAgentJsonLine(line, this.engine);
    repo.addTaskEvent(taskId, event.type, event.data ?? { text: event.text }, event.level);
    if (event.type === "session.updated" && event.agentSessionId) {
      repo.updateSession(running.task.sessionId, { agentSessionId: event.agentSessionId, codexSessionId: event.agentSessionId });
    }
    if (event.type === "agent.delta" && event.text) {
      running.assistantText += event.text;
      eventHub.publish({
        type: "message.delta",
        taskId,
        sessionId: running.task.sessionId,
        projectId: running.task.projectId,
        text: event.text,
        data: { runId: taskId },
      });
    }
    if (event.type === "agent.message" && event.text) {
      running.assistantText = event.text;
    }
    if (event.type === "task.failed") {
      this.handleLog(taskId, event.text || "Agent reported an error", "error");
    }
    eventHub.publish({
      type: event.type === "task.log" ? "diagnostic.log" : event.type,
      taskId,
      sessionId: running.task.sessionId,
      projectId: running.task.projectId,
      text: event.text,
      level: event.level,
      data: event.data,
    });
  }

  private handleLog(taskId: string, text: string, level: "debug" | "info" | "warn" | "error"): void {
    const running = this.running.get(taskId);
    repo.addTaskEvent(taskId, "task.log", { text }, level);
    eventHub.publish({
      type: "diagnostic.log",
      taskId,
      sessionId: running?.task.sessionId,
      projectId: running?.task.projectId,
      level,
      text,
    });
  }

  private handleStderr(taskId: string, text: string): void {
    const running = this.running.get(taskId);
    const level = /\b(ERROR|Fatal error|permission denied|operation not permitted)\b/.test(text)
      ? "error"
      : /\bWARN\b/.test(text)
        ? "warn"
        : "debug";
    if (level === "error" && running) {
      running.lastErrorText = text
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-2)
        .join("\n");
    }
    this.handleLog(taskId, text, level);
  }

  private finish(taskId: string, status: "completed" | "failed" | "cancelled", error?: string): void {
    const running = this.running.get(taskId);
    if (!running) return;
    this.running.delete(taskId);
    if (running.assistantText.trim()) {
      const message = repo.addMessage(running.task.sessionId, taskId, "assistant", running.assistantText.trim());
      eventHub.publish({
        type: "message.completed",
        taskId,
        sessionId: running.task.sessionId,
        projectId: running.task.projectId,
        data: message,
      });
    } else if (status === "failed") {
      const message = repo.addMessage(running.task.sessionId, taskId, "assistant", `Agent failed: ${error || "Unknown error"}`);
      eventHub.publish({
        type: "message.completed",
        taskId,
        sessionId: running.task.sessionId,
        projectId: running.task.projectId,
        level: "error",
        data: message,
      });
    }
    const task = repo.setTaskStatus(taskId, status, error);
    eventHub.publish({
      type: status === "completed" ? "run.completed" : status === "cancelled" ? "run.cancelled" : "run.failed",
      taskId,
      sessionId: running.task.sessionId,
      projectId: running.task.projectId,
      level: status === "failed" ? "error" : "info",
      text: error,
      data: task,
    });
    this.pump();
  }
}

export const taskManager = new AgentTaskManager(appConfig.engine);
