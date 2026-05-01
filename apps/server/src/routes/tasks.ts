import { Router } from "express";
import { taskManager } from "../services/engine/index.js";

export const tasksRouter = Router();

tasksRouter.get("/", (_req, res) => {
  res.json({ tasks: taskManager.listTasks() });
});

tasksRouter.post("/", (req, res, next) => {
  try {
    const task = taskManager.createTask({ ...req.body, approvalPolicy: req.body.approvalPolicy || "never" });
    res.status(201).json({ task });
  } catch (error) {
    next(error);
  }
});

tasksRouter.post("/:id/stop", (req, res) => {
  const { task, outcome } = taskManager.cancel(req.params.id);
  if (outcome === "not_found") return res.status(404).json({ error: "Task not found" });
  res.json({ task, stopped: outcome === "cancelled", reason: outcome === "noop" ? "already_finished" : undefined });
});

tasksRouter.post("/:id/retry", (req, res, next) => {
  try {
    res.status(201).json({ task: taskManager.retry(req.params.id) });
  } catch (error) {
    next(error);
  }
});
