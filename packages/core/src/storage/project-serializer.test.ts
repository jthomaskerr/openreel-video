import { describe, expect, it, vi } from "vitest";
import type { IStorageEngine, MediaRecord, ProjectSummary } from "./types";
import type { Project } from "../types";
import { ProjectSerializer, SCHEMA_VERSION } from "./project-serializer";

class MemoryStorage implements IStorageEngine {
  projects = new Map<string, Project>();
  media = new Map<string, MediaRecord>();

  async saveProject(project: Project): Promise<void> { this.projects.set(project.id, project); }
  async loadProject(id: string): Promise<Project | null> { return this.projects.get(id) ?? null; }
  async listProjects(): Promise<ProjectSummary[]> { return []; }
  async deleteProject(id: string): Promise<void> { this.projects.delete(id); }
  async saveMedia(record: MediaRecord): Promise<void> { this.media.set(record.id, record); }
  async loadMedia(id: string): Promise<MediaRecord | null> { return this.media.get(id) ?? null; }
  async deleteMedia(id: string): Promise<void> { this.media.delete(id); }
  async getMediaByProject(projectId: string): Promise<MediaRecord[]> { return [...this.media.values()].filter((record) => record.projectId === projectId); }
  async saveCache(): Promise<void> {}
  async loadCache(): Promise<null> { return null; }
  async deleteCache(): Promise<void> {}
  async clearCache(): Promise<void> {}
  async saveWaveform(): Promise<void> {}
  async loadWaveform(): Promise<null> { return null; }
  async deleteWaveform(): Promise<void> {}
  async saveFileHandle(): Promise<void> {}
  async loadFileHandle(): Promise<FileSystemFileHandle | null> { return null; }
  async saveDirectoryHandle(): Promise<void> {}
  async loadDirectoryHandle(): Promise<null> { return null; }
  async getStorageUsage(): Promise<{ used: number; quota: number; projects: number; mediaItems: number }> {
    return { used: 0, quota: 0, projects: this.projects.size, mediaItems: this.media.size };
  }
  async clearAllData(): Promise<void> {
    this.projects.clear();
    this.media.clear();
  }
  close(): void {}
}
function projectWithMissingClip(): Project {
  return {
    id: "project-import",
    name: "Import Missing Media",
    createdAt: 1,
    modifiedAt: 1,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items: [] },
    timeline: {
      duration: 10,
      markers: [],
      subtitles: [],
      tracks: [
        {
          id: "track-video",
          type: "video",
          name: "Video",
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
          transitions: [],
          clips: [
            {
              id: "clip-missing",
              type: "video",
              mediaId: "missing-video-id",
              trackId: "track-video",
              startTime: 0,
              duration: 5,
              inPoint: 0,
              outPoint: 5,
              effects: [],
              audioEffects: [],
              transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 },
              volume: 1,
              keyframes: [],
              metadata: {
                sourceFile: { name: "missing-scene.mp4", size: 12345, lastModified: 99 },
              },
            },
          ],
        },
      ],
    },
  };
}

describe("ProjectSerializer imported unresolved media", () => {
  it("imports clips with missing media as relinkable placeholders", () => {
    vi.setSystemTime(1000);
    const serializer = new ProjectSerializer(new MemoryStorage());
    const json = JSON.stringify({ version: SCHEMA_VERSION, project: projectWithMissingClip() });

    const validation = serializer.validateProjectJson(json);
    expect(validation.valid).toBe(true);
    expect(validation.missingAssets).toContain("missing-video-id");

    const imported = serializer.importFromJson(json);
    expect(imported.timeline.tracks[0]?.clips[0]?.mediaId).toBe("missing-video-id");
    expect(imported.mediaLibrary.items).toContainEqual(
      expect.objectContaining({
        id: "missing-video-id",
        name: "missing-scene.mp4",
        type: "video",
        isPlaceholder: true,
        sourceFile: { name: "missing-scene.mp4", size: 12345, lastModified: 99 },
      }),
    );
  });

  it("normalizes migrated imports so missing media stays relinkable", () => {
    vi.setSystemTime(1000);
    const serializer = new ProjectSerializer(new MemoryStorage());
    const json = JSON.stringify({ version: "0.9.0", project: projectWithMissingClip() });

    const imported = serializer.importFromJson(json);

    expect(imported.mediaLibrary.items).toContainEqual(
      expect.objectContaining({
        id: "missing-video-id",
        isPlaceholder: true,
      }),
    );
  });

  it("throws a clear error when import JSON is missing the project field", () => {
    const serializer = new ProjectSerializer(new MemoryStorage());

    expect(() => serializer.importFromJson(JSON.stringify({ version: SCHEMA_VERSION }))).toThrow(
      "Invalid project file: missing project field",
    );
    expect(() => serializer.importFromJson(JSON.stringify({ version: "0.0.1" }))).toThrow(
      "Invalid project file: missing project field",
    );
  });
});
