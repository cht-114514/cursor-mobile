import { Router } from "express";
import { taskManager } from "../services/engine/index.js";

export const chatRouter = Router();

chatRouter.post("/send", (req, res, next) => {
  try {
    const result = taskManager.sendChat(req.body);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});
