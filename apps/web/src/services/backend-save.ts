// apps/web/src/services/backend-save.ts
import type { Project, MediaItem, ProjectSettings } from "@openreel/core";
import {
  generateThumbnailFromBlob,
  generateThumbnailFromUrl,
  shouldRegenerateThumbnail,
} from "../utils/media-recovery";
import { reportRuntimeError } from "../stores/notification-store";
import { isMediaBlob } from "../utils/media-blob";
import { usePersistenceStatusStore } from "../stores/persistence-status-store";

interface ProjectSummary {
  id: string;
  name: string;
  createdAt: number;
  modifiedAt: number;
}

const BASE_URL: string =
  (import.meta.env["VITE_ORCHESTRATOR_URL"] as string | undefined) ?? "http://localhost:4041";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isClientOnlyProjectId(projectId: string): boolean {
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

interface PersistenceReceipt {
  saved: true;
  projectId: string;
  persistedAt: number;
  sourceModifiedAt: number;
}

class BackendSaveService {
  /** Media uploads successfully completed this session. Cleared on project switch. */
  private uploadedIds = new Set<string>();
  /** In-flight media uploads keyed by project/media id so saves can await them. */
  private uploadPromises = new Map<string, Promise<void>>();
  private scheduledProject: Project | null = null;
  private scheduledSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private queueDeadlineTimer: ReturnType<typeof setTimeout> | null = null;
  private scheduledSaveStartedAt: number | null = null;
  private saveChain: Promise<void> = Promise.resolve();
  private readonly maxScheduleWaitMs = 5_000;
  private readonly queueDeadlineMs = 7_000;
  private readonly requestDeadlineMs = 20_000;

  resetForProject(): void {
    this.uploadedIds.clear();
    this.uploadPromises.clear();
    this.scheduledProject = null;
    this.scheduledSaveStartedAt = null;
    if (this.scheduledSaveTimer) {
      clearTimeout(this.scheduledSaveTimer);
      this.scheduledSaveTimer = null;
    }
    if (this.queueDeadlineTimer) {
      clearTimeout(this.queueDeadlineTimer);
      this.queueDeadlineTimer = null;
    }
    usePersistenceStatusStore.getState().reset();
  }

  /**
   * Debounce backend persistence independently of IndexedDB autosave. The
   * latest project snapshot wins, PUTs are serialized, and a failed PUT is
   * retried even if the user makes no further edit.
   */
  scheduleSave(project: Project, delayMs: number = 2_000): void {
    console.debug("[Persistence] queued", { projectId: project.id, delayMs, modifiedAt: project.modifiedAt });
    usePersistenceStatusStore.getState().markPending(project.id);
    this.scheduledProject = project;
    const now = Date.now();
    this.scheduledSaveStartedAt ??= now;
    if (!this.queueDeadlineTimer) {
      const queuedProjectId = project.id;
      this.queueDeadlineTimer = setTimeout(() => {
        this.queueDeadlineTimer = null;
        if (!this.scheduledProject || this.scheduledProject.id !== queuedProjectId) return;
        const error = new Error(
          `Persistence queue timed out after ${this.queueDeadlineMs}ms for project ${queuedProjectId}; no backend PUT began`,
        );
        usePersistenceStatusStore.getState().markFailed(queuedProjectId, error.message);
        console.error("[Persistence] queue deadline exceeded", {
          projectId: queuedProjectId,
          deadlineMs: this.queueDeadlineMs,
        });
        reportRuntimeError("Backend persistence queue timed out", error, "backend-save.queue-timeout");
      }, this.queueDeadlineMs);
    }
    if (this.scheduledSaveTimer) clearTimeout(this.scheduledSaveTimer);
    const queueAge = now - this.scheduledSaveStartedAt;
    const effectiveDelay = Math.max(
      0,
      Math.min(delayMs, this.maxScheduleWaitMs - queueAge),
    );
    this.scheduledSaveTimer = setTimeout(() => {
      this.scheduledSaveTimer = null;
      this.scheduledSaveStartedAt = null;
      if (this.queueDeadlineTimer) {
        clearTimeout(this.queueDeadlineTimer);
        this.queueDeadlineTimer = null;
      }
      const pending = this.scheduledProject;
      this.scheduledProject = null;
      if (!pending) return;

      const run = this.saveChain
        .catch((previousError) => {
          console.debug("[Persistence] continuing after reported save failure", previousError);
        })
        .then(() => this.save(pending));
      this.saveChain = run;
      void run.catch((error) => {
        console.error("[BackendSave] scheduled save failed; retrying:", error);
        if (!this.scheduledProject) this.scheduledProject = pending;
        if (!this.scheduledSaveTimer) {
          this.scheduledSaveTimer = setTimeout(() => {
            this.scheduledSaveTimer = null;
            const retry = this.scheduledProject;
            if (retry) this.scheduleSave(retry, 0);
          }, 5_000);
        }
      });
    }, effectiveDelay);
  }

  private getUploadKey(projectId: string, mediaId: string): string {
    return `${projectId}:${mediaId}`;
  }

  private async hasCurrentBackendMedia(projectId: string, remoteUrl: string | undefined): Promise<boolean> {
    const persistedMediaPrefix = `${BASE_URL}/api/projects/${projectId}/media/`;
    if (!remoteUrl?.startsWith(persistedMediaPrefix)) return false;
    try {
      const response = await fetch(remoteUrl, { method: "HEAD" });
      console.debug("[Persistence] backend media freshness checked", {
        projectId,
        remoteUrl,
        status: response.status,
      });
      return response.ok;
    } catch (error) {
      console.warn("[Persistence] backend media freshness check failed; upload required", {
        projectId,
        remoteUrl,
        error,
      });
      return false;
    }
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
    } catch (error) {
      console.debug("[Persistence] orchestrator health check failed", error);
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
      const detail = await res.text();
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
      console.debug("[Persistence] skipped client-only project", { projectId: project.id });
      return;
    }

    const status = usePersistenceStatusStore.getState();
    status.markSaving(project.id);
    console.info("[Persistence] save started", {
      projectId: project.id,
      modifiedAt: project.modifiedAt,
      mediaItems: project.mediaLibrary.items.length,
      tracks: project.timeline.tracks.length,
    });

    try {
      await Promise.all(
        project.mediaLibrary.items.map(async (item) => {
          if (await this.hasCurrentBackendMedia(project.id, item.remoteUrl)) {
            console.debug("[Persistence] media already present; upload skipped", {
              projectId: project.id,
              mediaId: item.id,
            });
            return;
          }
          if (!isMediaBlob(item.blob)) return;
          return this.uploadMedia(project.id, item.id, item.blob, item.name);
        }),
      );
      console.debug("[Persistence] media stage complete", { projectId: project.id });

      const res = await fetch(`${BASE_URL}/api/projects/${project.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sanitize(project)),
        signal: AbortSignal.timeout(this.requestDeadlineMs),
      });
      if (!res.ok) {
        const responseText = await res.text();
        throw new Error(
          `Backend save failed: HTTP ${res.status}${responseText ? ` — ${responseText}` : ""}`,
        );
      }
      const receipt = await res.json() as PersistenceReceipt;
      if (!receipt.saved || receipt.projectId !== project.id || !receipt.persistedAt) {
        throw new Error(`Backend returned an invalid persistence receipt for ${project.id}`);
      }
      if (receipt.sourceModifiedAt !== project.modifiedAt) {
        throw new Error(
          `Backend persistence receipt timestamp mismatch for ${project.id}: expected ${project.modifiedAt}, received ${receipt.sourceModifiedAt}`,
        );
      }
      usePersistenceStatusStore
        .getState()
        .markPersisted(project.id, receipt.persistedAt, receipt.sourceModifiedAt);
      console.info("[Persistence] Git persistence confirmed", receipt);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      usePersistenceStatusStore.getState().markFailed(project.id, message);
      console.error("[Persistence] save failed", { projectId: project.id, error: message });
      reportRuntimeError(
        `Backend persistence failed for ${project.id}`,
        error,
        "backend-save.save",
      );
      throw error;
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
      if (!res.ok) {
        console.warn("[Persistence] project list failed", { status: res.status });
        return null;
      }
      return (await res.json()) as ProjectSummary[];
    } catch (error) {
      console.warn("[Persistence] project list request failed", error);
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
    } catch (error) {
      console.error("[Persistence] project delete request failed", { projectId, error });
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
      if (!res.ok) {
        console.warn("[Persistence] project load failed", { projectId, status: res.status });
        return null;
      }
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
    } catch (error) {
      console.error("[Persistence] project load request failed", { projectId, error });
      return null;
    }
  }
}

export const backendSaveService = new BackendSaveService();
