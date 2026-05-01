import { Router } from "express";
import { taskManager } from "../services/engine/index.js";

export const runsRouter = Router();

runsRouter.post("/:id/stop", (req, res) => {
  const run = taskManager.cancel(req.params.id);
  if (!run) return res.status(404).json({ error: "Run not found" });
  res.json({ run });
});

runsRouter.post("/:id/retry", (req, res, next) => {
  try {
    res.status(201).json({ run: taskManager.retry(req.params.id) });
  } catch (error) {
    next(error);
  }
});
