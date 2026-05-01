import { Router } from "express";
import { repo } from "../db/database.js";
import { taskManager } from "../services/engine/index.js";

export const diagnosticsRouter = Router();

diagnosticsRouter.get("/runs", (req, res) => {
  const limit = Number(req.query.limit || 50);
  const runs = taskManager.listTasks().slice(0, limit).map((run) => ({
    ...run,
    events: repo.listTaskEvents(run.id).slice(-12),
  }));
  res.json({ runs });
});
