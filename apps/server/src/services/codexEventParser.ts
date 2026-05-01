import type { AgentEngine, NormalizedAgentEvent } from "../types.js";

function findText(value: any): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return value;
  for (const key of ["delta", "text", "message", "content", "output", "output_text", "summary", "result"]) {
    if (typeof value[key] === "string") return value[key];
  }
  if (Array.isArray(value.content)) {
    const text = value.content
      .map((item: any) => findText(item))
      .filter(Boolean)
      .join("");
    if (text) return text;
  }
  if (value.item) return findText(value.item);
  if (value.response) return findText(value.response);
  if (value.message) return findText(value.message);
  if (value.msg) return findText(value.msg);
  return undefined;
}

function findSessionId(value: any): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  return value.session_id || value.sessionId || value.thread_id || value.threadId || value.conversation_id || value.conversationId;
}

export function parseAgentJsonLine(line: string, engine: AgentEngine): NormalizedAgentEvent {
  let raw: any;
  try {
    raw = JSON.parse(line);
  } catch {
    return { type: "task.log", level: "debug", text: line };
  }

  const rawType = String(raw.type || raw.event || raw.kind || "event");
  const lowered = rawType.toLowerCase();
  const text = findText(raw);
  const agentSessionId = findSessionId(raw);

  if (engine === "cursor" && rawType === "system") {
    const sid = findSessionId(raw);
    if (sid) {
      return { type: "session.updated", agentSessionId: sid, data: raw };
    }
    const summary = text || findText(raw) || (raw.subtype ? String(raw.subtype) : undefined) || (raw.model ? String(raw.model) : undefined);
    return { type: "task.log", level: "info", text: summary || "System", data: raw };
  }

  if (engine === "cursor" && rawType === "assistant") {
    return { type: "agent.message", text, data: raw };
  }

  if (engine === "cursor" && rawType === "result") {
    return raw.is_error
      ? { type: "task.failed", level: "error", text: text || raw.subtype || rawType, data: raw }
      : { type: "agent.message", text, data: raw };
  }

  if (agentSessionId && (engine === "cursor" || lowered.includes("thread") || lowered.includes("session"))) {
    return { type: "session.updated", agentSessionId, data: raw };
  }

  if (rawType === "item.completed" && raw.item?.type === "agent_message") {
    return { type: "agent.message", text: raw.item.text || text, data: raw };
  }

  if (rawType === "item.completed" && raw.item?.type?.includes("tool")) {
    return { type: "tool.finished", text, data: raw };
  }

  if (lowered.includes("error") || lowered.includes("failed")) {
    return { type: "task.failed", level: "error", text: text || rawType, data: raw };
  }

  if (lowered.includes("delta") || lowered.includes("token")) {
    return { type: "agent.delta", text, data: raw };
  }

  if (lowered.includes("tool") || lowered.includes("exec") || lowered.includes("command")) {
    const finished = lowered.includes("end") || lowered.includes("finish") || lowered.includes("completed");
    return { type: finished ? "tool.finished" : "tool.started", text, data: raw };
  }

  if (lowered.includes("message") || lowered.includes("answer") || lowered.includes("response")) {
    return { type: "agent.message", text, data: raw };
  }

  // Cursor streaming payloads can use event names and different nesting.
  if (engine === "cursor") {
    if (lowered.includes("output_text.delta")) {
      return { type: "agent.delta", text, data: raw };
    }
    if (lowered.includes("response.completed") || lowered.includes("message.completed")) {
      return { type: "agent.message", text, data: raw };
    }
  }

  return { type: "task.log", level: "debug", text, data: raw };
}

export function parseCodexJsonLine(line: string): NormalizedAgentEvent {
  return parseAgentJsonLine(line, "codex");
}
