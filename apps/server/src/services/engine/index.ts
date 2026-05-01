import { appConfig } from "../../config/env.js";
import { taskManager as codexTaskManager, type TaskManager } from "../codexRunner.js";
import { cursorTaskManager } from "../cursorRunner.js";

export function getTaskManager(): TaskManager {
  return appConfig.engine === "cursor" ? cursorTaskManager : codexTaskManager;
}

export const taskManager = getTaskManager();
