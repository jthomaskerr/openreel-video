// apps/web/src/services/backend-save.ts
import type { Project, MediaItem, ProjectSettings } from "@openreel/core";
import {
  generateThumbnailFromBlob,
  generateThumbnailFromUrl,
  shouldRegenerateThumbnail,
} from "../utils/media-recovery";
import { reportRuntimeError } from "../stores/notification-store";
import { isMediaBlob } from "../utils/media-blob";

interface ProjectSummary {
  id: string;
  name: string;
  createdAt: number;
  modifiedAt: number;
}

const BASE_URL: string =
  (import.meta.env["VITE_ORCHESTRATOR_URL"] as string | undefined) ?? "http://localhost:4041";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isClientOnlyProjectId(projectId: string): boolean {
  return UUID_RE.test(projectId);
}

/** Strip non-serialisable / engine-only fields before sending to backend. */
function sanitize(project: Project): object {
  return {
    ...project,
    mediaLibrary: {
      ...project.mediaLibrary,
      items: project.mediaLibrary.items.map((item: MediaItem) => ({
        ...item,
        blob: undefined,
        fileHandle: undefined,
        remoteUrl: undefined,
        thumbnailUrl: item.thumbnailUrl?.startsWith("blob:") ? null : item.thumbnailUrl,
        filmstripThumbnails: item.filmstripThumbnails?.every((thumbnail) =>
          !thumbnail.url.startsWith("blob:"),
        )
          ? item.filmstripThumbnails
          : undefined,
      })),
    },
    textClips: undefined,
    shapeClips: undefined,
    svgClips: undefined,
    stickerClips: undefined,
  };
}

function getExt(blob: Blob, filename: string): string {
  const fromName = filename.match(/\.[^.]+$/)?.[0];
  if (fromName) return fromName;
  const mimeToExt: Record<string, string> = {
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/wave": ".wav",
    "audio/x-wav": ".wav",
    "audio/aac": ".aac",
    "audio/ogg": ".ogg",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
  };
  return mimeToExt[blob.type] ?? ".bin";
}

export interface BackendProjectResponse {
  project: Project;
  /** Map of mediaId → stored filename (e.g. "abc123.mp4") */
  mediaFiles: Record<string, string>;
}

class BackendSaveService {
  /** Media uploads successfully completed this session. Cleared on project switch. */
  private uploadedIds = new Set<string>();
  /** In-flight media uploads keyed by project/media id so saves can await them. */
  private uploadPromises = new Map<string, Promise<void>>();
  private scheduledProject: Project | null = null;
  private scheduledSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private saveChain: Promise<void> = Promise.resolve();

  resetForProject(): void {
    this.uploadedIds.clear();
    this.uploadPromises.clear();
    this.scheduledProject = null;
    if (this.scheduledSaveTimer) {
      clearTimeout(this.scheduledSaveTimer);
      this.scheduledSaveTimer = null;
    }
  }

  /**
   * Debounce backend persistence independently of IndexedDB autosave. The
   * latest project snapshot wins, PUTs are serialized, and a failed PUT is
   * retried even if the user makes no further edit.
   */
  scheduleSave(project: Project, delayMs: number = 2_000): void {
    this.scheduledProject = project;
    if (this.scheduledSaveTimer) clearTimeout(this.scheduledSaveTimer);
    this.scheduledSaveTimer = setTimeout(() => {
      this.scheduledSaveTimer = null;
      const pending = this.scheduledProject;
      this.scheduledProject = null;
      if (!pending) return;

      const run = this.saveChain
        .catch(() => undefined)
        .then(() => this.save(pending));
      this.saveChain = run;
      void run.catch((error) => {
        console.error("[BackendSave] scheduled save failed; retrying:", error);
        reportRuntimeError("Backend auto-save failed", error, "backend-save.scheduled-save");
        if (!this.scheduledProject) this.scheduledProject = pending;
        if (!this.scheduledSaveTimer) {
          this.scheduledSaveTimer = setTimeout(() => {
            this.scheduledSaveTimer = null;
            const retry = this.scheduledProject;
            if (retry) this.scheduleSave(retry, 0);
          }, 5_000);
        }
      });
    }, delayMs);
  }

  private getUploadKey(projectId: string, mediaId: string): string {
    return `${projectId}:${mediaId}`;
  }

