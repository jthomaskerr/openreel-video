import type { Clip, MediaItem, Project, Track } from "../types";
import type { IStorageEngine, MediaRecord } from "./types";
import type { ValidationResult, ProjectFileWithMetadata } from "./schema-types";

export interface ProjectFile {
  readonly version: string;
  readonly project: Project;
}

export const SCHEMA_VERSION = "1.0.0";

export class ProjectSerializer {
  private storage: IStorageEngine;

  constructor(storage: IStorageEngine) {
    this.storage = storage;
  }

  async saveProject(project: Project): Promise<void> {
    await this.saveMediaBlobs(project);

    const projectToSave: Project = {
      ...project,
      modifiedAt: Date.now(),
    };

    await this.storage.saveProject(projectToSave);
  }

  async loadProject(id: string): Promise<Project | null> {
    const project = await this.storage.loadProject(id);
    if (!project) {
      return null;
    }

    const restoredProject = await this.restoreMediaBlobs(project);
    return restoredProject;
  }

  exportToJson(project: Project): string {
    const projectFile: ProjectFile = {
      version: SCHEMA_VERSION,
      project: this.stripMediaBlobs(project),
    };
    return JSON.stringify(projectFile, null, 2);
  }

  importFromJson(json: string): Project {
    const projectFile = JSON.parse(json) as ProjectFile;
    if (!projectFile.project) {
      throw new Error("Invalid project file: missing project field");
    }

    if (projectFile.version !== SCHEMA_VERSION) {
      return this.normalizeImportedProject(this.migrateProject(projectFile));
    }

    return this.normalizeImportedProject(projectFile.project);
  }

  exportToJsonWithMetadata(project: Project, description?: string): string {
    const projectFile: ProjectFileWithMetadata = {
      version: SCHEMA_VERSION,
      project: this.stripMediaBlobs(project),
      metadata: {
        exportedAt: Date.now(),
        description,
      },
    };
    return JSON.stringify(projectFile, null, 2);
  }

  validateProjectJson(json: string): ValidationResult {
    const result: ValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
      missingAssets: [],
    };

    try {
      const projectFile = JSON.parse(json) as ProjectFile;

      if (!projectFile.version) {
        result.errors.push("Missing version field");
        result.valid = false;
      } else if (projectFile.version !== SCHEMA_VERSION) {
        result.warnings.push(
          `Version mismatch: expected ${SCHEMA_VERSION}, got ${projectFile.version}`,
        );
      }

      if (!projectFile.project) {
        result.errors.push("Missing project field");
        result.valid = false;
        return result;
      }

      const project = this.normalizeImportedProject(projectFile.project);

      if (!project.id) {
        result.errors.push("Missing project.id");
        result.valid = false;
      }
      if (!project.name) {
        result.errors.push("Missing project.name");
        result.valid = false;
      }
      if (!project.settings) {
        result.errors.push("Missing project.settings");
        result.valid = false;
      }
      if (!project.timeline) {
        result.errors.push("Missing project.timeline");
        result.valid = false;
      }
      if (!project.mediaLibrary) {
        result.errors.push("Missing project.mediaLibrary");
        result.valid = false;
      }
      if (!result.valid) {
        return result;
      }

      const mediaIds = new Set(
        project.mediaLibrary.items.map((item: MediaItem) => item.id),
      );

      for (const item of project.mediaLibrary.items) {
        if (!item.blob && !item.thumbnailUrl) {
          result.missingAssets!.push(item.id);
        }
      }

      if (project.timeline.tracks) {
        for (const track of project.timeline.tracks) {
          if (track.clips) {
            for (const clip of track.clips) {
              if (
                clip.mediaId &&
                !this.isVirtualMediaId(clip.mediaId) &&
                !mediaIds.has(clip.mediaId)
              ) {
                result.errors.push(
                  `Clip ${clip.id} references non-existent mediaId: ${clip.mediaId}`,
                );
                result.valid = false;
              }
            }
          }
        }
      }

      if (result.missingAssets && result.missingAssets.length > 0) {
        result.warnings.push(
          `${result.missingAssets.length} asset(s) need replacement`,
        );
      }
    } catch (error) {
      result.errors.push(
        `Invalid JSON: ${error instanceof Error ? error.message : "Parse error"}`,
      );
      result.valid = false;
    }

