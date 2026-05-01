import { Router } from "express";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { repo } from "../db/database.js";
import { appConfig } from "../config/env.js";

export const projectsRouter = Router();
const execFileAsync = promisify(execFile);

projectsRouter.get("/", (req, res) => {
  res.json({ projects: repo.listProjects(req.query.archived === "true") });
});

projectsRouter.post("/", (req, res, next) => {
  try {
    const projectPath = path.resolve(String(req.body.path || appConfig.homeDir));
    if (!fs.existsSync(projectPath) || !fs.statSync(projectPath).isDirectory()) {
      throw new Error("Project path must be an existing directory");
    }
    const name = String(req.body.name || path.basename(projectPath) || "Home");
    res.status(201).json({ project: repo.createProject(name, projectPath) });
  } catch (error) {
    next(error);
  }
});

projectsRouter.post("/pick-folder", async (req, res, next) => {
  try {
    const prompt = String(req.body.prompt || "Choose a Cursor project folder");
    const { stdout } = await execFileAsync("osascript", [
      "-e",
      `POSIX path of (choose folder with prompt ${JSON.stringify(prompt)})`,
    ]);
    const projectPath = path.resolve(stdout.trim() || appConfig.homeDir);
    if (!fs.existsSync(projectPath) || !fs.statSync(projectPath).isDirectory()) {
      throw new Error("Project path must be an existing directory");
    }
    const name = String(req.body.name || path.basename(projectPath) || "Home");
    res.status(201).json({ project: repo.createProject(name, projectPath) });
  } catch (error: any) {
    if (String(error?.message || "").includes("User canceled")) {
      return res.json({ cancelled: true });
    }
    next(error);
  }
});

projectsRouter.patch("/:id", (req, res, next) => {
  try {
    const project = repo.updateProject(req.params.id, {
      name: req.body.name,
      archived: req.body.archived,
    });
    if (!project) return res.status(404).json({ error: "Project not found" });
    res.json({ project });
  } catch (error) {
    next(error);
  }
});
