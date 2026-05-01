import { Router } from "express";
import { appConfig } from "../config/env.js";
import { getModelCatalog } from "../services/modelService.js";

export const configRouter = Router();

configRouter.get("/models", async (_req, res) => {
  res.json(await getModelCatalog());
});

configRouter.get("/runtime", (_req, res) => {
  res.json({
    engine: appConfig.engine,
    supportedEngines: ["codex", "cursor"],
  });
});
