import { readFile, writeFile, readdir, mkdir, rm, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname, basename } from "node:path";
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
    const projectsParent = join(this.projectDir("_"), "..");
    await mkdir(projectsParent, { recursive: true });
    const entries = await readdir(projectsParent, { withFileTypes: true });
    const dirs = entries.filter((entry) => entry.isDirectory());
    const summaries = (
      await Promise.all(
        dirs.map(async (dir) => {
          const jsonPath = this.projectJsonPath(dir.name);
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
    const tmpPath = `${finalPath}.tmp`;
    await writeFile(tmpPath, JSON.stringify(updated, null, 2), "utf-8");
    await rename(tmpPath, finalPath);
    return updated;
  }

  async createProject(name: string, settings?: Partial<ProjectSettings>): Promise<Project> {
    const id = crypto.randomUUID();
    const project = defaultProject({ id, name, settings });
    return this.saveProject(project);
  }

  async renameProject(id: string, name: string): Promise<Project | null> {
    const project = await this.loadProject(id);
    if (!project) return null;
    const renamed: Project = { ...project, name };
    return this.saveProject(renamed);
  }

  async deleteProject(id: string): Promise<boolean> {
    const dir = this.projectDir(id);
    const existed = existsSync(dir);
    if (existed) {
      await this.gitStore.deleteWorktree(id);
      // deleteWorktree should have cleaned up, but rm as safety net
      try {
        await rm(dir, { recursive: true, force: true });
      } catch {
        // already gone
      }
    }
    return existed;
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
