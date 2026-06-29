import { readFile, writeFile, readdir, unlink, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname } from "node:path";
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

  private projectPath(id: string): string {
    return join(this.projectsDir, `${id}.json`);
  }

  async ensureDir(): Promise<void> {
    if (!existsSync(this.projectsDir)) {
      await mkdir(this.projectsDir, { recursive: true });
    }
  }

  async listProjects(): Promise<ProjectSummary[]> {
    await this.ensureDir();
    const entries = await readdir(this.projectsDir);
    const jsonFiles = entries.filter((e) => extname(e) === ".json");

    const summaries: ProjectSummary[] = [];
    for (const file of jsonFiles) {
      try {
        const raw = await readFile(join(this.projectsDir, file), "utf-8");
        const project: Project = JSON.parse(raw);
        summaries.push({
          id: project.id,
          name: project.name,
          createdAt: project.createdAt,
          modifiedAt: project.modifiedAt,
        });
      } catch {
        // Skip corrupt files
      }
    }
    summaries.sort((a, b) => b.modifiedAt - a.modifiedAt);
    return summaries;
  }

  async loadProject(id: string): Promise<Project | null> {
    const path = this.projectPath(id);
    if (!existsSync(path)) return null;
    try {
      const raw = await readFile(path, "utf-8");
      return JSON.parse(raw) as Project;
    } catch {
      return null;
    }
  }

  async saveProject(project: Project): Promise<void> {
    await this.ensureDir();
    const updated: Project = { ...project, modifiedAt: Date.now() };
    await writeFile(this.projectPath(project.id), JSON.stringify(updated, null, 2), "utf-8");
  }

  async createProject(name: string, settings?: Partial<ProjectSettings>): Promise<Project> {
    await this.ensureDir();
    const id = crypto.randomUUID();
    const project = defaultProject({ id, name, settings });
    await this.saveProject(project);
    return project;
  }

  async renameProject(id: string, name: string): Promise<Project | null> {
    const project = await this.loadProject(id);
    if (!project) return null;
    const renamed: Project = { ...project, name, modifiedAt: Date.now() };
    await this.saveProject(renamed);
    return renamed;
  }

  async deleteProject(id: string): Promise<boolean> {
    const path = this.projectPath(id);
    if (!existsSync(path)) return false;
    await unlink(path);
    return true;
  }
}
