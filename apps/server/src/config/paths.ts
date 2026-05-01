import fs from "node:fs";
import path from "node:path";
import { appConfig } from "./env.js";

export const paths = {
  dataHome: appConfig.dataHome,
  db: path.join(appConfig.dataHome, "codex-mobile.sqlite"),
  logs: path.join(appConfig.dataHome, "logs"),
  uploads: path.join(appConfig.dataHome, "uploads"),
  tmp: path.join(appConfig.dataHome, "tmp"),
};

export function ensureAppDirs(): void {
  for (const dir of [paths.dataHome, paths.logs, paths.uploads, paths.tmp]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
