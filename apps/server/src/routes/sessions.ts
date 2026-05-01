import { Router } from "express";
import { repo } from "../db/database.js";

export const sessionsRouter = Router();

sessionsRouter.get("/", (req, res) => {
  res.json({
    sessions: repo.listSessions(req.query.projectId ? String(req.query.projectId) : undefined, req.query.archived === "true"),
  });
});

sessionsRouter.post("/", (req, res, next) => {
  try {
    const session = repo.createSession({
      projectId: String(req.body.projectId),
      title: String(req.body.title || "New Session"),
      model: String(req.body.model || "gpt-5.5"),
      effort: req.body.effort || "medium",
      agentSessionId: req.body.agentSessionId || req.body.codexSessionId || null,
      codexSessionId: req.body.codexSessionId || req.body.agentSessionId || null,
    });
    res.status(201).json({ session });
  } catch (error) {
    next(error);
  }
});

sessionsRouter.get("/:id/messages", (req, res) => {
  res.json({ messages: repo.listMessages(req.params.id) });
});

sessionsRouter.patch("/:id", (req, res) => {
  const session = repo.updateSession(req.params.id, req.body);
  if (!session) return res.status(404).json({ error: "Session not found" });
  res.json({ session });
});

sessionsRouter.delete("/:id", (req, res) => {
  const deleted = repo.deleteSession(req.params.id);
  if (!deleted) return res.status(404).json({ error: "Session not found" });
  res.json({ deleted: true });
});
