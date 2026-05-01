import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { appConfig, resolveAgentCommand } from "../config/env.js";

const execFileAsync = promisify(execFile);
const MODEL_CACHE_MS = 5 * 60 * 1000;

const fallbackModels = [
  {
    slug: "gpt-5.5",
    display_name: "GPT-5.5",
    default_reasoning_level: "medium",
    supported_reasoning_levels: [
      { effort: "low" },
      { effort: "medium" },
      { effort: "high" },
      { effort: "xhigh" },
    ],
  },
];
const cursorFallbackModels = [
  {
    slug: "composer-2-fast",
    display_name: "Composer 2 Fast",
    default_reasoning_level: "medium",
    supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "high" }],
  },
];

let cachedCatalog: any;
let cacheExpiresAt = 0;
let pendingCatalog: Promise<any> | undefined;

async function loadModelCatalog(): Promise<any> {
  try {
    const command = await resolveAgentCommand();
    const args = appConfig.engine === "cursor" ? ["models"] : ["debug", "models"];
    const { stdout } = await execFileAsync(command, args, {
      timeout: 30000,
      maxBuffer: 80 * 1024 * 1024,
    });
    if (appConfig.engine === "cursor") {
      return {
        models: stdout
          .split(/\r?\n/)
          .map((line) => line.match(/^([a-zA-Z0-9_.-]+)\s+-\s+(.+?)(?:\s+\(.+\))?$/))
          .filter(Boolean)
          .map((match: any) => ({
            slug: match[1],
            display_name: match[2],
            supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "high" }],
          }))
          .filter((model) => model.slug !== "auto")
          .sort((left, right) => Number(right.slug === "composer-2-fast") - Number(left.slug === "composer-2-fast")),
        source: appConfig.engine,
        usingFallback: false,
      };
    }
    const catalog = JSON.parse(stdout);
    return {
      models: (catalog.models || []).map((model: any) => ({
        slug: model.slug,
        display_name: model.display_name || model.slug,
        description: model.description,
        default_reasoning_level: model.default_reasoning_level,
        supported_reasoning_levels: model.supported_reasoning_levels || [],
        visibility: model.visibility,
        supported_in_api: model.supported_in_api,
        priority: model.priority,
      })),
      source: appConfig.engine,
      usingFallback: false,
    };
  } catch (error: any) {
    const fallback = appConfig.engine === "cursor" ? cursorFallbackModels : fallbackModels;
    return {
      models: fallback,
      error: error?.message || String(error),
      source: `${appConfig.engine}-fallback`,
      usingFallback: true,
    };
  }
}

export async function getModelCatalog(options: { force?: boolean } = {}): Promise<any> {
  const now = Date.now();
  if (!options.force && cachedCatalog && now < cacheExpiresAt) {
    return { ...cachedCatalog, cached: true };
  }

  pendingCatalog ??= loadModelCatalog();
  try {
    cachedCatalog = {
      ...(await pendingCatalog),
      fetchedAt: new Date().toISOString(),
    };
    cacheExpiresAt = Date.now() + MODEL_CACHE_MS;
    return { ...cachedCatalog, cached: false };
  } finally {
    pendingCatalog = undefined;
  }
}
