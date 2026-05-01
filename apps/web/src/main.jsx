import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  Bot,
  Check,
  ChevronDown,
  ChevronLeft,
  FileText,
  Folder,
  FolderPlus,
  Menu,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Square,
  Trash2,
  Upload,
  Wrench,
  X,
} from "lucide-react";
import { api, connectEvents } from "./lib/api.js";
import "./styles.css";

const DEFAULT_MODEL = "composer-2-fast";
const MAX_ATTACHMENTS = 8;
const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;

const QUICK_PROMPTS = [
  {
    tone: "red",
    title: "检查当前 Web UI 并给出设计方案",
    prompt: "Review the current web UI, identify product polish gaps, and propose the smallest high-impact implementation plan.",
  },
  {
    tone: "yellow",
    title: "调用 imagegen 生成视觉稿",
    prompt: "Use imagegen to create refined visual concepts for this product direction before implementation.",
  },
  {
    tone: "green",
    title: "调整本次任务的权限与模型",
    prompt: "Help me choose the right model, reasoning effort, sandbox mode, and approval policy for this task.",
  },
  {
    tone: "cyan",
    title: "浏览项目文件并定位问题",
    prompt: "Browse the current project files, find the relevant implementation points, and explain the safest path.",
  },
];

function isActive(run) {
  return run && ["queued", "running"].includes(run.status);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function runTone(status) {
  if (status === "failed") return "red";
  if (status === "queued") return "yellow";
  if (status === "running") return "green";
  if (status === "completed") return "cyan";
  return "gray";
}

function permissionTone(sandbox) {
  return sandbox === "danger-full-access" ? "red" : sandbox === "read-only" ? "cyan" : "orange";
}

async function fileToAttachment(file) {
  if (file.size > MAX_ATTACHMENT_BYTES) throw new Error(`${file.name} is larger than 12 MB`);
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return {
    id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
    name: file.name,
    mime: file.type || "application/octet-stream",
    size: file.size,
    contentBase64: btoa(binary),
  };
}

function ToneMark({ tone = "gray" }) {
  return <span className={`tone-mark tone-${tone}`} aria-hidden="true" />;
}

function useBootData() {
  const [state, setState] = useState({
    health: null,
    projects: [],
    sessions: [],
    runs: [],
    models: [],
    loading: true,
  });

  async function refresh() {
    const [health, projects, sessions, diagnostics, models] = await Promise.all([
      api.get("/api/health"),
      api.get("/api/projects"),
      api.get("/api/sessions"),
      api.get("/api/diagnostics/runs"),
      api.get("/api/config/models"),
    ]);
    setState({
      health,
      projects: projects.projects || [],
      sessions: sessions.sessions || [],
      runs: diagnostics.runs || [],
      models: models.models || [],
      loading: false,
    });
  }

  useEffect(() => {
    refresh().catch(() => setState((current) => ({ ...current, loading: false })));
  }, []);

  return [state, refresh];
}

function App() {
  const [boot, refresh] = useBootData();
  const [activeProjectId, setActiveProjectId] = useState("");
  const [activeSessionId, setActiveSessionId] = useState("");
  const [messages, setMessages] = useState([]);
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [effort, setEffort] = useState("medium");
  const [sandbox, setSandbox] = useState("workspace-write");
  const [approvalPolicy, setApprovalPolicy] = useState("never");
  const [attachments, setAttachments] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [liveText, setLiveText] = useState({});
  const [sendError, setSendError] = useState("");
  const feedRef = useRef(null);
  const feedEndRef = useRef(null);

  const activeProject = boot.projects.find((project) => project.id === activeProjectId) || boot.projects[0];
  const projectSessions = useMemo(
    () => boot.sessions.filter((session) => session.projectId === activeProject?.id),
    [boot.sessions, activeProject?.id],
  );
  const activeSession = projectSessions.find((session) => session.id === activeSessionId) || projectSessions[0];
  const modelOptions = boot.models.length ? boot.models : [{ slug: DEFAULT_MODEL, display_name: "Cursor Auto" }];
  const activeRun = boot.runs.find((run) => run.sessionId === activeSession?.id && isActive(run));
  const serviceReady = boot.health?.service?.ok;
  const currentAccessTone = permissionTone(sandbox);

  useEffect(() => {
    if (!activeProjectId && boot.projects[0]) setActiveProjectId(boot.projects[0].id);
  }, [boot.projects, activeProjectId]);

  useEffect(() => {
    if (!activeProject) return;
    if (!projectSessions.length) {
      if (activeSessionId) setActiveSessionId("");
      return;
    }
    if (!activeSessionId || !projectSessions.some((session) => session.id === activeSessionId)) {
      setActiveSessionId(projectSessions[0].id);
    }
  }, [activeProject?.id, projectSessions, activeSessionId]);

  useEffect(() => {
    if (!activeSession) {
      setMessages([]);
      return;
    }
    const deprecatedModel = ["auto", "cursor-auto", "gpt-5.5"].includes(activeSession.model);
    const sessionModelAvailable = !deprecatedModel && modelOptions.some((item) => item.slug === activeSession.model);
    setModel(sessionModelAvailable ? activeSession.model : modelOptions[0]?.slug || DEFAULT_MODEL);
    setEffort(activeSession.effort || "medium");
    api.get(`/api/sessions/${activeSession.id}/messages`).then((data) => setMessages(data.messages || []));
  }, [activeSession?.id]);

  useEffect(() => {
    const ws = connectEvents((event) => {
      if (event.type === "message.delta" && event.sessionId) {
        setLiveText((current) => ({ ...current, [event.sessionId]: `${current[event.sessionId] || ""}${event.text || ""}` }));
      }

      if (["message.created", "message.completed", "run.started", "run.failed", "run.completed", "run.cancelled", "session.updated"].includes(event.type)) {
        refresh(activeProjectId).catch(() => {});
        if (event.sessionId === activeSessionId) {
          api.get(`/api/sessions/${event.sessionId}/messages`).then((data) => {
            setMessages(data.messages || []);
            if (["message.completed", "run.failed", "run.completed", "run.cancelled"].includes(event.type)) {
              setLiveText((current) => ({ ...current, [event.sessionId]: "" }));
            }
          });
        }
      }
    });
    return () => ws?.close();
  }, [activeSessionId, activeProjectId]);

  async function sendPrompt() {
    if ((!prompt.trim() && attachments.length === 0) || !activeProject || activeRun) return;
    const text = prompt.trim() || "Please review the attached files.";
    setPrompt("");
    setSendError("");
    try {
      const result = await api.post("/api/chat/send", {
        projectId: activeProject.id,
        sessionId: activeSession?.id,
        prompt: text,
        model,
        effort,
        sandbox,
        approvalPolicy,
        attachments: attachments.map(({ id, ...attachment }) => attachment),
      });
      setActiveSessionId(result.session.id);
      setMessages((current) => [...current, result.userMessage]);
      setAttachments([]);
      await refresh(activeProject.id);
    } catch (error) {
      setPrompt(text);
      setSendError(error.message);
    }
  }

  function handlePromptKeyDown(event) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      sendPrompt();
    }
  }

  async function addAttachments(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;
    setSendError("");
    try {
      if (attachments.length + files.length > MAX_ATTACHMENTS) {
        throw new Error(`Attach up to ${MAX_ATTACHMENTS} files at a time`);
      }
      const next = await Promise.all(files.map(fileToAttachment));
      setAttachments((current) => [...current, ...next]);
    } catch (error) {
      setSendError(error.message);
    }
  }

  async function createProject() {
    setSendError("");
    try {
      const data = await api.post("/api/projects/pick-folder", {});
      if (data.cancelled) return;
      setActiveProjectId(data.project.id);
      setActiveSessionId("");
      setMessages([]);
      await refresh();
    } catch (error) {
      const projectPath = window.prompt("Finder unavailable. Project path", activeProject?.path || "");
      if (!projectPath) return;
      const name = window.prompt("Project name", projectPath.split("/").filter(Boolean).pop() || "Project");
      const data = await api.post("/api/projects", { name, path: projectPath });
      setActiveProjectId(data.project.id);
      setActiveSessionId("");
      setMessages([]);
      await refresh();
    }
  }

  async function createSession(title) {
    if (!activeProject) return;
    const nextTitle = typeof title === "string" && title.trim() ? title.trim() : "New Chat";
    const data = await api.post("/api/sessions", {
      projectId: activeProject.id,
      title: nextTitle,
      model,
      effort,
    });
    setActiveSessionId(data.session.id);
    setMessages([]);
    await refresh(activeProject.id);
  }

  async function renameProject(project, nextName) {
    const name = typeof nextName === "string" ? nextName : window.prompt("Project name", project.name);
    if (!name || name.trim() === project.name) return;
    await api.patch(`/api/projects/${project.id}`, { name: name.trim() });
    await refresh();
  }

  async function deleteProject(project) {
    if (boot.projects.length <= 1) {
      window.alert("Keep at least one project in Cursor Mobile.");
      return;
    }
    if (!window.confirm(`Remove "${project.name}" from Cursor Mobile? Files on disk will stay untouched.`)) return;
    await api.patch(`/api/projects/${project.id}`, { archived: true });
    if (project.id === activeProject?.id) {
      const nextProject = boot.projects.find((item) => item.id !== project.id);
      setActiveProjectId(nextProject?.id || "");
      setActiveSessionId("");
      setMessages([]);
    }
    await refresh();
  }

  async function renameSession(session, nextTitle) {
    const title = typeof nextTitle === "string" ? nextTitle : window.prompt("Chat name", session.title);
    if (!title || title.trim() === session.title) return;
    const data = await api.patch(`/api/sessions/${session.id}`, { title: title.trim() });
    if (data.session.id === activeSessionId) {
      setActiveSessionId(data.session.id);
    }
    await refresh(activeProject?.id);
  }

  async function deleteSession(sessionId) {
    if (!window.confirm("Delete this session from Cursor Mobile?")) return;
    await api.del(`/api/sessions/${sessionId}`);
    if (sessionId === activeSessionId) {
      setActiveSessionId("");
      setMessages([]);
    }
    await refresh(activeProject?.id);
  }

  async function stopRun(runId) {
    await api.post(`/api/runs/${runId}/stop`, {});
    await refresh(activeProjectId);
  }

  async function retryRun(runId) {
    const result = await api.post(`/api/runs/${runId}/retry`, {});
    setLiveText((current) => ({ ...current, [result.run.sessionId]: "" }));
    await refresh(activeProjectId);
  }

  function openPanel(panel) {
    setSidebarOpen(panel === "sessions");
    setToolsOpen(panel === "tools");
    setFilesOpen(panel === "files");
    setDiagnosticsOpen(panel === "diagnostics");
  }

  const renderedMessages = useMemo(() => {
    const live = liveText[activeSession?.id]
      ? [{ id: "live", role: "assistant", content: liveText[activeSession.id], live: true, taskId: activeRun?.id }]
      : [];
    return [...messages, ...live];
  }, [messages, liveText, activeSession?.id, activeRun?.id]);

  useEffect(() => {
    if (renderedMessages.length === 0 && !activeRun) {
      const frame = requestAnimationFrame(() => {
        feedRef.current?.scrollTo({ top: 0, behavior: "auto" });
      });
      return () => cancelAnimationFrame(frame);
    }
    const frame = requestAnimationFrame(() => {
      feedEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    });
    return () => cancelAnimationFrame(frame);
  }, [renderedMessages.length, activeRun?.id, liveText[activeSession?.id]]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="icon-button tone-cyan" onClick={() => openPanel("sessions")} aria-label="Open sessions">
          <Menu size={22} />
        </button>
        <div className="title-stack">
          <span className="product-line">
            <ToneMark tone={activeRun ? runTone(activeRun.status) : serviceReady ? "green" : "gray"} />
            Cursor Mobile
          </span>
          <strong>{activeSession?.title || "New Chat"}</strong>
          <span className="context-line">
            <Folder size={12} /> {activeRun ? activeRun.status : activeProject?.name || "Home"} / {model} / {effort}
          </span>
        </div>
        <button className="icon-button tone-yellow" onClick={() => openPanel("tools")} aria-label="Open tools">
          <MoreHorizontal size={22} />
        </button>
      </header>

      <section ref={feedRef} className={`chat-feed ${renderedMessages.length ? "has-messages" : "is-empty"}`}>
        {renderedMessages.length === 0 && (
          <div className="empty-state">
            <div className="empty-mark" aria-hidden="true">
              <Bot size={35} />
              <span className="empty-accent red" />
              <span className="empty-accent yellow" />
              <span className="empty-accent green" />
            </div>
            <h1>今天想让 Cursor 做什么？</h1>
            <p>{boot.health?.proxy?.HTTPS_PROXY ? "自然语言驱动，终端级能力，尽在掌控。" : serviceReady ? "Ready on your Mac." : "Waiting for your Mac."}</p>
            <div className="empty-pills" aria-label="Service status">
              <span className="tone-green"><Activity size={14} /> {serviceReady ? "Service ready" : "Service unknown"}</span>
              <span className="tone-orange">Proxy {boot.health?.proxy?.HTTPS_PROXY ? "on" : "off"}</span>
            </div>
            <div className="prompt-grid" aria-label="Suggested prompts">
              {QUICK_PROMPTS.map((item) => (
                <button key={item.title} className={`prompt-card tone-${item.tone}`} type="button" onClick={() => setPrompt(item.prompt)}>
                  <ToneMark tone={item.tone} />
                  <span>{item.title}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {renderedMessages.map((message) => {
          const run = message.taskId ? boot.runs.find((item) => item.id === message.taskId) : null;
          const tone = message.role === "user" ? "red" : run?.status === "failed" ? "red" : message.live ? "green" : "cyan";
          return (
            <article key={message.id} className={`bubble tone-${tone} ${message.role} ${message.live ? "live" : ""} ${run?.status === "failed" ? "failed" : ""}`}>
              <span className="bubble-rail" aria-hidden="true" />
              <div className="bubble-meta">
                <span><ToneMark tone={tone} /> {message.role === "assistant" ? "Cursor" : "You"}</span>
                {message.live && <small>Generating</small>}
                {run?.status === "failed" && <small>Failed</small>}
              </div>
              <p>{message.content}</p>
              {message.live && activeRun && (
                <button className="inline-action tone-red" onClick={() => stopRun(activeRun.id)}>
                  <Square size={15} /> Stop
                </button>
              )}
              {run?.status === "failed" && (
                <button className="inline-action tone-yellow" onClick={() => retryRun(run.id)}>
                  <RefreshCw size={15} /> Retry
                </button>
              )}
            </article>
          );
        })}
        {activeRun && !liveText[activeSession?.id] && (
          <article className={`bubble assistant live tone-${runTone(activeRun.status)}`}>
            <span className="bubble-rail" aria-hidden="true" />
            <div className="bubble-meta">
              <span><ToneMark tone={runTone(activeRun.status)} /> Cursor</span>
              <small>{activeRun.status === "queued" ? "Waiting" : "Thinking"}</small>
            </div>
            <p className="pulse-line">Working on your Mac</p>
            <button className="inline-action tone-red" onClick={() => stopRun(activeRun.id)}>
              <Square size={15} /> Stop
            </button>
          </article>
        )}
        <div className="feed-anchor" ref={feedEndRef} aria-hidden="true" />
      </section>

      <footer className="composer">
        <div className="composer-shell">
          {sendError && <div className="composer-error">{sendError}</div>}
          {attachments.length > 0 && (
            <div className="attachment-strip" aria-label="Attachments">
              {attachments.map((attachment) => (
                <span className="attachment-chip tone-cyan" key={attachment.id}>
                  <FileText size={14} />
                  <span>{attachment.name}</span>
                  <small>{formatBytes(attachment.size)}</small>
                  <button
                    type="button"
                    onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}
                    aria-label={`Remove ${attachment.name}`}
                  >
                    <X size={13} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="composer-hud" aria-label="Current settings">
            <button className="hud-chip tone-green" type="button" onClick={() => openPanel("tools")}><ToneMark tone="green" />{model}</button>
            <button className="hud-chip tone-yellow" type="button" onClick={() => openPanel("tools")}><ToneMark tone="yellow" />{effort}</button>
            <button className={`hud-chip tone-${currentAccessTone}`} type="button" onClick={() => openPanel("tools")}><ToneMark tone={currentAccessTone} />{sandbox}</button>
          </div>
          <div className="composer-row">
            <label className={`attach-button tone-cyan ${activeRun ? "disabled" : ""}`} aria-label="Attach files">
              <Paperclip size={20} />
              <input type="file" hidden multiple onChange={addAttachments} disabled={Boolean(activeRun)} />
            </label>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={handlePromptKeyDown}
              placeholder={activeRun ? "Cursor is replying in this session..." : attachments.length ? "描述附件任务、权限或参数..." : "描述任务、插件、权限或参数..."}
              disabled={Boolean(activeRun)}
              rows={1}
            />
            <button className="send-button" onClick={sendPrompt} disabled={(!prompt.trim() && attachments.length === 0) || Boolean(activeRun)} aria-label="Send">
              <Send size={21} />
            </button>
          </div>
        </div>
      </footer>

      <button
        className={`scrim ${sidebarOpen || toolsOpen || filesOpen || diagnosticsOpen ? "visible" : ""}`}
        onClick={() => {
          setSidebarOpen(false);
          setToolsOpen(false);
          setFilesOpen(false);
          setDiagnosticsOpen(false);
        }}
        aria-label="Close panels"
        tabIndex={sidebarOpen || toolsOpen || filesOpen || diagnosticsOpen ? 0 : -1}
      />

      <SessionDrawer
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        projects={boot.projects}
        sessions={boot.sessions}
        activeProjectId={activeProject?.id}
        activeSessionId={activeSession?.id}
        onProject={(id) => {
          setActiveProjectId(id);
          setActiveSessionId("");
          setMessages([]);
          refresh();
        }}
        onSession={(id) => {
          setActiveSessionId(id);
          setSidebarOpen(false);
        }}
        onCreateProject={createProject}
        onCreateSession={createSession}
        onRenameProject={renameProject}
        onDeleteProject={deleteProject}
        onRenameSession={renameSession}
        onDeleteSession={deleteSession}
      />
      <ToolsDrawer
        open={toolsOpen}
        onClose={() => setToolsOpen(false)}
        model={model}
        effort={effort}
        models={modelOptions}
        health={boot.health}
        onModel={setModel}
        onEffort={setEffort}
        sandbox={sandbox}
        approvalPolicy={approvalPolicy}
        onSandbox={setSandbox}
        onApprovalPolicy={setApprovalPolicy}
        onFiles={() => openPanel("files")}
        onDiagnostics={() => openPanel("diagnostics")}
      />
      <FileDrawer open={filesOpen} onClose={() => setFilesOpen(false)} />
      <DiagnosticsDrawer open={diagnosticsOpen} onClose={() => setDiagnosticsOpen(false)} runs={boot.runs} health={boot.health} />
    </main>
  );
}

function SessionDrawer({
  open,
  onClose,
  projects,
  sessions,
  activeProjectId,
  activeSessionId,
  onProject,
  onSession,
  onCreateProject,
  onCreateSession,
  onRenameProject,
  onDeleteProject,
  onRenameSession,
  onDeleteSession,
}) {
  return (
    <aside className={`drawer left ${open ? "open" : ""}`} aria-hidden={!open} inert={open ? undefined : ""}>
      <div className="drawer-head">
        <button className="icon-button tone-gray" onClick={onClose} aria-label="Close sessions"><ChevronLeft size={20} /></button>
        <strong>Workspace</strong>
        <button className="icon-button tone-cyan" onClick={onCreateProject} aria-label="Add project"><FolderPlus size={20} /></button>
      </div>
      <div className="drawer-hero">
        <span className="hero-spark" aria-hidden="true" />
        <strong>Projects and chats</strong>
        <p>Pick a Mac folder, then keep each Cursor thread organized under that project.</p>
      </div>
      <div className="project-tree">
        {projects.map((project) => (
          <ProjectNode
            key={project.id}
            project={project}
            sessions={sessions.filter((session) => session.projectId === project.id)}
            activeProjectId={activeProjectId}
            activeSessionId={activeSessionId}
            onProject={onProject}
            onSession={onSession}
            onCreateSession={onCreateSession}
            onRenameProject={onRenameProject}
            onDeleteProject={onDeleteProject}
            onRenameSession={onRenameSession}
            onDeleteSession={onDeleteSession}
          />
        ))}
      </div>
    </aside>
  );
}

function ProjectNode({
  project,
  sessions,
  activeProjectId,
  activeSessionId,
  onProject,
  onSession,
  onCreateSession,
  onRenameProject,
  onDeleteProject,
  onRenameSession,
  onDeleteSession,
}) {
  const selected = project.id === activeProjectId;
  const [editingProject, setEditingProject] = useState(false);
  const [projectName, setProjectName] = useState(project.name);
  const [creatingChat, setCreatingChat] = useState(false);
  const [newChatTitle, setNewChatTitle] = useState("");
  const [editingSessionId, setEditingSessionId] = useState("");
  const [sessionTitle, setSessionTitle] = useState("");

  useEffect(() => {
    setProjectName(project.name);
  }, [project.name]);

  function submitProjectName(event) {
    event.preventDefault();
    const nextName = projectName.trim();
    if (nextName) onRenameProject(project, nextName);
    setEditingProject(false);
  }

  function submitNewChat(event) {
    event.preventDefault();
    const title = newChatTitle.trim() || "New Chat";
    onCreateSession(title);
    setNewChatTitle("");
    setCreatingChat(false);
  }

  function submitSessionName(event, session) {
    event.preventDefault();
    const title = sessionTitle.trim();
    if (title) onRenameSession(session, title);
    setEditingSessionId("");
    setSessionTitle("");
  }

  return (
    <article className={`project-node ${selected ? "active tone-cyan" : "tone-gray"}`}>
      {editingProject ? (
        <form className="project-main inline-edit project-edit" onSubmit={submitProjectName}>
          <ToneMark tone="cyan" />
          <Folder size={18} />
          <input
            autoFocus
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setProjectName(project.name);
                setEditingProject(false);
              }
            }}
            aria-label={`Rename ${project.name}`}
          />
          <button className="icon-button compact tone-green" type="submit" aria-label="Save project name">
            <Check size={15} />
          </button>
          <button
            className="icon-button compact tone-gray"
            type="button"
            onClick={() => {
              setProjectName(project.name);
              setEditingProject(false);
            }}
            aria-label="Cancel project rename"
          >
            <X size={15} />
          </button>
        </form>
      ) : (
        <>
          <div
            className="project-main"
            role="button"
            tabIndex="0"
            onClick={() => onProject(project.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onProject(project.id);
              }
            }}
          >
            <ToneMark tone={selected ? "cyan" : "gray"} />
            <Folder size={18} />
            <span>
              <strong>{project.name}</strong>
              <small>{project.path}</small>
            </span>
            <ChevronDown size={17} className={selected ? "chevron open" : "chevron"} />
          </div>
          <div className="project-actions">
            <button
              className="icon-button compact tone-yellow"
              onClick={() => {
                setProjectName(project.name);
                setEditingProject(true);
              }}
              aria-label={`Rename ${project.name}`}
            >
              <Pencil size={15} />
            </button>
            <button className="icon-button danger compact tone-red" onClick={() => onDeleteProject(project)} aria-label={`Delete ${project.name}`}>
              <Trash2 size={15} />
            </button>
          </div>
        </>
      )}
      {selected && (
        <div className="chat-branch">
          <div className="branch-title">
            <span>Chats</span>
            <button className="mini-button tone-green" onClick={() => setCreatingChat(true)}><Plus size={14} /> New</button>
          </div>
          {creatingChat && (
            <form className="chat-row chat-edit tone-green" onSubmit={submitNewChat}>
              <ToneMark tone="green" />
              <FileText size={16} />
              <input
                autoFocus
                value={newChatTitle}
                onChange={(event) => setNewChatTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setNewChatTitle("");
                    setCreatingChat(false);
                  }
                }}
                placeholder="Name this chat"
                aria-label="New chat name"
              />
              <button className="icon-button compact tone-green" type="submit" aria-label="Create chat">
                <Check size={14} />
              </button>
              <button
                className="icon-button compact tone-gray"
                type="button"
                onClick={() => {
                  setNewChatTitle("");
                  setCreatingChat(false);
                }}
                aria-label="Cancel new chat"
              >
                <X size={14} />
              </button>
            </form>
          )}
          {sessions.length === 0 && <p className="empty-branch">No chats yet. Start with a natural language task.</p>}
          {sessions.map((session) => (
            editingSessionId === session.id ? (
              <form key={session.id} className="chat-row chat-edit tone-green" onSubmit={(event) => submitSessionName(event, session)}>
                <ToneMark tone="green" />
                <FileText size={16} />
                <input
                  autoFocus
                  value={sessionTitle}
                  onChange={(event) => setSessionTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setEditingSessionId("");
                      setSessionTitle("");
                    }
                  }}
                  aria-label={`Rename ${session.title}`}
                />
                <button className="icon-button compact tone-green" type="submit" aria-label="Save chat name">
                  <Check size={14} />
                </button>
                <button
                  className="icon-button compact tone-gray"
                  type="button"
                  onClick={() => {
                    setEditingSessionId("");
                    setSessionTitle("");
                  }}
                  aria-label="Cancel chat rename"
                >
                  <X size={14} />
                </button>
              </form>
            ) : (
              <div
                key={session.id}
                className={session.id === activeSessionId ? "chat-row active tone-green" : "chat-row tone-gray"}
                role="button"
                tabIndex="0"
                onClick={() => onSession(session.id)}
              >
                <ToneMark tone={session.id === activeSessionId ? "green" : "gray"} />
                <FileText size={16} />
                <span>{session.title}</span>
                <button
                  className="icon-button compact tone-yellow"
                  onClick={(event) => {
                    event.stopPropagation();
                    setEditingSessionId(session.id);
                    setSessionTitle(session.title);
                  }}
                  aria-label={`Rename ${session.title}`}
                >
                  <Pencil size={14} />
                </button>
                <button className="icon-button danger compact tone-red" onClick={(event) => { event.stopPropagation(); onDeleteSession(session.id); }} aria-label={`Delete ${session.title}`}>
                  <Trash2 size={14} />
                </button>
              </div>
            )
          ))}
        </div>
      )}
    </article>
  );
}

