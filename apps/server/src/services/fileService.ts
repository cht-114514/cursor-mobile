import fs from "node:fs/promises";
import fssync from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import mime from "mime-types";

const execFileAsync = promisify(execFile);
const home = os.homedir();
const sensitiveNames = new Set([".ssh", ".gnupg", ".aws", ".config", ".env", ".npmrc", ".netrc"]);
const sensitivePattern = /(id_rsa|id_ed25519|private[_-]?key|\.pem$|\.p12$|\.key$|token|secret|credential)/i;

export function resolveHomePath(inputPath?: string): string {
  const target = inputPath ? path.resolve(inputPath.replace(/^~(?=$|\/)/, home)) : home;
  const relative = path.relative(home, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path is outside the allowed home directory");
  }
  return target;
}

function assertInsideHome(targetPath: string, rootPath = home): void {
  const relative = path.relative(rootPath, targetPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path is outside the allowed home directory");
  }
}

async function realHome(): Promise<string> {
  return fs.realpath(home);
}

async function resolveExistingHomePath(inputPath: string): Promise<string> {
  const target = resolveHomePath(inputPath);
  const [root, realTarget] = await Promise.all([realHome(), fs.realpath(target)]);
  assertInsideHome(realTarget, root);
  return target;
}

async function resolveWritableHomePath(inputPath: string): Promise<string> {
  const target = resolveHomePath(inputPath);
  const root = await realHome();
  try {
    const realTarget = await fs.realpath(target);
    assertInsideHome(realTarget, root);
    return target;
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }
  const parent = path.dirname(target);
  const realParent = await fs.realpath(parent);
  assertInsideHome(realParent, root);
  return target;
}

export function isSensitive(targetPath: string): boolean {
  const relative = path.relative(home, targetPath);
  return relative
    .split(path.sep)
    .some((part) => sensitiveNames.has(part) || sensitivePattern.test(part));
}

async function hasSensitivePath(targetPath: string): Promise<boolean> {
  if (isSensitive(targetPath)) return true;
  try {
    return isSensitive(await fs.realpath(targetPath));
  } catch {
    return false;
  }
}

export async function listFiles(inputPath?: string, showSensitive = false) {
  const dir = inputPath ? await resolveExistingHomePath(inputPath) : await resolveExistingHomePath(home);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const items = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      const sensitive = await hasSensitivePath(fullPath);
      if (!showSensitive && sensitive) return null;
      const stat = await fs.stat(fullPath);
      return {
        name: entry.name,
        path: fullPath,
        type: entry.isDirectory() ? "directory" : "file",
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        sensitive,
        mime: entry.isFile() ? mime.lookup(fullPath) || "application/octet-stream" : null,
      };
    }),
  );
  return {
    path: dir,
    parent: dir === home ? null : path.dirname(dir),
    items: items
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "directory" ? -1 : 1)),
  };
}

export async function readFile(inputPath: string, showSensitive = false) {
  const filePath = await resolveExistingHomePath(inputPath);
  if (!showSensitive && await hasSensitivePath(filePath)) throw new Error("Sensitive file is hidden");
  const stat = await fs.stat(filePath);
  if (stat.size > 2 * 1024 * 1024) throw new Error("File is too large for inline preview");
  return {
    path: filePath,
    content: await fs.readFile(filePath, "utf8"),
    modifiedAt: stat.mtime.toISOString(),
    mime: mime.lookup(filePath) || "text/plain",
  };
}

export async function writeFile(inputPath: string, content: string, showSensitive = false) {
  const filePath = await resolveWritableHomePath(inputPath);
  if (!showSensitive && await hasSensitivePath(filePath)) throw new Error("Sensitive file is hidden");
  await fs.writeFile(filePath, content, "utf8");
  return readFile(filePath, true);
}

export async function uploadFile(targetDir: string, name: string, contentBase64: string, showSensitive = false) {
  const dir = await resolveExistingHomePath(targetDir);
  const filePath = await resolveWritableHomePath(path.join(dir, path.basename(name)));
  if (!showSensitive && await hasSensitivePath(filePath)) throw new Error("Sensitive file is hidden");
  await fs.writeFile(filePath, Buffer.from(contentBase64, "base64"));
  return { path: filePath };
}

export async function renameFile(inputPath: string, newName: string, showSensitive = false) {
  const from = await resolveExistingHomePath(inputPath);
  const to = await resolveWritableHomePath(path.join(path.dirname(from), path.basename(newName)));
  if (!showSensitive && (await hasSensitivePath(from) || await hasSensitivePath(to))) {
    throw new Error("Sensitive file is hidden");
  }
  await fs.rename(from, to);
  return { path: to };
}

export async function makeDirectory(inputPath: string, name: string, showSensitive = false) {
  const parent = await resolveExistingHomePath(inputPath);
  const dir = await resolveWritableHomePath(path.join(parent, path.basename(name)));
  if (!showSensitive && await hasSensitivePath(dir)) throw new Error("Sensitive file is hidden");
  await fs.mkdir(dir, { recursive: true });
  return { path: dir };
}

export async function trashFile(inputPath: string, showSensitive = false) {
  const filePath = await resolveExistingHomePath(inputPath);
  if (!showSensitive && await hasSensitivePath(filePath)) throw new Error("Sensitive file is hidden");
  try {
    await execFileAsync("osascript", [
      "-e",
      `tell application "Finder" to delete POSIX file ${JSON.stringify(filePath)}`,
    ]);
  } catch {
    const trash = path.join(home, ".Trash");
    const name = `${Date.now()}-${path.basename(filePath)}`;
    const target = path.join(trash, name);
    if (!fssync.existsSync(trash)) await fs.mkdir(trash, { recursive: true });
    await fs.rename(filePath, target);
  }
  return { trashed: true };
}
