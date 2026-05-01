import { describe, expect, it } from "vitest";
import { parseAgentJsonLine } from "../src/services/codexEventParser.js";

describe("parseAgentJsonLine", () => {
  it("keeps regular assistant output out of the error channel", () => {
    expect(parseAgentJsonLine('{"type":"agent_message_delta","delta":"hello"}', "codex")).toMatchObject({
      type: "agent.delta",
      text: "hello",
    });
    expect(parseAgentJsonLine('{"type":"agent_message","message":"done"}', "codex")).toMatchObject({
      type: "agent.message",
      text: "done",
    });
  });

  it("normalizes tool and session events", () => {
    expect(parseAgentJsonLine('{"type":"session.created","session_id":"abc"}', "codex")).toMatchObject({
      type: "session.updated",
      agentSessionId: "abc",
    });
    expect(parseAgentJsonLine('{"type":"thread.started","thread_id":"abc"}', "codex")).toMatchObject({
      type: "session.updated",
      agentSessionId: "abc",
    });
    expect(parseAgentJsonLine('{"type":"exec_command_begin","command":"pwd"}', "codex")).toMatchObject({
      type: "tool.started",
    });
  });

  it("parses current Codex item.completed assistant messages", () => {
    expect(parseAgentJsonLine('{"type":"item.completed","item":{"type":"agent_message","text":"hello"}}', "codex")).toMatchObject({
      type: "agent.message",
      text: "hello",
    });
  });

  it("parses cursor-like stream events into normalized agent events", () => {
    expect(parseAgentJsonLine('{"event":"response.output_text.delta","delta":"hi"}', "cursor")).toMatchObject({
      type: "agent.delta",
      text: "hi",
    });
    expect(parseAgentJsonLine('{"event":"response.completed","response":{"output_text":"done"}}', "cursor")).toMatchObject({
      type: "agent.message",
      text: "done",
    });
  });

  it("parses Cursor Agent stream-json system, assistant, and result events", () => {
    expect(parseAgentJsonLine('{"type":"system","session_id":"abc","model":"Composer 2 Fast"}', "cursor")).toMatchObject({
      type: "session.updated",
      agentSessionId: "abc",
    });
    expect(parseAgentJsonLine('{"type":"system","model":"Composer 2 Fast"}', "cursor")).toMatchObject({
      type: "task.log",
      level: "info",
      text: "Composer 2 Fast",
    });
    expect(
      parseAgentJsonLine('{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"ready"}]},"session_id":"abc"}', "cursor"),
    ).toMatchObject({
      type: "agent.message",
      text: "ready",
    });
    expect(parseAgentJsonLine('{"type":"result","subtype":"success","result":"ready","session_id":"abc"}', "cursor")).toMatchObject({
      type: "agent.message",
      text: "ready",
    });
  });
});
