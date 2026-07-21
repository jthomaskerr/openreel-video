/**
 * Environment configuration for the Music Video Orchestrator.
 * All generation API keys live server-side only.
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const home = homedir();

const __dir = dirname(fileURLToPath(import.meta.url));

function loadDotenv(): Record<string, string> {
  const paths = [
    join(__dir, "../../.env"),
    join(__dir, "../../../.env"),
    // Reuse the music-video-studio .env if present
    join(__dir, "../../../../music-video-studio/.env"),
  ];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    const result: Record<string, string> = {};
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq < 0) continue;
      const key = t.slice(0, eq).trim();
      const raw = t.slice(eq + 1).trim();
      result[key] = raw.replace(/^(['"])(.*)\1$/, "$2");
    }
    return result;
  }
  return {};
}

const dotenv = loadDotenv();

function env(key: string, fallback = ""): string {
  return process.env[key] ?? dotenv[key] ?? fallback;
}

export function parseProjectCommitDebounceMs(value: string | undefined): number {
  const raw = value ?? "120000";
  const parsed = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    throw new Error(
      "MV_PROJECT_COMMIT_DEBOUNCE_MS must be a finite non-negative integer",
    );
  }
  return parsed;
}

export function parseBooleanFlag(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

export const config = {
  port: parseInt(env("ORCHESTRATOR_PORT", "4041"), 10),
  projectCommitDebounceMs: parseProjectCommitDebounceMs(
    env("MV_PROJECT_COMMIT_DEBOUNCE_MS", "120000"),
  ),
  wavespeedApiKey: env("WAVESPEED_API_KEY"),
  wavespeedBaseUrl: env("WAVESPEED_BASE_URL", "https://api.wavespeed.ai/api/v3"),
  orchestratorAuthToken: env("ORCHESTRATOR_AUTH_TOKEN"),
  authenticatedOwnerId: env("ORCHESTRATOR_AUTH_OWNER_ID", "local-owner"),
  generationRouteManifestJson: env("GENERATION_ROUTE_MANIFEST_JSON", "[]"),
  generationV2ReleaseEnabled: parseBooleanFlag(env("GENERATION_V2_RELEASE_ENABLED")),
  kieAiApiKey: env("KIE_AI_API_KEY"),
  kieAiVideoModel: env("KIE_AI_VIDEO_MODEL", "veo3_fast"),
  kieAiImageModel: env("KIE_AI_IMAGE_MODEL", "flux-kontext-pro"),
  claudeToken: env("CLAUDE_OAUTH_TOKEN"),
  openaiToken: env("OPENAI_TOKEN"),
  mvdBin: env(
    "MVD_BIN",
    join(__dir, "../../../../mvd-skill/.venv/bin/mvd"),
  ),
  projectsRepo: env(
    "MV_PROJECTS_REPO",
    join(home, "openreel-projects"),
  ),
  generatedAssetsDir: env(
    "MV_GENERATED_ASSETS_DIR",
    join(__dir, "../../../generated-assets"),
  ),
  generationDataDir: env("MV_GENERATION_DATA_DIR", join(__dir, "../../../generated-assets/generation")),
} as const;