  private async uploadMedia(
    projectId: string,
    mediaId: string,
    blob: Blob,
    filename: string,
  ): Promise<void> {
    if (isClientOnlyProjectId(projectId)) return;

    const key = this.getUploadKey(projectId, mediaId);
    if (this.uploadedIds.has(key)) return;

    const existing = this.uploadPromises.get(key);
    if (existing) return existing;

    const promise = (async () => {
      const ext = getExt(blob, filename);
      const form = new FormData();
      form.append("file", blob, `${mediaId}${ext}`);

      const res = await fetch(`${BASE_URL}/api/projects/${projectId}/media/${mediaId}`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.uploadedIds.add(key);
    })();

    this.uploadPromises.set(key, promise);
    try {
      await promise;
    } finally {
      this.uploadPromises.delete(key);
    }
  }

  /** Returns true if the orchestrator is reachable. */
  async isReachable(): Promise<boolean> {
    try {
      const res = await fetch(`${BASE_URL}/api/health`, { method: "HEAD" });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * POST to backend to create a new project. The orchestrator assigns the
   * canonical id (a slug derived from `name`), not a client-generated UUID.
   * Throws on failure — callers should fall back to local-only creation
   * (e.g. when the orchestrator is unreachable).
   */
  async create(name: string, settings?: Partial<ProjectSettings>): Promise<Project> {
    const res = await fetch(`${BASE_URL}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, settings }),
    });
    if (!res.ok) {
      let detail = "";
      try {
        const body = await res.json() as { error?: string; detail?: string };
        detail = body.detail ?? body.error ?? "";
      } catch {
        // ignore parse errors
      }
      throw new Error(`Backend create failed: HTTP ${res.status}${detail ? ` — ${detail}` : ""}`);
    }
    return (await res.json()) as Project;
  }

  /**
   * PUT sanitised project JSON to backend. Blobs, fileHandles, and
   * engine-only fields are stripped before sending.
   */
  async save(project: Project): Promise<void> {
    if (isClientOnlyProjectId(project.id)) {
      // Local/offline projects are born with UUIDs. Do not ever send those to
      // the backend git store; wait until create/import returns the slug id.
      return;
    }

    await Promise.all(
      project.mediaLibrary.items.map((item) => {
        if (!isMediaBlob(item.blob)) return Promise.resolve();
        return this.uploadMedia(project.id, item.id, item.blob, item.name);
      }),
    );

    const res = await fetch(`${BASE_URL}/api/projects/${project.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sanitize(project)),
    });
    if (!res.ok) {
      let detail = "";
      try {
        const body = await res.json() as { error?: string; detail?: string };
        detail = body.detail ?? body.error ?? "";
      } catch {
        // ignore parse errors
      }
      throw new Error(`Backend save failed: HTTP ${res.status}${detail ? ` — ${detail}` : ""}`);
    }
  }

  /**
   * Upload a single media blob for a specific version. Idempotent —
   * already-uploaded mediaIds are skipped. Fire-and-forget.
   */
  uploadMediaAsync(projectId: string, mediaId: string, blob: Blob, filename: string): void {
    this.uploadMedia(projectId, mediaId, blob, filename).catch((err) => {
      console.error(`[BackendSave] media upload failed (${mediaId}):`, err);
      reportRuntimeError("Backend media upload failed", err, "backend-save.media-upload");
    });
  }

  /**
   * List all projects from the backend orchestrator.
   * Returns empty array if unreachable or the backend has no projects.
   */
  async listProjects(): Promise<ProjectSummary[] | null> {
    try {
      const res = await fetch(`${BASE_URL}/api/projects`);
      if (!res.ok) return null;
      return (await res.json()) as ProjectSummary[];
    } catch {
      return null;
    }
  }

  /** Delete a project from the backend orchestrator. */
  async deleteProject(projectId: string): Promise<boolean> {
    try {
      const res = await fetch(`${BASE_URL}/api/projects/${projectId}`, {
        method: "DELETE",
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Load project from backend. Returns null if unreachable or not found.
   * Populates remoteUrl on each media item that has a stored file.
   */
  async load(projectId: string): Promise<Project | null> {
    try {
      const res = await fetch(`${BASE_URL}/api/projects/${projectId}`);
      if (!res.ok) return null;
      const { project, mediaFiles } = (await res.json()) as BackendProjectResponse;

      const items = await Promise.all(
        project.mediaLibrary.items.map(async (item) => {
          const filename = mediaFiles[item.id];
          if (!filename) {
            return item.thumbnailUrl?.startsWith("blob:")
              ? { ...item, thumbnailUrl: null, filmstripThumbnails: undefined }
              : item;
          }

          const remoteUrl = `${BASE_URL}/api/projects/${projectId}/media/${filename}`;
          let blob: Blob | null = null;

          try {
            const mediaRes = await fetch(remoteUrl);
            if (!mediaRes.ok) throw new Error(`HTTP ${mediaRes.status}`);
            blob = await mediaRes.blob();
          } catch (err) {
            console.error(`[BackendSave] media download failed (${item.id}):`, err);
          }

          const itemWithMedia = { ...item, remoteUrl, blob };

          if (!shouldRegenerateThumbnail(itemWithMedia)) {
            return itemWithMedia;
          }

          try {
            const thumbnailUrl = blob
              ? await generateThumbnailFromBlob(blob, item.type)
              : await generateThumbnailFromUrl(remoteUrl, item.type);
            if (thumbnailUrl) {
              return { ...itemWithMedia, thumbnailUrl };
            }
          } catch (err) {
            console.warn(`[BackendSave] thumbnail regeneration failed (${item.id}):`, err);
          }

          return itemWithMedia;
        }),
      );

      return { ...project, mediaLibrary: { ...project.mediaLibrary, items } };
    } catch {
      return null;
    }
  }
}

export const backendSaveService = new BackendSaveService();
