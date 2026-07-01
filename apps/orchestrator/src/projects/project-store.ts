import { readFile, writeFile, readdir, mkdir, rm, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Project, ProjectSettings } from "@openreel/core";

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
  constructor(private readonly projectsDir: string) {}

  private projectDir(id: string): string {
    return join(this.projectsDir, id);
  }

  private projectJsonPath(id: string): string {
    return join(this.projectDir(id), "project.json");
  }

  private async ensureProjectDir(id: string): Promise<void> {
    await mkdir(this.projectDir(id), { recursive: true });
  }

  async listProjects(): Promise<ProjectSummary[]> {
    await mkdir(this.projectsDir, { recursive: true });
    const entries = await readdir(this.projectsDir, { withFileTypes: true });
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
    if (!existsSync(dir)) return false;
    await rm(dir, { recursive: true, force: true });
    return true;
  }
}
