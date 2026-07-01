// apps/web/src/services/backend-save.ts
import type { Project, MediaItem } from "@openreel/core";

const BASE_URL: string =
  (import.meta.env["VITE_ORCHESTRATOR_URL"] as string | undefined) ?? "http://localhost:4041";

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
        waveformData: undefined,
        filmstripThumbnails: undefined,
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
  /** MediaIds successfully uploaded this session. Cleared on project switch. */
  private uploadedIds = new Set<string>();

  resetForProject(): void {
    this.uploadedIds.clear();
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
   * PUT sanitised project JSON to backend. Blobs, fileHandles, and
   * engine-only fields are stripped before sending.
   */
  async save(project: Project): Promise<void> {
    const res = await fetch(`${BASE_URL}/api/projects/${project.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sanitize(project)),
    });
    if (!res.ok) {
      throw new Error(`Backend save failed: HTTP ${res.status}`);
    }
  }

  /**
   * Upload a single media blob for a specific version. Idempotent —
   * already-uploaded mediaIds are skipped. Fire-and-forget.
   */
  uploadMediaAsync(projectId: string, mediaId: string, blob: Blob, filename: string): void {
    if (this.uploadedIds.has(mediaId)) return;
    this.uploadedIds.add(mediaId);

    const ext = getExt(blob, filename);
    const form = new FormData();
    form.append("file", blob, `${mediaId}${ext}`);

    fetch(`${BASE_URL}/api/projects/${projectId}/media/${mediaId}`, {
      method: "POST",
      body: form,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      })
      .catch((err) => {
        this.uploadedIds.delete(mediaId);
        console.error(`[BackendSave] media upload failed (${mediaId}):`, err);
      });
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

      const items = project.mediaLibrary.items.map((item) => {
        const filename = mediaFiles[item.id];
        if (!filename) return item;
        return { ...item, remoteUrl: `${BASE_URL}/api/projects/${projectId}/media/${filename}` };
      });

      return { ...project, mediaLibrary: { ...project.mediaLibrary, items } };
    } catch {
      return null;
    }
  }
}

export const backendSaveService = new BackendSaveService();
