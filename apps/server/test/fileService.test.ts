import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

async function setup() {
  vi.resetModules();
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cursor-mobile-files-"));
  const home = path.join(tempRoot, "home");
  await fs.mkdir(home, { recursive: true });
  process.env.HOME = home;
  const service = await import("../src/services/fileService.js");
  return { ...service, tempRoot, home };
}

let cleanup: (() => Promise<void>) | undefined;
const originalHome = process.env.HOME;

afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
  if (originalHome) process.env.HOME = originalHome;
  else delete process.env.HOME;
});

describe("fileService", () => {
  it("blocks symlink escapes outside the home directory", async () => {
    const ctx = await setup();
    cleanup = () => fs.rm(ctx.tempRoot, { recursive: true, force: true });

    const outside = path.join(ctx.tempRoot, "outside.txt");
    await fs.writeFile(outside, "outside-secret", "utf8");
    await fs.symlink(outside, path.join(ctx.home, "escape.txt"));

    await expect(ctx.readFile("~/escape.txt")).rejects.toThrow(/outside/);
    await expect(ctx.writeFile("~/escape.txt", "nope")).rejects.toThrow(/outside/);
    await expect(ctx.trashFile("~/escape.txt")).rejects.toThrow(/outside/);
  });

  it("hides sensitive files by default and allows them only when requested", async () => {
    const ctx = await setup();
    cleanup = () => fs.rm(ctx.tempRoot, { recursive: true, force: true });

    await fs.writeFile(path.join(ctx.home, ".env"), "TOKEN=old", "utf8");

    const hidden = await ctx.listFiles("~");
    expect(hidden.items.some((item) => item.name === ".env")).toBe(false);
    await expect(ctx.readFile("~/.env")).rejects.toThrow(/Sensitive/);

    const visible = await ctx.listFiles("~", true);
    expect(visible.items.find((item) => item.name === ".env")?.sensitive).toBe(true);
    expect((await ctx.readFile("~/.env", true)).content).toBe("TOKEN=old");
    expect((await ctx.writeFile("~/.env", "TOKEN=new", true)).content).toBe("TOKEN=new");
  });

  it("blocks upload, rename, mkdir, and trash operations through escaped paths", async () => {
    const ctx = await setup();
    cleanup = () => fs.rm(ctx.tempRoot, { recursive: true, force: true });

    const outsideDir = path.join(ctx.tempRoot, "outside");
    await fs.mkdir(outsideDir);
    await fs.symlink(outsideDir, path.join(ctx.home, "external"));
    await fs.writeFile(path.join(outsideDir, "target.txt"), "secret", "utf8");

    await expect(ctx.uploadFile("~/external", "new.txt", Buffer.from("x").toString("base64"))).rejects.toThrow(/outside/);
    await expect(ctx.renameFile("~/external/target.txt", "renamed.txt")).rejects.toThrow(/outside/);
    await expect(ctx.makeDirectory("~/external", "child")).rejects.toThrow(/outside/);
    await expect(ctx.trashFile("~/external/target.txt")).rejects.toThrow(/outside/);
  });
});
