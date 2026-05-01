import express from "express";
import cors from "cors";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appConfig, resolveBindHost } from "./config/env.js";
import { repo } from "./db/database.js";
import { eventHub } from "./ws/hub.js";
import { projectsRouter } from "./routes/projects.js";
import { sessionsRouter } from "./routes/sessions.js";
import { tasksRouter } from "./routes/tasks.js";
import { filesRouter } from "./routes/files.js";
import { configRouter } from "./routes/config.js";
import { healthRouter } from "./routes/health.js";
import { chatRouter } from "./routes/chat.js";
import { runsRouter } from "./routes/runs.js";
import { diagnosticsRouter } from "./routes/diagnostics.js";

const app = express();
app.use(cors({ origin: appConfig.webOrigin, credentials: false }));
app.use(express.json({ limit: "50mb" }));

app.use("/api/health", healthRouter);
app.use("/api/chat", chatRouter);
app.use("/api/projects", projectsRouter);
app.use("/api/sessions", sessionsRouter);
app.use("/api/runs", runsRouter);
app.use("/api/tasks", tasksRouter);
app.use("/api/files", filesRouter);
app.use("/api/config", configRouter);
app.use("/api/diagnostics", diagnosticsRouter);

app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(400).json({ error: error?.message || String(error) });
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(__dirname, "../../web/dist");
app.use(express.static(webDist));
app.get("*", (_req, res) => {
  res.sendFile(path.join(webDist, "index.html"), (error) => {
    if (error) res.status(404).send("Agent Mobile web build not found. Run npm run build.");
  });
});

async function main() {
  repo.markInterruptedTasks();

  if (repo.listProjects(true).length === 0) {
    repo.createProject("Home", appConfig.homeDir);
  }

  const host = await resolveBindHost();
  const server = http.createServer(app);
  eventHub.attach(server);
  server.listen(appConfig.port, host, () => {
    console.log(`Agent Mobile (${appConfig.engine}) listening on http://${host}:${appConfig.port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
