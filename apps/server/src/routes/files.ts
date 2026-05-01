import { Router } from "express";
import {
  listFiles,
  readFile,
  writeFile,
  uploadFile,
  renameFile,
  makeDirectory,
  trashFile,
} from "../services/fileService.js";

export const filesRouter = Router();

filesRouter.get("/list", async (req, res, next) => {
  try {
    res.json(await listFiles(req.query.path ? String(req.query.path) : undefined, req.query.showSensitive === "true"));
  } catch (error) {
    next(error);
  }
});

filesRouter.get("/read", async (req, res, next) => {
  try {
    res.json(await readFile(String(req.query.path), req.query.showSensitive === "true"));
  } catch (error) {
    next(error);
  }
});

filesRouter.put("/write", async (req, res, next) => {
  try {
    res.json(await writeFile(String(req.body.path), String(req.body.content ?? ""), req.body.showSensitive === true));
  } catch (error) {
    next(error);
  }
});

filesRouter.post("/upload", async (req, res, next) => {
  try {
    res.status(201).json(await uploadFile(String(req.body.path), String(req.body.name), String(req.body.contentBase64), req.body.showSensitive === true));
  } catch (error) {
    next(error);
  }
});

filesRouter.post("/mkdir", async (req, res, next) => {
  try {
    res.status(201).json(await makeDirectory(String(req.body.path), String(req.body.name), req.body.showSensitive === true));
  } catch (error) {
    next(error);
  }
});

filesRouter.patch("/rename", async (req, res, next) => {
  try {
    res.json(await renameFile(String(req.body.path), String(req.body.name), req.body.showSensitive === true));
  } catch (error) {
    next(error);
  }
});

filesRouter.post("/trash", async (req, res, next) => {
  try {
    res.json(await trashFile(String(req.body.path), req.body.showSensitive === true));
  } catch (error) {
    next(error);
  }
});
