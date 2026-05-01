export type TaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type Effort = "low" | "medium" | "high" | "xhigh";
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type ApprovalPolicy = "untrusted" | "on-request" | "on-failure" | "never";

export interface AttachmentInput {
  name: string;
  contentBase64: string;
  mime?: string;
  size?: number;
}

export interface PreparedAttachment {
  name: string;
  path: string;
  mime: string;
  size: number;
  image: boolean;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Session {
  id: string;
  projectId: string;
  agentSessionId?: string | null;
  codexSessionId?: string | null;
  title: string;
  model: string;
  effort: Effort;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TaskRecord {
  id: string;
  projectId: string;
  sessionId: string;
  prompt: string;
  model: string;
  effort: Effort;
  sandbox: SandboxMode;
  approvalPolicy: ApprovalPolicy;
  status: TaskStatus;
  error?: string | null;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface MessageRecord {
  id: string;
  sessionId: string;
  taskId?: string | null;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
}

export interface ClientEvent {
  type: string;
  taskId?: string;
  sessionId?: string;
  projectId?: string;
  level?: "debug" | "info" | "warn" | "error";
  data?: unknown;
  text?: string;
  createdAt: string;
}

export interface CreateTaskInput {
  projectId: string;
  sessionId?: string;
  prompt: string;
  model?: string;
  effort?: Effort;
  sandbox?: SandboxMode;
  approvalPolicy?: ApprovalPolicy;
  attachments?: AttachmentInput[];
}

export interface ChatSendInput extends CreateTaskInput {}

export type AgentEngine = "codex" | "cursor";

export interface NormalizedAgentEvent {
  type:
    | "task.log"
    | "agent.delta"
    | "agent.message"
    | "tool.started"
    | "tool.finished"
    | "task.failed"
    | "session.updated";
  text?: string;
  level?: "debug" | "info" | "warn" | "error";
  agentSessionId?: string;
  data?: unknown;
}
