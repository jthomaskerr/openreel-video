// apps/web/src/services/backend-save.ts
import type {
  Project,
  MediaItem,
  ProjectPersistenceStatusResponse,
  ProjectSaveReceipt,
  ProjectSettings,
  ProjectSaveRequest,
  RequiredMediaManifestEntry,
} from "@openreel/core";
import {
  generateThumbnailFromBlob,
  generateThumbnailFromUrl,
  shouldRegenerateThumbnail,
} from "../utils/media-recovery";
import { reportRuntimeError } from "../stores/notification-store";
import { isMediaBlob } from "../utils/media-blob";
import { usePersistenceStatusStore } from "../stores/persistence-status-store";
import { mediaAvailabilityRuntime } from "./media-verification";

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

export interface BackendProjectResponse extends ProjectSaveReceipt {
  project: Project;
  /** Map of mediaId → stored filename (e.g. "abc123.mp4") */
  mediaFiles: Record<string, string>;
}

type SaveIntent = NonNullable<ProjectSaveRequest["saveIntent"]>;

interface BackendSaveResponse extends ProjectSaveReceipt {
  project: Project;
}

interface SaveErrorBody {
  code?: string;
  project?: Project;
}

class TerminalPersistenceError extends Error {}

class MediaOriginalUnavailableError extends TerminalPersistenceError {
  constructor(readonly projectId: string, readonly mediaId: string) {
    super(`Media ${mediaId} original is unavailable for project ${projectId}`);
  }
}

function validateSaveResponse(
  response: BackendSaveResponse,
  expectedProjectId: string,
  expectedSourceModifiedAt: number,
): ProjectSaveReceipt {
  const nonEmpty = (value: unknown): value is string =>
    typeof value === "string" && value.trim().length > 0;
  const nullableNonEmpty = (value: unknown): value is string | null =>
    value === null || nonEmpty(value);
  const committed = response.committed !== false;
  if (response.saved !== true
    || (response.committed !== true && response.committed !== false)
    || response.projectId !== expectedProjectId
    || response.project?.id !== expectedProjectId
    || response.project.modifiedAt !== expectedSourceModifiedAt
    || response.sourceModifiedAt !== expectedSourceModifiedAt
    || (committed
      ? (typeof response.persistedAt !== "number"
        || !Number.isFinite(response.persistedAt)
        || response.persistedAt <= 0
        || !nonEmpty(response.commitSha)
        || !nonEmpty(response.treeSha)
        || !nonEmpty(response.projectBlobSha)
        || !nonEmpty(response.mediaManifestDigest))
      : (response.persistedAt !== null
        || !nullableNonEmpty(response.commitSha)
        || !nullableNonEmpty(response.treeSha)
        || !nullableNonEmpty(response.projectBlobSha)
        || !nullableNonEmpty(response.mediaManifestDigest)))
    || !Array.isArray(response.lfsPayloads)
    || (response.commitDueAt !== null
      && (typeof response.commitDueAt !== "number" || !Number.isFinite(response.commitDueAt)))
    || response.lfsPayloads.some((payload) =>
      !nonEmpty(payload.mediaId)
      || !nonEmpty(payload.semanticFilename)
      || !nonEmpty(payload.relativePhysicalPath)
      || !nonEmpty(payload.oid)
      || payload.local.state !== "verified"
      || !Number.isFinite(payload.local.actualSize)
    )) {
    const kind = response.committed === false ? "deferred" : "committed";
    throw new Error(`Backend returned an invalid ${kind} persistence response for ${expectedProjectId}`);
  }
  return response;
}

class BackendSaveService {
  /** In-flight media uploads keyed by project/media id so saves can await them. */
  private uploadPromises = new Map<string, Promise<void>>();
  private scheduledProject: Project | null = null;
  private scheduledSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private queueDeadlineTimer: ReturnType<typeof setTimeout> | null = null;
  private persistencePollTimer: ReturnType<typeof setTimeout> | null = null;
  private persistencePollGeneration = 0;
  private scheduledSaveStartedAt: number | null = null;
  private saveChain: Promise<void> = Promise.resolve();
  private readonly maxScheduleWaitMs = 5_000;
  private readonly queueDeadlineMs = 7_000;
  private readonly requestDeadlineMs = 20_000;