    return result;
  }

  importFromJsonWithValidation(json: string): {
    project: Project | null;
    validation: ValidationResult;
  } {
    const validation = this.validateProjectJson(json);

    if (!validation.valid) {
      return { project: null, validation };
    }

    const project = this.importFromJson(json);
    return { project, validation };
  }

  private normalizeImportedProject(project: Project): Project {
    const generatedImageDefinitions = this.normalizeGeneratedImageDefinitions(project);
    const itemsById = new Map(project.mediaLibrary.items.map((item) => [item.id, item]));
    const processedItems: MediaItem[] = project.mediaLibrary.items.map((item) => {
      if (!item.blob && !item.generationMeta) {
        return {
          ...item,
          originalUrl: item.thumbnailUrl || undefined,
        };
      }
      return item;
    });

    const processedTracks = project.timeline.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) => ({
        ...clip,
        type: clip.type ?? this.inferClipType(track, itemsById.get(clip.mediaId)),
      })),
    }));


    for (const track of processedTracks) {
      for (const clip of track.clips) {
        if (!clip.mediaId || this.isVirtualMediaId(clip.mediaId) || itemsById.has(clip.mediaId)) {
          continue;
        }
        const placeholder = this.createMissingMediaPlaceholder(clip, track);
        processedItems.push(placeholder);
        itemsById.set(placeholder.id, placeholder);
      }
    }

    return {
      ...project,
      generatedImageDefinitions,
      timeline: {
        ...project.timeline,
        tracks: processedTracks,
      },
      mediaLibrary: {
        ...project.mediaLibrary,
        items: processedItems,
      },
    };
  }

  private normalizeGeneratedImageDefinitions(
    project: Project,
  ): Project["generatedImageDefinitions"] {
    const definitions = project.generatedImageDefinitions ?? [];
    const mediaById = new Map(project.mediaLibrary.items.map((item) => [item.id, item]));

    for (const definition of definitions) {
      if (definition.projectId !== project.id) {
        throw new Error(
          `Invalid generated image definition ${definition.id}: projectId does not match project`,
        );
      }

      const groupItems = project.mediaLibrary.items.filter(
        (item) => (item.assetGroupId ?? item.id) === definition.assetGroupId,
      );
      if (groupItems.length === 0) {
        throw new Error(
          `Invalid generated image definition ${definition.id}: asset group has no media versions`,
        );
      }

      const currentItems = groupItems.filter((item) => item.isCurrent === true);
      if (currentItems.length !== 1) {
        throw new Error(
          `Invalid generated image definition ${definition.id}: asset group must have exactly one current version`,
        );
      }

      const assertVersionInGroup = (
        field: "currentMediaVersionId" | "sourceMediaVersionId",
        mediaVersionId: string | undefined,
      ) => {
        if (!mediaVersionId) return;
        const media = mediaById.get(mediaVersionId);
        if (!media || (media.assetGroupId ?? media.id) !== definition.assetGroupId) {
          throw new Error(
            `Invalid generated image definition ${definition.id}: ${field} is outside the asset group`,
          );
        }
      };

      assertVersionInGroup("currentMediaVersionId", definition.currentMediaVersionId);
      assertVersionInGroup("sourceMediaVersionId", definition.sourceMediaVersionId);

      if (
        definition.currentMediaVersionId &&
        definition.currentMediaVersionId !== currentItems[0].id
      ) {
        throw new Error(
          `Invalid generated image definition ${definition.id}: currentMediaVersionId is not current`,
        );
      }
    }

    return definitions;
  }

  private createMissingMediaPlaceholder(clip: Clip, track: Track): MediaItem {
    const sourceFile = this.extractSourceFile(clip);
    const label = this.extractString(clip.metadata, ["label", "title", "name"]);
    const mediaType = this.trackTypeToMediaType(track.type);
    const name =
      sourceFile?.name ??
      label ??
      `${track.name || track.type} ${clip.mediaId}`;

    return {
      id: clip.mediaId,
      name,
      type: mediaType,
      fileHandle: null,
      blob: null,
      metadata: {
        duration: clip.duration || 0,
        width: 0,
        height: 0,
        frameRate: 0,
        codec: "",
        sampleRate: 0,
        channels: 0,
        fileSize: sourceFile?.size ?? 0,
      },
      thumbnailUrl: null,
      sourceFile,
    };
  }

  private extractSourceFile(clip: Clip): MediaItem["sourceFile"] | undefined {
    const raw = clip.metadata?.["sourceFile"];
    if (raw && typeof raw === "object") {
      const record = raw as Record<string, unknown>;
      if (typeof record["name"] === "string" && record["name"].trim()) {
        return {
          name: record["name"],
          size: typeof record["size"] === "number" ? record["size"] : 0,
          lastModified: typeof record["lastModified"] === "number" ? record["lastModified"] : 0,
          folder: typeof record["folder"] === "string" ? record["folder"] : undefined,
        };
      }
    }

    const name = this.extractString(clip.metadata, [
      "sourceFileName",
      "sourceFilename",
      "fileName",
      "filename",
      "path",
      "localPath",
    ]);
    if (!name) return undefined;

    return {
      name: name.split(/[\\/]/).pop() ?? name,
      size: this.extractNumber(clip.metadata, ["fileSize", "sourceFileSize", "size"]) ?? 0,
      lastModified: this.extractNumber(clip.metadata, ["lastModified", "sourceLastModified"]) ?? 0,
    };
  }

  private extractString(source: Record<string, unknown> | undefined, keys: string[]): string | undefined {
    if (!source) return undefined;
    for (const key of keys) {
      const value = source[key];
      if (typeof value === "string" && value.trim()) return value;
    }
    return undefined;
  }

  private extractNumber(source: Record<string, unknown> | undefined, keys: string[]): number | undefined {
    if (!source) return undefined;
    for (const key of keys) {
      const value = source[key];
      if (typeof value === "number" && Number.isFinite(value)) return value;
    }
    return undefined;
  }

  private inferClipType(track: Track, mediaItem: MediaItem | undefined): Clip["type"] {
    if (mediaItem?.type === "audio" || track.type === "audio") return "audio";
    if (mediaItem?.type === "image" || track.type === "image") return "image";
    if (track.type === "metadata") return "metadata";
    if (track.type === "text") return "text";
    if (track.type === "graphics") return "shape";
    return "video";
  }

  private trackTypeToMediaType(trackType: Track["type"]): MediaItem["type"] {
    if (trackType === "audio") return "audio";
    if (trackType === "video") return "video";
    return "image";
  }

  private isVirtualMediaId(mediaId: string): boolean {
    return (
      mediaId.startsWith("text-") ||
      mediaId.startsWith("shape-") ||
      mediaId.startsWith("svg-") ||
      mediaId.startsWith("sticker-") ||
      mediaId.startsWith("emoji-")
    );
  }

  private async saveMediaBlobs(project: Project): Promise<void> {
    for (const item of project.mediaLibrary.items) {
      if (item.blob) {
        const mediaRecord: MediaRecord = {
          id: item.id,
          projectId: project.id,
          blob: item.blob,
          metadata: item.metadata,
        };
        await this.storage.saveMedia(mediaRecord);
      }
    }
  }

  private async restoreMediaBlobs(project: Project): Promise<Project> {
    const restoredItems: MediaItem[] = [];

    for (const item of project.mediaLibrary.items) {
      const mediaRecord = await this.storage.loadMedia(item.id);

      if (mediaRecord) {
        restoredItems.push({
          ...item,
          blob: mediaRecord.blob,
          metadata: mediaRecord.metadata,
        });
      } else {
        restoredItems.push(item);
      }
    }

    return {
      ...project,
      mediaLibrary: {
        items: restoredItems,
      },
    };
  }

  private stripMediaBlobs(project: Project): Project {
    const strippedItems: MediaItem[] = project.mediaLibrary.items.map(
      (item) => ({
        ...item,
        blob: null,
        fileHandle: null
      }),
    );

    return {
      ...project,
      mediaLibrary: {
        items: strippedItems,
      },
    };
  }

  private migrateProject(projectFile: ProjectFile): Project {
    if (!projectFile.project) {
      throw new Error("Invalid project file: missing project field");
    }
    return projectFile.project;
  }

  async deleteProject(id: string): Promise<void> {
    await this.storage.deleteProject(id);
  }

  async listProjects() {
    return this.storage.listProjects();
  }
}

export function createProjectSerializer(
  storage: IStorageEngine,
): ProjectSerializer {
  return new ProjectSerializer(storage);
}
