import { readFile, writeFile, readdir, rm, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import crypto from "node:crypto";
import type { Project, ProjectSettings } from "@openreel/core";
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
  readonly createdAt: number;
  readonly modifiedAt: number;
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

function uuidPattern(): RegExp {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
          await recoverInterruptedSave(this, this.gitStore, dir.name);
          const jsonPath = join(this.gitStore["repoDir"], dir.name, "project.json");
          try {
            const raw = await readFile(jsonPath, "utf-8");
            const project = JSON.parse(raw) as Project;
            if (!isValidProjectId(project.id)) return null;
            return {
              id: project.id,
              name: project.name,
              createdAt: project.createdAt,
              modifiedAt: project.modifiedAt,
            } as ProjectSummary;
          } catch {
            return null;
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
        const tmpPath = `${finalPath}.${crypto.randomUUID()}.tmp`;
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

  /**
   * One-time migration: rename any UUID-named project dirs to slug names.
   * Safe to call on every startup — skips already-migrated dirs.
   * Also cleans up zombie worktrees (directories with a worktree but no
   * project.json) left behind by a failed saveProject.
   */
  async migrateUuidDirs(): Promise<void> {
    // Clean zombies first so they don't interfere with migration scanning.
    await this.cleanupZombieWorktrees();

    await this.gitStore.ensureSharedRepo();
    const repoDir = this.gitStore["repoDir"];
    const isUuid = uuidPattern();

    const migrateCandidate = async (parentDir: string, oldName: string): Promise<void> => {
      if (!isUuid.test(oldName)) return;

      const oldDir = join(parentDir, oldName);
      const jsonPath = join(oldDir, "project.json");
      let raw: string;
      try {
        raw = await readFile(jsonPath, "utf-8");
      } catch {
        return;
      }

      let project: Project;
      try {
        project = JSON.parse(raw) as Project;
      } catch {
        return;
      }

      const newSlug = toSlug(project.name);
      if (!isValidProjectId(newSlug)) return;
      const newDir = join(repoDir, newSlug);
      if (existsSync(newDir)) return; // already migrated (or slug clash)

      // Update project id to the slug and promote nested legacy dirs into the
      // root worktree layout used by the current backend.
      project = { ...project, id: newSlug, modifiedAt: Date.now() };
      await rename(oldDir, newDir);

      // Rename the git branch.
      try {
        await this.gitStore["git"](["branch", "-m", `project/${oldName}`, `project/${newSlug}`], newDir);
      } catch {
        // branch rename is best-effort; old name may not exist
      }

      // Write updated project.json with new id, then promote the migrated
      // directory into a real project worktree before any later save/media
      // commit tries to operate on it.
      await writeFile(join(newDir, "project.json"), JSON.stringify(project, null, 2), "utf-8");
      await this.gitStore.ensureWorktree(newSlug);
      await this.gitStore.commit(newSlug, "chore: migrate legacy project worktree", {
        allowlist: ["project.json"],
        expectedEntries: [{ status: "A", path: "project.json" }],
      });
    };

    const entries = await readdir(repoDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      await migrateCandidate(repoDir, entry.name);
    }

    const nestedProjectsDir = join(repoDir, "projects");
    if (!existsSync(nestedProjectsDir)) return;
    const nestedEntries = await readdir(nestedProjectsDir, { withFileTypes: true });
    for (const entry of nestedEntries) {
      if (!entry.isDirectory()) continue;
      await migrateCandidate(nestedProjectsDir, entry.name);
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