  resetForProject(preserveReceiptForProjectId?: string): void {
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
    this.persistencePollGeneration += 1;
    if (this.persistencePollTimer) {
      clearTimeout(this.persistencePollTimer);
      this.persistencePollTimer = null;
    }
    const status = usePersistenceStatusStore.getState();
    const hasMatchingConfirmedBase = preserveReceiptForProjectId != null
      && status.projectId === preserveReceiptForProjectId
      && status.baseRevision != null;
    if (!hasMatchingConfirmedBase) status.reset();
  }

  private schedulePersistenceConfirmation(
    projectId: string,
    receipt: ProjectSaveReceipt,
  ): void {
    this.persistencePollGeneration += 1;
    const generation = this.persistencePollGeneration;
    if (this.persistencePollTimer) clearTimeout(this.persistencePollTimer);
    if (receipt.commitDueAt === null) {
      this.persistencePollTimer = null;
      return;
    }

    const poll = async (): Promise<void> => {
      if (generation !== this.persistencePollGeneration) return;
      try {
        const response = await fetch(`${BASE_URL}/api/projects/${projectId}/persistence-status`);
        if (!response.ok) throw new Error(`Persistence status request failed (${response.status})`);
        const status = await response.json() as ProjectPersistenceStatusResponse;
        if (generation !== this.persistencePollGeneration
          || status.projectId !== projectId
          || status.sourceModifiedAt !== receipt.sourceModifiedAt) return;
        if (status.state === "clean" && status.receipt) {
          const confirmed = validateSaveResponse(
            {
              ...status.receipt,
              project: { id: projectId, modifiedAt: receipt.sourceModifiedAt } as Project,
            },
            projectId,
            receipt.sourceModifiedAt,
          );
          usePersistenceStatusStore.getState().markPersisted(projectId, confirmed);
          this.persistencePollTimer = null;
          return;
        }
        const phase = status.state === "committing"
          ? "committing"
          : status.state === "retry-wait" ? "retry-wait" : "deferred";
        usePersistenceStatusStore.getState().markCommitState(projectId, phase, status.error);
        if (status.state === "waiting" || status.state === "committing" || status.state === "retry-wait") {
          this.persistencePollTimer = setTimeout(() => void poll(), 1_000);
        }
      } catch (error) {
        usePersistenceStatusStore.getState().markCommitState(
          projectId,
          "retry-wait",
          error instanceof Error ? error.message : "Persistence confirmation failed",
        );
        this.persistencePollTimer = setTimeout(() => void poll(), 2_000);
      }
    };

    this.persistencePollTimer = setTimeout(
      () => void poll(),
      Math.max(0, receipt.commitDueAt - Date.now()),
    );
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
        if (error instanceof TerminalPersistenceError) return;
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

  private async hasCurrentBackendMedia(projectId: string, item: MediaItem): Promise<boolean> {
    if (!item.remoteUrl) return false;
    try {
      const url = new URL(item.remoteUrl);
      const base = new URL(BASE_URL);
      const expectedPath = `/api/projects/${encodeURIComponent(projectId)}/media/${encodeURIComponent(item.name)}`;
      if (url.origin !== base.origin || url.pathname !== expectedPath || url.search || url.hash) {
        return false;
      }

      const response = await fetch(url.toString(), { method: "HEAD" });
      const contentLength = Number(response.headers.get("content-length"));
      const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      const compatibleType = item.type === "video"
        ? contentType?.startsWith("video/")
        : item.type === "audio"
          ? contentType?.startsWith("audio/")
          : item.type === "image"
            ? contentType?.startsWith("image/")
            : contentType === "text/plain" || contentType === "application/x-subrip";
      console.debug("[Persistence] backend media freshness checked", {
        projectId,
        mediaId: item.id,
        remoteUrl: item.remoteUrl,
        status: response.status,
        contentLength,
        contentType,
      });
      return response.ok
        && Number.isFinite(contentLength)
        && contentLength === item.metadata.fileSize
        && compatibleType === true
        && contentType !== "text/html";
    } catch (error) {
      console.warn("[Persistence] backend media freshness check failed; upload required", {
        projectId,
        mediaId: item.id,
        remoteUrl: item.remoteUrl,
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
    const existing = this.uploadPromises.get(key);
    if (existing) return existing;

    const promise = (async () => {
      const ext = getExt(blob, filename);
      const form = new FormData();
      form.append("file", blob, filename || `${mediaId}${ext}`);

      const res = await fetch(`${BASE_URL}/api/projects/${projectId}/media/${mediaId}`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const pending = await res.json().catch(() => null) as {
        pending?: boolean;
        mediaId?: string;
      } | null;
      if (!pending?.pending || pending.mediaId !== mediaId) {
        throw new Error(`Backend returned an invalid pending upload response for ${mediaId}`);
      }
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
    const response = await res.json() as BackendSaveResponse;
    const receipt = validateSaveResponse(
      response,
      response.project?.id ?? "",
      response.project?.modifiedAt ?? Number.NaN,
    );
    usePersistenceStatusStore.getState().confirmReceipt(response.project.id, receipt);
    return response.project;
  }

  private async prepareSnapshot(
    project: Project,
    forceLocalIds: ReadonlySet<string> = new Set(),
  ): Promise<{
    project: Project;
    manifest: RequiredMediaManifestEntry[];
    uploads: Array<{ item: MediaItem; blob: Blob }>;
  }> {
    // Prove every original before uploading any of them. This prevents a
    // partial media stage from disguising an incomplete snapshot.
    const prepared = await Promise.all(project.mediaLibrary.items.map(async (item) => {
      if (!forceLocalIds.has(item.id) && await this.hasCurrentBackendMedia(project.id, item)) {
        return { item, blob: null, upload: false, byteSize: item.metadata.fileSize };
      }

      let blob = isMediaBlob(item.blob) ? item.blob : null;
      if (!blob && item.fileHandle) {
        try {
          const recovered = await item.fileHandle.getFile();
          if (isMediaBlob(recovered)) blob = recovered;
        } catch (error) {
          console.warn("[Persistence] media handle recovery failed", {
            projectId: project.id,
            mediaId: item.id,
            error,
          });
        }
      }
      if (!blob) throw new MediaOriginalUnavailableError(project.id, item.id);
      return { item: { ...item, blob }, blob, upload: true, byteSize: blob.size };
    }));

    return {
      project: {
        ...project,
        mediaLibrary: { ...project.mediaLibrary, items: prepared.map(({ item }) => item) },
      },
      manifest: prepared.map(({ item, byteSize }) => ({
        mediaId: item.id,
        semanticFilename: item.name,
        relativePhysicalPath: `media/${item.name}`,
        expectedByteSize: byteSize,
      })),
      uploads: prepared.flatMap(({ item, blob, upload }) =>
        upload && blob ? [{ item, blob }] : []
      ),
    };
  }

  private applyCanonicalFilenames(target: Project, canonical: Project): void {
    const names = new Map(canonical.mediaLibrary.items.map((item) => [item.id, item.name]));
    target.mediaLibrary.items.forEach((item, index) => {
      const name = names.get(item.id);
      if (name && name !== item.name) target.mediaLibrary.items[index] = { ...item, name };
    });
  }

  private async loadProjectWithoutConfirming(projectId: string): Promise<Project | null> {
    try {
      const response = await fetch(`${BASE_URL}/api/projects/${projectId}`);
      if (!response.ok) return null;
      return ((await response.json()) as BackendProjectResponse).project;
    } catch {
      return null;
    }
  }

  /**
   * PUT sanitised project JSON to backend. Blobs, fileHandles, and
   * engine-only fields are stripped before sending.
   */
  async save(project: Project, saveIntent: SaveIntent = "autosave"): Promise<void> {
    if (isClientOnlyProjectId(project.id)) {
      console.debug("[Persistence] skipped client-only project", { projectId: project.id });
      return;
    }

    const status = usePersistenceStatusStore.getState();
    const baseRevision = status.projectId === project.id ? status.baseRevision : null;
    status.markSaving(project.id);
    console.info("[Persistence] save started", {
      projectId: project.id,
      modifiedAt: project.modifiedAt,
      mediaItems: project.mediaLibrary.items.length,
      tracks: project.timeline.tracks.length,
    });

    try {
      if (!baseRevision) {
        throw new Error(`No confirmed base revision is available for project ${project.id}`);
      }

      let snapshot = project;
      let forceLocalIds = new Set<string>();
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const prepared = await this.prepareSnapshot(snapshot, forceLocalIds);
        snapshot = prepared.project;
        await Promise.all(prepared.uploads.map(({ item, blob }) =>
          this.uploadMedia(project.id, item.id, blob, item.name)
        ));
        console.debug("[Persistence] media stage complete", { projectId: project.id, attempt });

        const request: ProjectSaveRequest = {
          projectId: project.id,
          baseRevision,
          project: sanitize(snapshot) as ProjectSaveRequest["project"],
          requiredMediaManifest: prepared.manifest,
          saveIntent: attempt === 0 ? saveIntent : "recovery",
        };
        const res = await fetch(`${BASE_URL}/api/projects/${project.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(this.requestDeadlineMs),
        });

        if (!res.ok) {
          const responseText = await res.text();
          let body: (SaveErrorBody & { missingItems?: Array<{ mediaId?: string }> }) | null = null;
          try {
            body = JSON.parse(responseText) as SaveErrorBody & {
              missingItems?: Array<{ mediaId?: string }>;
            };
          } catch {
            // Preserve non-JSON response text in the visible failure below.
          }

          if (body?.code === "MEDIA_INCOMPLETE" && attempt === 0) {
            const missingIds = body.missingItems
              ?.map((item) => item.mediaId)
              .filter((id): id is string => Boolean(id));
            forceLocalIds = new Set(
              missingIds?.length ? missingIds : project.mediaLibrary.items.map((item) => item.id),
            );
            snapshot = {
              ...project,
              mediaLibrary: {
                ...project.mediaLibrary,
                items: project.mediaLibrary.items.map((item) => ({ ...item })),
              },
            };
            continue;
          }

          if (body?.code === "MEDIA_INCOMPLETE") {
            throw new TerminalPersistenceError(
              `Backend media recovery retry exhausted for ${project.id}`,
            );
          }

          if (body?.code === "PROJECT_CONFLICT") {
            const serverProject = body.project ?? await this.loadProjectWithoutConfirming(project.id);
            const message = `Project conflict for ${project.id}; the newer server state was preserved`;
            usePersistenceStatusStore.getState().markConflict(project.id, message, serverProject);
            throw new TerminalPersistenceError(message);
          }

          throw new Error(
            `Backend save failed: HTTP ${res.status}${responseText ? ` — ${responseText}` : ""}`,
          );
        }

        const response = await res.json() as BackendSaveResponse;
        if (response.committed === false) {
          const receipt = validateSaveResponse(response, project.id, snapshot.modifiedAt);
          this.applyCanonicalFilenames(project, response.project);
          usePersistenceStatusStore.getState().markDeferred(project.id, receipt);
          this.schedulePersistenceConfirmation(project.id, receipt);
          console.info(
            "[Persistence] worktree save durable; Git commit deferred",
            response,
          );
          return;
        }

        const receipt = validateSaveResponse(response, project.id, snapshot.modifiedAt);
        this.applyCanonicalFilenames(project, response.project);
        usePersistenceStatusStore.getState().markPersisted(project.id, receipt);
        console.info("[Persistence] Git persistence confirmed", receipt);
        return;
      }
      throw new Error(`Backend media recovery retry exhausted for ${project.id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const currentPhase = usePersistenceStatusStore.getState().phase;
      if (error instanceof MediaOriginalUnavailableError) {
        usePersistenceStatusStore.getState().markIncomplete(project.id, message);
      } else if (currentPhase !== "conflict") {
        usePersistenceStatusStore.getState().markFailed(project.id, message);
      }
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
    mediaAvailabilityRuntime.reset();
    try {
      const res = await fetch(`${BASE_URL}/api/projects/${projectId}`);
      if (!res.ok) {
        console.warn("[Persistence] project load failed", { projectId, status: res.status });
        return null;
      }
      const response = await res.json() as BackendProjectResponse;
      const { project, mediaFiles } = response;
      const receipt = validateSaveResponse(response, projectId, project.modifiedAt);
      if (receipt.committed === false) {
        usePersistenceStatusStore.getState().markDeferred(projectId, receipt);
        this.schedulePersistenceConfirmation(projectId, receipt);
      } else {
        usePersistenceStatusStore.getState().confirmReceipt(projectId, receipt);
      }

      const mediaIds = new Set(project.mediaLibrary.items.map(item => item.id));
      for (const track of project.timeline.tracks) {
        for (const clip of track.clips) mediaIds.add(clip.mediaId);
      }
      const verification = new Map((await mediaAvailabilityRuntime.verify(
        projectId,
        [...mediaIds],
        { currentUrl: mediaId => project.mediaLibrary.items.find(item => item.id === mediaId)?.remoteUrl },
      )).map(outcome => [outcome.mediaId, outcome]));

      const items = await Promise.all(
        project.mediaLibrary.items.map(async (item) => {
          const availability = verification.get(item.id)?.status;
          if (availability === "confirmed_missing" || availability === "unauthorized" || availability === "decode_error") {
            return item.thumbnailUrl?.startsWith("blob:")
              ? { ...item, thumbnailUrl: null, filmstripThumbnails: undefined }
              : item;
          }
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
            console.info("[BackendSave] media downloaded for hydration", {
              projectId,
              mediaId: item.id,
              mediaType: item.type,
              contentType: blob.type,
              byteLength: blob.size,
              hadThumbnail: Boolean(item.thumbnailUrl),
            });
          } catch (err) {
            console.error(`[BackendSave] media download failed (${item.id}):`, err);
          }

          const itemWithMedia = { ...item, remoteUrl, blob };

          if (!shouldRegenerateThumbnail(itemWithMedia)) {
            return itemWithMedia;
          }

          try {
            // WebKit can reject object URLs backed by fetched video blobs with
            // WebKitBlobResource error 1. Persisted videos already have a durable
            // media URL, so decode that URL directly and reserve blobs for fallback.
            let thumbnailUrl = item.type === "video"
              ? await generateThumbnailFromUrl(remoteUrl, item.type)
              : blob
                ? await generateThumbnailFromBlob(blob, item.type)
                : await generateThumbnailFromUrl(remoteUrl, item.type);
            if (thumbnailUrl) {
              console.info("[BackendSave] thumbnail hydration succeeded", {
                projectId,
                mediaId: item.id,
                mediaType: item.type,
                thumbnailKind: thumbnailUrl.startsWith("data:") ? "data" : thumbnailUrl.startsWith("blob:") ? "blob" : "remote",
              });
              return { ...itemWithMedia, thumbnailUrl };
            }
            console.warn("[BackendSave] thumbnail hydration returned no thumbnail", {
              projectId,
              mediaId: item.id,
              mediaType: item.type,
              contentType: blob?.type ?? null,
              byteLength: blob?.size ?? null,
            });
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