function SettingSelect({ tone, label, value, helper, onChange, children }) {
  return (
    <label className={`setting-card tone-${tone}`}>
      <span className="setting-head">
        <ToneMark tone={tone} />
        <span>
          <strong>{label}</strong>
          <small>{helper}</small>
        </span>
      </span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </label>
  );
}

function ToolsDrawer({ open, onClose, model, effort, models, health, sandbox, approvalPolicy, onModel, onEffort, onSandbox, onApprovalPolicy, onFiles, onDiagnostics }) {
  const accessTone = permissionTone(sandbox);

  return (
    <aside className={`drawer right ${open ? "open" : ""}`} aria-hidden={!open} inert={open ? undefined : ""}>
      <div className="drawer-head">
        <strong>Tools</strong>
        <button className="icon-button tone-gray" onClick={onClose} aria-label="Close tools"><X size={20} /></button>
      </div>
      <div className="settings-panel">
        <SettingSelect tone="green" label="Model" value={model} helper="Generation engine" onChange={onModel}>
          {models.map((item) => (
            <option key={item.slug} value={item.slug}>
              {item.display_name || item.slug}
            </option>
          ))}
        </SettingSelect>
        <SettingSelect tone="yellow" label="Reasoning" value={effort} helper="Thinking depth" onChange={onEffort}>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="xhigh">XHigh</option>
        </SettingSelect>
        <SettingSelect tone={accessTone} label="Sandbox" value={sandbox} helper="Workspace access" onChange={onSandbox}>
          <option value="read-only">Read only</option>
          <option value="workspace-write">Workspace write</option>
          <option value="danger-full-access">Danger full access</option>
        </SettingSelect>
        <SettingSelect tone="orange" label="Approval" value={approvalPolicy} helper="Run confirmation" onChange={onApprovalPolicy}>
          <option value="never">Never ask</option>
          <option value="on-request">Ask on request</option>
          <option value="on-failure">Ask on failure</option>
          <option value="untrusted">Untrusted</option>
        </SettingSelect>
        <div className={`permission-note tone-${sandbox === "danger-full-access" ? "red" : "orange"}`}>
          <ToneMark tone={sandbox === "danger-full-access" ? "red" : "orange"} />
          <span>
            <strong>{sandbox === "danger-full-access" ? "Elevated access" : "Execution access"}</strong>
            <small>{sandbox} / {approvalPolicy}</small>
          </span>
        </div>
        <button className="tool-row tone-cyan" onClick={onFiles}>
          <ToneMark tone="cyan" />
          <Folder size={18} />
          <span>Files</span>
        </button>
        <button className="tool-row tone-yellow" onClick={onDiagnostics}>
          <ToneMark tone="yellow" />
          <Wrench size={18} />
          <span>Diagnostics</span>
        </button>
        <div className="health-tile tone-green">
          <ToneMark tone="green" />
          <strong>Service</strong>
          <span>{health?.service?.url || `${health?.service?.bind || "unknown"}:${health?.service?.port || "8787"}`}</span>
          <span>Proxy {health?.proxy?.HTTPS_PROXY ? "on" : "off"} / Models {health?.models?.usingFallback ? "fallback" : health?.models?.count || 0}</span>
        </div>
      </div>
    </aside>
  );
}

