import { readFile, writeFile, readdir, rm, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname, basename } from "node:path";
import crypto from "node:crypto";
import type { Project, ProjectSettings } from "@openreel/core";
import type { GitStore } from "./git-store";

export interface ProjectSummary {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  readonly modifiedAt: number;
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
    return this.gitStore.worktreePath(id);
  }

  private projectJsonPath(id: string): string {
    return join(this.projectDir(id), "project.json");
  }

  /** Media directory inside the worktree. */
  mediaDir(id: string): string {
    return join(this.projectDir(id), "media");
  }

  private async ensureProjectDir(id: string): Promise<void> {
    await this.gitStore.ensureWorktree(id);
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
          const jsonPath = join(this.gitStore["repoDir"], dir.name, "project.json");
          try {
            const raw = await readFile(jsonPath, "utf-8");
            const project = JSON.parse(raw) as Project;
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
    await this.ensureProjectDir(project.id);
    const updated: Project = { ...project, modifiedAt: Date.now() };
    const finalPath = this.projectJsonPath(project.id);
    const tmpPath = `${finalPath}.${crypto.randomUUID()}.tmp`;
    await writeFile(tmpPath, JSON.stringify(updated, null, 2), "utf-8");
    await rename(tmpPath, finalPath);
    return updated;
  }

  async createProject(name: string, settings?: Partial<ProjectSettings>): Promise<Project> {
    const slug = toSlug(name);
    const project = defaultProject({ id: slug, name, settings });
    return this.saveProject(project);
  }

  async renameProject(id: string, name: string): Promise<Project | null> {
    const project = await this.loadProject(id);
    if (!project) return null;

    const newSlug = toSlug(name);
    const renamed: Project = { ...project, name, id: newSlug, modifiedAt: Date.now() };

    // Move worktree if slug changed
    if (newSlug !== id) {
      const oldDir = this.projectDir(id);
      const oldExists = existsSync(oldDir);

      // First save under new slug (creates the new worktree)
      await this.saveProject(renamed);

      if (oldExists) {
        await this.gitStore.deleteWorktree(id);
        try { await rm(oldDir, { recursive: true, force: true }); } catch { /* gone */ }
      }

      return renamed;
    }

    return this.saveProject(renamed);
  }

  async deleteProject(id: string): Promise<boolean> {
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
   * One-time migration: rename any UUID-named project dirs to slug names.
   * Safe to call on every startup — skips already-migrated dirs.
   */
  async migrateUuidDirs(): Promise<void> {
    await this.gitStore.ensureSharedRepo();
    const entries = await readdir(this.gitStore["repoDir"], { withFileTypes: true });
    const isUuid = uuidPattern();
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const oldName = entry.name;
      if (!isUuid.test(oldName)) continue;

      const jsonPath = join(this.gitStore["repoDir"], oldName, "project.json");
      let raw: string;
      try {
        raw = await readFile(jsonPath, "utf-8");
      } catch {
        continue;
      }

      let project: Project;
      try {
        project = JSON.parse(raw) as Project;
      } catch {
        continue;
      }

      const newSlug = toSlug(project.name);
      const newDir = join(this.gitStore["repoDir"], newSlug);
      if (existsSync(newDir)) continue; // already migrated (or slug clash)

      // Update project id to the slug
      project = { ...project, id: newSlug, modifiedAt: Date.now() };

      // Rename directory
      await rename(join(this.gitStore["repoDir"], oldName), newDir);

      // Rename the git branch
      try {
        await this.gitStore["git"](["branch", "-m", `project/${oldName}`, `project/${newSlug}`], newDir);
      } catch {
        // branch rename is best-effort; old name may not exist
      }

      // Write updated project.json with new id
      await writeFile(jsonPath, JSON.stringify(project, null, 2), "utf-8");
    }
  }

  // ── Media files ──────────────────────────────────────────────────────────

  /** Scan the media directory and return { [mediaId]: storedFilename }. */
  async scanMedia(projectId: string): Promise<Record<string, string>> {
    const dir = this.mediaDir(projectId);
    if (!existsSync(dir)) return {};
    const files = await readdir(dir);
    const result: Record<string, string> = {};
    for (const file of files) {
      const mediaId = basename(file, extname(file));
      result[mediaId] = file;
    }
    return result;
  }
}
