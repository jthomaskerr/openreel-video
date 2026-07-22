import { readFile, writeFile, readdir, rm, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Project, ProjectSettings } from "@openreel/core";
import { createInfrastructureNonce } from "@openreel/core/identity/durable-id";
import type { GitStore } from "./git-store";
import {
  recoverInterruptedSave,
  recoverInterruptedSaveUnderLock,
} from "./save-transaction";
import type { LfsRemoteObjectCheck } from "./lfs-integrity";
import {
  auditProjectMediaManifest,
  type ProjectMediaManifestSnapshot,
} from "./media-manifest";
import {
  assertValidProjectId,
  isValidMediaFilename,
  isValidMediaId,
  isValidProjectId,
} from "./storage-validation";
import { assertExternallyReferencedMediaPreserved } from "./external-media";

export {
  assertExternallyReferencedMediaPreserved,
  ExternalMediaDeleteBlockedError,
} from "./external-media";

export interface ProjectSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly createdAt: number;
  readonly modifiedAt: number;
  readonly duration: number;
  readonly frameRate: number;
  readonly trackCount: number;
  readonly clipCount: number;
  readonly representativeMediaId?: string;
}

export type ProjectSummaryErrorKind = "invalid_json" | "not_found" | "unavailable";

export class ProjectSummaryLoadError extends Error {
  readonly code = "PROJECT_SUMMARY_UNAVAILABLE";

  constructor(
    readonly projectId: string,
    readonly kind: ProjectSummaryErrorKind,
  ) {
    super(`Project ${projectId} summary is unavailable (${kind})`);
    this.name = "ProjectSummaryLoadError";
  }
}

export interface ProjectMediaAuditOptions {
  /** Defaults to true; false is reserved for lower-level manifest-only checks. */
  readonly verifyLfs?: boolean;
  readonly checkRemoteObject?: LfsRemoteObjectCheck;
  readonly pointerSource?: "HEAD" | "index";
  readonly allowDanglingClips?: boolean;
}

function defaultSettings(): ProjectSettings {
  return {
    width: 1920,
    height: 1080,
    frameRate: 30,
    sampleRate: 48000,
    channels: 2,
  };
}

function defaultProject(overrides: {
  id: string;
  name: string;
  settings?: Partial<ProjectSettings>;
}): Project {
  const now = Date.now();
  return {
    id: overrides.id,
    name: overrides.name,
    createdAt: now,
    modifiedAt: now,
    settings: { ...defaultSettings(), ...overrides.settings },
    mediaLibrary: { items: [] },
    generatedImageDefinitions: [],
    timeline: { tracks: [], subtitles: [], markers: [], duration: 0 },
  };
}