function DiagnosticsDrawer({ open, onClose, runs, health }) {
  return (
    <aside className={`drawer right wide ${open ? "open" : ""}`} aria-hidden={!open} inert={open ? undefined : ""}>
      <div className="drawer-head">
        <strong>Diagnostics</strong>
        <button className="icon-button tone-gray" onClick={onClose} aria-label="Close diagnostics"><X size={20} /></button>
      </div>
      <div className="diagnostic-summary">
        <span className={health?.agentRuntime?.ok ? "tone-green" : "tone-yellow"}><ToneMark tone={health?.agentRuntime?.ok ? "green" : "yellow"} />Runtime {health?.agentRuntime?.ok ? "ok" : "unknown"}</span>
        <span className="tone-orange"><ToneMark tone="orange" />Proxy {health?.proxy?.HTTPS_PROXY ? "on" : "off"}</span>
        <span className="tone-cyan"><ToneMark tone="cyan" />Models {health?.models?.count || 0}</span>
      </div>
      <div className="run-list">
        {runs.map((run) => (
          <article key={run.id} className={`run-card tone-${runTone(run.status)} ${run.status}`}>
            <div>
              <strong><ToneMark tone={runTone(run.status)} />{run.status}</strong>
              <span>{run.model} / {run.effort}</span>
            </div>
            <p>{run.prompt}</p>
            {run.error && <code>{run.error}</code>}
          </article>
        ))}
      </div>
    </aside>
  );
}

