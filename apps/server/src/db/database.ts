import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { paths, ensureAppDirs } from "../config/paths.js";
import type { MessageRecord, Project, Session, TaskRecord } from "../types.js";

ensureAppDirs();

export const db = new Database(paths.db);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_session_id TEXT,
  codex_session_id TEXT,
  title TEXT NOT NULL,
  model TEXT NOT NULL,
  effort TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  model TEXT NOT NULL,
  effort TEXT NOT NULL,
  sandbox TEXT NOT NULL,
  approval_policy TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  task_id TEXT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  level TEXT,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`);

const sessionColumns = db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
const hasAgentSessionId = sessionColumns.some((column) => column.name === "agent_session_id");
if (!hasAgentSessionId) {
  db.exec("ALTER TABLE sessions ADD COLUMN agent_session_id TEXT");
}
db.exec("UPDATE sessions SET agent_session_id = COALESCE(agent_session_id, codex_session_id) WHERE agent_session_id IS NULL");

const now = () => new Date().toISOString();
const bool = (value: number) => Boolean(value);

export function mapProject(row: any): Project {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    archived: bool(row.archived),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapSession(row: any): Session {
  return {
    id: row.id,
    projectId: row.project_id,
    agentSessionId: row.agent_session_id ?? row.codex_session_id,
    codexSessionId: row.codex_session_id ?? row.agent_session_id,
    title: row.title,
    model: row.model,
    effort: row.effort,
    archived: bool(row.archived),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapTask(row: any): TaskRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    sessionId: row.session_id,
    prompt: row.prompt,
    model: row.model,
    effort: row.effort,
    sandbox: row.sandbox,
    approvalPolicy: row.approval_policy,
    status: row.status,
    error: row.error,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export function mapMessage(row: any): MessageRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    taskId: row.task_id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
  };
}

export const repo = {
  createChatRun(input: {
    projectId: string;
    sessionId?: string;
    prompt: string;
    model: string;
    effort: string;
    sandbox: string;
    approvalPolicy: string;
  }): { session: Session; userMessage: MessageRecord; task: TaskRecord } {
    return db.transaction(() => {
      const projectRow = db.prepare("SELECT * FROM projects WHERE id = ?").get(input.projectId);
      if (!projectRow) throw new Error("Project not found");

      let session: Session;
      if (input.sessionId) {
        const sessionRow = db.prepare("SELECT * FROM sessions WHERE id = ?").get(input.sessionId);
        if (!sessionRow) throw new Error("Session not found");
        session = mapSession(sessionRow);
        if (session.projectId !== input.projectId) {
          throw new Error("Session does not belong to the selected project");
        }
      } else {
        const sessionId = randomUUID();
        const ts = now();
        db.prepare(
          "INSERT INTO sessions (id, project_id, agent_session_id, codex_session_id, title, model, effort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).run(sessionId, input.projectId, null, null, input.prompt.slice(0, 60) || "New Session", input.model, input.effort, ts, ts);
        session = mapSession(db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId));
      }

      const active = db
        .prepare("SELECT * FROM tasks WHERE session_id = ? AND status IN ('queued', 'running') ORDER BY created_at DESC LIMIT 1")
        .get(session.id);
      if (active) {
        throw new Error("This session is already running. Stop it or wait for the reply before sending another message.");
      }

      const messageId = randomUUID();
      const taskId = randomUUID();
      const ts = now();
      db.prepare(
        "INSERT INTO messages (id, session_id, task_id, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(messageId, session.id, null, "user", input.prompt, ts);
      db.prepare(
        `INSERT INTO tasks
        (id, project_id, session_id, prompt, model, effort, sandbox, approval_policy, status, error, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
      ).run(taskId, input.projectId, session.id, input.prompt, input.model, input.effort, input.sandbox, input.approvalPolicy, null, ts);
      db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(ts, session.id);

      return {
        session: mapSession(db.prepare("SELECT * FROM sessions WHERE id = ?").get(session.id)),
        userMessage: mapMessage(db.prepare("SELECT * FROM messages WHERE id = ?").get(messageId)),
        task: mapTask(db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId)),
      };
    })();
  },
  createProject(name: string, projectPath: string): Project {
    const id = randomUUID();
    const ts = now();
    db.prepare(
      "INSERT INTO projects (id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run(id, name, projectPath, ts, ts);
    return this.getProject(id)!;
  },
  listProjects(includeArchived = false): Project[] {
    const rows = db
      .prepare(
        `SELECT * FROM projects ${includeArchived ? "" : "WHERE archived = 0"} ORDER BY updated_at DESC`,
      )
      .all();
    return (rows as any[]).map(mapProject);
  },
  getProject(id: string): Project | undefined {
    const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
    return row ? mapProject(row) : undefined;
  },
  updateProject(id: string, patch: Partial<Pick<Project, "name" | "archived">>): Project | undefined {
    const current = this.getProject(id);
    if (!current) return undefined;
    db.prepare(
      "UPDATE projects SET name = ?, archived = ?, updated_at = ? WHERE id = ?",
    ).run(patch.name ?? current.name, patch.archived === undefined ? Number(current.archived) : Number(patch.archived), now(), id);
    return this.getProject(id);
  },
  createSession(input: {
    projectId: string;
    title: string;
    model: string;
    effort: string;
    agentSessionId?: string | null;
    codexSessionId?: string | null;
  }): Session {
    const id = randomUUID();
    const ts = now();
    db.prepare(
      "INSERT INTO sessions (id, project_id, agent_session_id, codex_session_id, title, model, effort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      id,
      input.projectId,
      input.agentSessionId ?? input.codexSessionId ?? null,
      input.codexSessionId ?? input.agentSessionId ?? null,
      input.title,
      input.model,
      input.effort,
      ts,
      ts,
    );
    return this.getSession(id)!;
  },
  listSessions(projectId?: string, includeArchived = false): Session[] {
    const clauses = [];
    const params: string[] = [];
    if (projectId) {
      clauses.push("project_id = ?");
      params.push(projectId);
    }
    if (!includeArchived) clauses.push("archived = 0");
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = db.prepare(`SELECT * FROM sessions ${where} ORDER BY updated_at DESC`).all(...params);
    return (rows as any[]).map(mapSession);
  },
  getSession(id: string): Session | undefined {
    const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
    return row ? mapSession(row) : undefined;
  },
  updateSession(id: string, patch: Partial<Session>): Session | undefined {
    const current = this.getSession(id);
    if (!current) return undefined;
    db.prepare(
      "UPDATE sessions SET title = ?, agent_session_id = ?, codex_session_id = ?, model = ?, effort = ?, archived = ?, updated_at = ? WHERE id = ?",
    ).run(
      patch.title ?? current.title,
      patch.agentSessionId ?? patch.codexSessionId ?? current.agentSessionId ?? current.codexSessionId ?? null,
      patch.codexSessionId ?? patch.agentSessionId ?? current.codexSessionId ?? current.agentSessionId ?? null,
      patch.model ?? current.model,
      patch.effort ?? current.effort,
      patch.archived === undefined ? Number(current.archived) : Number(patch.archived),
      now(),
      id,
    );
    return this.getSession(id);
  },
  deleteSession(id: string): boolean {
    const result = db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
    return result.changes > 0;
  },
  createTask(task: Omit<TaskRecord, "id" | "createdAt" | "startedAt" | "finishedAt" | "status">): TaskRecord {
    const id = randomUUID();
    const ts = now();
    db.prepare(
      `INSERT INTO tasks
      (id, project_id, session_id, prompt, model, effort, sandbox, approval_policy, status, error, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
    ).run(id, task.projectId, task.sessionId, task.prompt, task.model, task.effort, task.sandbox, task.approvalPolicy, task.error ?? null, ts);
    return this.getTask(id)!;
  },
  listTasks(limit = 100): TaskRecord[] {
    const rows = db.prepare("SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?").all(limit);
    return (rows as any[]).map(mapTask);
  },
  getTask(id: string): TaskRecord | undefined {
    const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
    return row ? mapTask(row) : undefined;
  },
  getActiveTaskForSession(sessionId: string): TaskRecord | undefined {
    const row = db
      .prepare("SELECT * FROM tasks WHERE session_id = ? AND status IN ('queued', 'running') ORDER BY created_at DESC LIMIT 1")
      .get(sessionId);
    return row ? mapTask(row) : undefined;
  },
  setTaskStatus(id: string, status: TaskRecord["status"], error?: string | null): TaskRecord | undefined {
    const started = status === "running" ? now() : undefined;
    const finished = ["completed", "failed", "cancelled"].includes(status) ? now() : undefined;
    db.prepare(
      `UPDATE tasks
       SET status = ?,
           error = COALESCE(?, error),
           started_at = COALESCE(?, started_at),
           finished_at = COALESCE(?, finished_at)
       WHERE id = ?`,
    ).run(status, error ?? null, started ?? null, finished ?? null, id);
    return this.getTask(id);
  },
  addMessage(sessionId: string, taskId: string | null, role: string, content: string): MessageRecord {
    const id = randomUUID();
    const ts = now();
    db.prepare(
      "INSERT INTO messages (id, session_id, task_id, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(id, sessionId, taskId, role, content, ts);
    db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(ts, sessionId);
    return this.getMessage(id)!;
  },
  getMessage(id: string): MessageRecord | undefined {
    const row = db.prepare("SELECT * FROM messages WHERE id = ?").get(id);
    return row ? mapMessage(row) : undefined;
  },
  listMessages(sessionId: string): MessageRecord[] {
    return db
      .prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC")
      .all(sessionId)
      .map((row: any) => mapMessage(row));
  },
  listTaskEvents(taskId: string): Array<{ id: string; taskId: string; type: string; level?: string | null; payload: unknown; createdAt: string }> {
    return db
      .prepare("SELECT * FROM task_events WHERE task_id = ? ORDER BY created_at ASC")
      .all(taskId)
      .map((row: any) => ({
        id: row.id,
        taskId: row.task_id,
        type: row.type,
        level: row.level,
        payload: JSON.parse(row.payload),
        createdAt: row.created_at,
      }));
  },
  addTaskEvent(taskId: string, type: string, payload: unknown, level?: string): void {
    db.prepare(
      "INSERT INTO task_events (id, task_id, type, level, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(randomUUID(), taskId, type, level ?? null, JSON.stringify(payload), now());
  },
  markInterruptedTasks(): void {
    db.prepare(
      `UPDATE tasks
       SET status = 'failed',
           error = 'Service restarted before task completed',
           finished_at = ?
       WHERE status IN ('running', 'queued')`,
    ).run(now());
  },
};