/** Slugify a project name for use as a directory/URL token. */
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .replace(/-{2,}/g, "-")
    || "untitled";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function projectSummaryErrorKind(error: unknown): ProjectSummaryErrorKind {
  if (error instanceof SyntaxError) return "invalid_json";
  if (isRecord(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")) return "not_found";
  return "unavailable";
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${field} must be a non-empty string`);
  return value;
}

function requiredFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${field} must be a finite number`);
  return value;
}

function summarizePersistedProject(value: unknown, directoryId: string): ProjectSummary {
  if (!isRecord(value)) throw new Error("project.json must contain an object");
  const id = requiredString(value.id, "id");
  if (!isValidProjectId(id) || id !== directoryId) throw new Error("id must match the project directory");
  const name = requiredString(value.name, "name");
  const createdAt = requiredFiniteNumber(value.createdAt, "createdAt");
  const modifiedAt = requiredFiniteNumber(value.modifiedAt, "modifiedAt");
  if (value.description !== undefined && typeof value.description !== "string") {
    throw new Error("description must be a string when present");
  }
  if (!isRecord(value.settings)) throw new Error("settings must be an object");
  const frameRate = requiredFiniteNumber(value.settings.frameRate, "settings.frameRate");
  if (frameRate <= 0) throw new Error("settings.frameRate must be positive");
  if (!isRecord(value.timeline)) throw new Error("timeline must be an object");
  const duration = requiredFiniteNumber(value.timeline.duration, "timeline.duration");
  if (duration < 0) throw new Error("timeline.duration must be non-negative");
  if (!Array.isArray(value.timeline.tracks)) throw new Error("timeline.tracks must be an array");
  const subtitles = value.timeline.subtitles === undefined ? [] : value.timeline.subtitles;
  if (!Array.isArray(subtitles)) throw new Error("timeline.subtitles must be an array when present");
  if (!isRecord(value.mediaLibrary) || !Array.isArray(value.mediaLibrary.items)) {
    throw new Error("mediaLibrary.items must be an array");
  }
  const clipCount = value.timeline.tracks.reduce((count, track, index) => {
    if (!isRecord(track) || !Array.isArray(track.clips)) throw new Error(`timeline.tracks[${index}].clips must be an array`);
    return count + track.clips.length;
  }, 0) + subtitles.length;
  const representativeMediaId = value.mediaLibrary.items.find((media) => isRecord(media)
    && typeof media.id === "string"
    && (media.type === "video" || media.type === "image" || media.type === "audio")) as Record<string, unknown> | undefined;
  return {
    id,
    name,
    description: value.description ?? "",
    createdAt,
    modifiedAt,
    duration,
    frameRate,
    trackCount: value.timeline.tracks.length,
    clipCount,
    representativeMediaId: typeof representativeMediaId?.id === "string" ? representativeMediaId.id : undefined,
  };
}

export class ProjectStore {
  constructor(private readonly gitStore: GitStore) {}

  /** Worktree path for a project. */
  projectDir(id: string): string {
    assertValidProjectId(id);
    return this.gitStore.worktreePath(id);
  }

  private projectJsonPath(id: string): string {
    assertValidProjectId(id);
    return join(this.projectDir(id), "project.json");
  }

  /** Media directory inside the worktree. */
  mediaDir(id: string): string {
    assertValidProjectId(id);
    return join(this.projectDir(id), "media");
  }

  async ensureProjectWorktree(id: string): Promise<void> {
    assertValidProjectId(id);
    await this.gitStore.ensureWorktree(id);
  }

  private async ensureProjectDir(id: string): Promise<void> {
    await this.ensureProjectWorktree(id);
  }

  // ── CRUD ─────────────────────────────────────────────────────────────────

  async listProjects(): Promise<ProjectSummary[]> {
    await this.gitStore.ensureSharedRepo();
    const entries = await readdir(this.gitStore["repoDir"], { withFileTypes: true });
    const dirs = entries.filter(
      (entry) => entry.isDirectory() && entry.name !== ".git",
    );
    const summaries = (
      await Promise.all(
        dirs.map(async (dir) => {
          if (!isValidProjectId(dir.name)) return null;
          try {
            await recoverInterruptedSave(this, this.gitStore, dir.name);
            const jsonPath = join(this.gitStore["repoDir"], dir.name, "project.json");
            const raw = await readFile(jsonPath, "utf-8");
            return summarizePersistedProject(JSON.parse(raw), dir.name);
          } catch (error) {
            const summaryError = new ProjectSummaryLoadError(
              dir.name,
              projectSummaryErrorKind(error),
            );
            console.error("[ProjectStore] project summary unavailable", {
              code: summaryError.code,
              projectId: summaryError.projectId,
              kind: summaryError.kind,
            });
            throw summaryError;
          }
        }),
      )
    ).filter((summary): summary is ProjectSummary => summary !== null);
    return summaries.sort((a, b) => b.modifiedAt - a.modifiedAt);
  }

  async loadProject(id: string): Promise<Project | null> {
    assertValidProjectId(id);
    await recoverInterruptedSave(this, this.gitStore, id);
    const path = this.projectJsonPath(id);
    if (!existsSync(path)) return null;
    try {
      const raw = await readFile(path, "utf-8");
      return JSON.parse(raw) as Project;
    } catch {
      return null;
    }
  }

  async saveProject(project: Project): Promise<Project> {
    assertValidProjectId(project.id);

    // Track whether we created a brand-new worktree so we can roll it back
    // if the file write fails — prevents zombie worktrees.
    let worktreeWasNew = false;
    const dir = this.projectDir(project.id);
    if (!existsSync(join(dir, ".git")) && !existsSync(join(dir, "project.json"))) {
      worktreeWasNew = true;
    }

    try {
      await this.ensureProjectDir(project.id);
      return await this.gitStore.withProjectTransaction(project.id, async (transaction) => {
        await recoverInterruptedSaveUnderLock(
          this,
          this.gitStore,
          project.id,
          transaction,
        );
        const finalPath = this.projectJsonPath(project.id);
        const previous = existsSync(finalPath)
          ? JSON.parse(await readFile(finalPath, "utf-8")) as Project
          : null;
        if (previous) assertExternallyReferencedMediaPreserved(previous, project);
        const updated: Project = { ...project, modifiedAt: Date.now() };
        const tmpPath = `${finalPath}.${createInfrastructureNonce()}.tmp`;
        await writeFile(tmpPath, JSON.stringify(updated, null, 2), "utf-8");
        await rename(tmpPath, finalPath);
        return updated;
      });
    } catch (err) {
      // Roll back the worktree if we created it and project.json was never written.
      if (worktreeWasNew && !existsSync(this.projectJsonPath(project.id))) {
        try {
          await this.gitStore.deleteWorktree(project.id);
        } catch {
          // best-effort — the worktree may have been partially created
        }
        try {
          await rm(dir, { recursive: true, force: true });
        } catch {
          // already gone
        }
      }
      throw err;
    }
  }

  async createProject(name: string, settings?: Partial<ProjectSettings>): Promise<Project> {
    const slug = await this.gitStore.reserveProjectSlug(toSlug(name));
    const project = defaultProject({ id: slug, name, settings });
    return this.saveProject(project);
  }

  async renameProject(id: string, name: string): Promise<Project | null> {
    assertValidProjectId(id);
    const project = await this.loadProject(id);
    if (!project) return null;

    return this.saveProject({ ...project, id, name, modifiedAt: Date.now() });
  }

  async deleteProject(id: string): Promise<boolean> {
    assertValidProjectId(id);
    const dir = this.projectDir(id);
    const existed = existsSync(dir);
    if (existed) {
      await this.gitStore.deleteWorktree(id);
      try {
        await rm(dir, { recursive: true, force: true });
      } catch {
        // already gone
      }
    }
    return existed;
  }

  // ── Migration ───────────────────────────────────────────────────────────

  /**
   * Delete zombie worktrees: directories that have a .git marker (meaning
   * ensureWorktree succeeded) but no project.json (meaning saveProject never
   * completed). These are unrecoverable — the project data was never persisted.
   */
  async cleanupZombieWorktrees(): Promise<void> {
    await this.gitStore.ensureSharedRepo();
    const repoDir = this.gitStore["repoDir"];
    const entries = await readdir(repoDir, { withFileTypes: true });
    let cleaned = 0;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      if (name === ".git" || name === "projects" || name.startsWith(".")) continue;
      if (!isValidProjectId(name)) continue;

      const dir = join(repoDir, name);
      const hasGit = existsSync(join(dir, ".git"));
      const hasProjectJson = existsSync(join(dir, "project.json"));

      // Zombie: worktree exists but project.json was never written.
      if (hasGit && !hasProjectJson) {
        try {
          await this.gitStore.deleteWorktree(name);
        } catch {
          // best-effort — worktree may already be partially removed
        }
        try {
          await rm(dir, { recursive: true, force: true });
        } catch {
          // already gone
        }
        cleaned++;
      }
    }
    if (cleaned > 0) {
      console.log(`[ProjectStore] cleaned up ${cleaned} zombie worktree(s)`);
    }
  }

  // ── Media files ──────────────────────────────────────────────────────────

  /** Scan the media directory and return { [mediaId]: storedFilename }. */
  async scanMedia(project: Project): Promise<Record<string, string>> {
    assertValidProjectId(project.id);
    const dir = this.mediaDir(project.id);
    if (!existsSync(dir)) return {};
    const files = new Set(await readdir(dir));
    const result: Record<string, string> = {};
    for (const item of project.mediaLibrary.items) {
      if (!isValidMediaId(item.id) || !isValidMediaFilename(item.name)) continue;
      if (files.has(item.name)) result[item.id] = item.name;
    }
    return result;
  }

  async auditSnapshot(
    project: Project,
    options: ProjectMediaAuditOptions = {},
  ): Promise<ProjectMediaManifestSnapshot> {
    assertValidProjectId(project.id);
    if (options.verifyLfs === false) {
      return auditProjectMediaManifest(project, this.mediaDir(project.id), {
        allowDanglingClips: options.allowDanglingClips,
      });
    }
    const { remote } = await this.gitStore.getConfig();
    return auditProjectMediaManifest(project, this.mediaDir(project.id), {
      lfsRepoDir: this.projectDir(project.id),
      // A newly staged object cannot be required to exist remotely before the
      // commit that makes it reachable. Push durability is verified later.
      remote: options.pointerSource === "index" ? null : remote ? "origin" : null,
      checkRemoteObject: options.checkRemoteObject,
      pointerSource: options.pointerSource,
      allowDanglingClips: options.allowDanglingClips,
    });
  }
}