function FileDrawer({ open, onClose }) {
  const [path, setPath] = useState("");
  const [listing, setListing] = useState(null);
  const [preview, setPreview] = useState(null);
  const [showSensitive, setShowSensitive] = useState(false);

  async function load(nextPath = path) {
    const data = await api.get(`/api/files/list${nextPath ? `?path=${encodeURIComponent(nextPath)}&showSensitive=${showSensitive}` : `?showSensitive=${showSensitive}`}`);
    setPath(data.path);
    setListing(data);
    setPreview(null);
  }

  useEffect(() => {
    if (open) load().catch(() => {});
  }, [open, showSensitive]);

  async function openItem(item) {
    if (item.type === "directory") return load(item.path);
    const data = await api.get(`/api/files/read?path=${encodeURIComponent(item.path)}&showSensitive=${showSensitive}`);
    setPreview(data);
  }

  async function trash(item) {
    await api.post("/api/files/trash", { path: item.path, showSensitive });
    await load();
  }

  async function upload(event) {
    const file = event.target.files?.[0];
    if (!file || !listing) return;
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    const base64 = btoa(binary);
    await api.post("/api/files/upload", { path: listing.path, name: file.name, contentBase64: base64, showSensitive });
    await load();
  }

  return (
    <aside className={`drawer right wide ${open ? "open" : ""}`} aria-hidden={!open} inert={open ? undefined : ""}>
      <div className="drawer-head">
        <strong>Files</strong>
        <button className="icon-button tone-gray" onClick={onClose} aria-label="Close files"><X size={20} /></button>
      </div>
      <div className="file-toolbar">
        <button className="text-button tone-gray" disabled={!listing?.parent} onClick={() => load(listing.parent)}><ChevronLeft size={17} /> Up</button>
        <label className="text-button tone-cyan"><Upload size={17} /> Upload<input type="file" hidden onChange={upload} /></label>
        <label className="toggle tone-orange"><input type="checkbox" checked={showSensitive} onChange={(event) => setShowSensitive(event.target.checked)} /> Sensitive</label>
      </div>
      <code className="path-line">{listing?.path || path}</code>
      {preview ? (
        <textarea className="preview" value={preview.content} onChange={(event) => setPreview({ ...preview, content: event.target.value })} onBlur={() => api.put("/api/files/write", { ...preview, showSensitive })} />
      ) : (
        <div className="file-list">
          {listing?.items?.map((item) => (
            <div key={item.path} className={`file-row tone-${item.type === "directory" ? "cyan" : "gray"}`} role="button" tabIndex="0" onClick={() => openItem(item)}>
              <ToneMark tone={item.type === "directory" ? "cyan" : "gray"} />
              <Folder size={16} />
              <span>{item.name}</span>
              <small>{item.type}</small>
              <button className="icon-button danger compact tone-red" onClick={(event) => { event.stopPropagation(); trash(item); }} aria-label={`Trash ${item.name}`}><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}

createRoot(document.getElementById("root")).render(<App />);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
