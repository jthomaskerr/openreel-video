import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import crypto from "node:crypto";
import { mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { stat } from "node:fs/promises";
import type {
  MediaVerificationBatchRequest,
  MediaVerificationOutcome,
  ProjectSettings,
  Project,
  ProjectSaveRequest,
  ProjectSaveReceipt,
} from "@openreel/core";
import { ProjectStore } from "./project-store";
import {
  GitStore,
  type GitCommitTransaction,
  type GitCommitReceipt,
  type GitStagedNameStatusEntry,
} from "./git-store";
import { executeSaveTransaction, SaveTransactionError } from "./save-transaction";
import {
  cleanupExpiredPendingMedia,
  listPendingMedia,
  MAX_PENDING_MEDIA_BYTES,
  pendingUploadTempDirectory,
  removePendingMedia,
  storePendingUpload,
} from "./pending-media";
import {
  assertValidMediaFilename,
  assertValidMediaId,
  assertValidProjectId,
  resolveContainedPath,
} from "./storage-validation";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function stagedEntry(
  status: GitStagedNameStatusEntry["status"],
  path: string,
): GitStagedNameStatusEntry {
  return { status, path };
}

function commitTransaction(
  allowlist: readonly string[],
  expectedEntries: readonly GitStagedNameStatusEntry[],
): GitCommitTransaction {
  return {
    allowlist,
    expectedEntries,
  };
}

// ── Commit message helpers ───────────────────────────────────────────────────



// ── Request validation helpers ───────────────────────────────────────────────

function rejectInvalidProjectId(req: Request, res: Response): boolean {
  try {
    assertValidProjectId(req.params.id);
    return false;
  } catch {
    res.status(400).json({ error: "Invalid project id" });
    return true;
  }
}

function rejectInvalidMediaId(req: Request, res: Response): boolean {
  try {
    assertValidMediaId(req.params.mediaId);
    return false;
  } catch {
    res.status(400).json({ error: "Invalid media id" });
    return true;
  }
}

function rejectInvalidMediaFilename(req: Request, res: Response): boolean {
  try {
    assertValidMediaFilename(req.params.filename);
    return false;
  } catch {
    res.status(400).json({ error: "Invalid media filename" });
    return true;
  }
}

export function handleMediaSendError(res: Response, err?: Error): void {
  if (!err || res.headersSent) return;
  res.status(404).json({ error: "Media file not found" });
}

// ── Router factory ───────────────────────────────────────────────────────────

export function createProjectRouter(store: ProjectStore, gitStore: GitStore): Router {
  const router = Router();

  async function confirmedProjectPayload(
    project: Project,
    mediaFiles: Record<string, string>,
    committedReceipt?: GitCommitReceipt,
  ): Promise<{ project: Project; mediaFiles: Record<string, string> } & ProjectSaveReceipt> {
    const receipt = committedReceipt ?? await gitStore.readConfirmedReceipt(project.id);
    if (!receipt?.commitSha || !receipt.treeSha || !receipt.projectBlobSha || !receipt.mediaManifestDigest) {
      throw new Error(`Project ${project.id} has no complete confirmed receipt`);
    }
    const persistedAt = await gitStore.readCommitTimestamp(project.id, receipt.commitSha);
    if (!persistedAt) throw new Error(`Project ${project.id} commit timestamp is unavailable`);
    const audit = await store.auditSnapshot(project);
    if (audit.missingEntries.length > 0
      || audit.lfsPayloads.some((payload) => payload.local.state !== "verified")) {
      throw new Error(`Project ${project.id} committed media receipt failed verification`);
    }
    return {
      project,
      mediaFiles,
      saved: true,
      committed: true,
      projectId: project.id,
      persistedAt,
      sourceModifiedAt: project.modifiedAt,
      commitSha: receipt.commitSha,
      treeSha: receipt.treeSha,
      projectBlobSha: receipt.projectBlobSha,
      mediaManifestDigest: audit.mediaManifestDigest,
      lfsPayloads: audit.lfsPayloads,
    };
  }

  // Uploads remain outside saved membership until a typed snapshot claims them.
  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, _file, cb) => {
        try {
          assertValidProjectId(req.params.id);
          assertValidMediaId(req.params.mediaId);
          const dir = pendingUploadTempDirectory(store.projectDir(req.params.id));
          mkdirSync(dir, { recursive: true });
          cb(null, dir);
        } catch (err) {
          cb(err as Error, "");
        }
      },
      filename: (req, _file, cb) => {
        try {
          assertValidMediaId(req.params.mediaId);
          cb(null, `${req.params.mediaId}-${crypto.randomUUID()}.upload`);
        } catch (err) {
          cb(err as Error, "");
        }
      },
    }),
    limits: { fileSize: MAX_PENDING_MEDIA_BYTES, files: 1 },
  });

  // ═══ Config routes (must be before /:id to avoid shadowing) ═══════════════

  // GET /api/projects/config — expose autosave interval + remote URL
  router.get("/config", async (_req: Request, res: Response) => {
    try {
      const cfg = await gitStore.getConfig();
      res.json({
        autosaveIntervalMs: parseInt(process.env["AUTOSAVE_INTERVAL_MS"] ?? "60000", 10),
        remote: cfg.remote,
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to read config", detail: String(err) });
    }
  });

  // PUT /api/projects/config — set remote URL
  router.put("/config", async (req: Request, res: Response) => {
    try {
      const { remote } = req.body as { remote?: string };
      if (!remote?.trim()) {
        res.status(400).json({ error: "Remote URL is required" });
        return;
      }
      await gitStore.setRemote(remote.trim());
      res.json({ remote: remote.trim() });
    } catch (err) {
      res.status(500).json({ error: "Failed to set remote", detail: String(err) });
    }
  });

  // ═══ Project CRUD ═════════════════════════════════════════════════════════

  // GET /api/projects — list all
  router.get("/", async (_req: Request, res: Response) => {
    try {
      res.json(await store.listProjects());
    } catch (err) {
      res.status(500).json({ error: "Failed to list projects", detail: String(err) });
    }
  });

  // GET /api/projects/:id — load project + media filename map
  router.get("/:id", async (req: Request, res: Response) => {
    if (rejectInvalidProjectId(req, res)) return;
    try {
      const project = await store.loadProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      const mediaFiles = await store.scanMedia(req.params.id);
      res.json(await confirmedProjectPayload(project, mediaFiles));
    } catch (err) {
      res.status(500).json({ error: "Failed to load project", detail: String(err) });
    }
  });

  // POST /api/projects — create new
  router.post("/", async (req: Request, res: Response) => {
    try {
      const { name, settings } = req.body as {
        name?: string;
        settings?: Partial<ProjectSettings>;
      };
      if (!name?.trim()) {
        res.status(400).json({ error: "Project name is required" });
        return;
      }
      const project = await store.createProject(name.trim(), settings);
      console.info("[Persistence] project created; committing", { projectId: project.id });
      const receipt = await gitStore.commit(
        project.id,
        `init: create project "${project.name}"`,
        commitTransaction(
          ["project.json"],
          [stagedEntry("A", "project.json")],
        ),
      );
      console.info("[Persistence] initial commit confirmed", { projectId: project.id });
      res.status(201).json(await confirmedProjectPayload(project, {}, receipt));
    } catch (err) {
      res.status(500).json({ error: "Failed to create project", detail: String(err) });
    }
  });

  // Slugify a project name for use as a directory/URL token
  function toSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .substring(0, 60) || "unnamed-project";
  }

  function canonicalProjectId(project: Pick<Project, "id" | "name">): string {
    const id = project.id?.trim();
    if (id && !isUuid(id)) return id;
    return toSlug(project.name.trim());
  }

  // POST /api/projects/import — create project from full JSON payload (file import)
  router.post("/import", async (req: Request, res: Response) => {
    try {
      const project = req.body as Project;
      if (!project?.name?.trim()) {
        res.status(400).json({ error: "Project name is required" });
        return;
      }
      // Imported project JSON often contains legacy/client-generated UUIDs.
      // The backend git store uses stable slug IDs for project worktrees, so
      // convert UUIDs to the same slug assigned by POST /api/projects.
      const id = canonicalProjectId(project);
      const saved = await store.saveProject({ ...project, id });
      const receipt = await gitStore.commit(
        saved.id,
        `import: create from file "${saved.name}"`,
        commitTransaction(
          ["project.json"],
          [stagedEntry("A", "project.json")],
        ),
      );
      res.status(201).json(await confirmedProjectPayload(saved, {}, receipt));
    } catch (err) {
      console.error("[POST /api/projects/import] failed:", err);
      res.status(500).json({ error: "Failed to import project", detail: String(err) });
    }
  });

  // PUT /api/projects/:id — atomically audit, conflict-check, stage and commit a snapshot
  router.put("/:id", async (req: Request, res: Response) => {
    if (rejectInvalidProjectId(req, res)) return;
    try {
      const request = req.body as ProjectSaveRequest;
      const incoming = request?.project as Project | undefined;
      if (!request?.baseRevision || !incoming?.id || request.projectId !== req.params.id
        || incoming.id !== req.params.id || !incoming.name?.trim()
        || !Array.isArray(request.requiredMediaManifest)) {
        res.status(400).json({ error: "Invalid project save request" });
        return;
      }

      if (isUuid(incoming.id)) {
        res.status(400).json({ error: "UUID project ids are not allowed — use the slug assigned by POST /api/projects" });
        return;
      }

      console.info("[Persistence] PUT validated", {
        projectId: req.params.id,
        modifiedAt: incoming.modifiedAt,
        mediaItems: incoming.mediaLibrary.items.length,
        tracks: incoming.timeline.tracks.length,
      });
      const receipt = await executeSaveTransaction(store, gitStore, request);
      console.info("[Persistence] Git commit confirmed", {
        projectId: req.params.id,
        persistedAt: receipt.persistedAt,
        commitSha: receipt.commitSha,
      });
      res.json(receipt);
    } catch (err) {
      if (err instanceof SaveTransactionError) {
        res.status(err.status).json(err.body);
        return;
      }
      console.error("[PUT /api/projects/:id] save failed:", err);
      res.status(500).json({ error: "Failed to save project", detail: String(err) });
    }
  });

  // PATCH /api/projects/:id — rename
  router.patch("/:id", async (req: Request, res: Response) => {
    if (rejectInvalidProjectId(req, res)) return;
    try {
      const { name } = req.body as { name?: string };
      if (!name?.trim()) {
        res.status(400).json({ error: "Project name is required" });
        return;
      }
      const project = await store.renameProject(req.params.id, name.trim());
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      const expectedEntries = project.id === req.params.id
        ? [stagedEntry("M", "project.json")]
        : [stagedEntry("A", "project.json")];
      await gitStore.commit(
        project.id,
        `rename → "${project.name}"`,
        commitTransaction(
          expectedEntries.map((entry) => entry.path),
          expectedEntries,
        ),
      );
      res.json(project);
    } catch (err) {
      res.status(500).json({ error: "Failed to rename project", detail: String(err) });
    }
  });

  // DELETE /api/projects/:id
  router.delete("/:id", async (req: Request, res: Response) => {
    if (rejectInvalidProjectId(req, res)) return;
    try {
      const deleted = await store.deleteProject(req.params.id);
      if (!deleted) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      res.json({ deleted: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to delete project", detail: String(err) });
    }
  });

  // ═══ Media ════════════════════════════════════════════════════════════════

  // POST /api/projects/:id/media/:mediaId — upload one media file
  router.post(
    "/:id/media/:mediaId",
    async (req: Request, res: Response, next: NextFunction) => {
      if (rejectInvalidProjectId(req, res) || rejectInvalidMediaId(req, res)) return;
      try {
        await store.ensureProjectWorktree(req.params.id);
        next();
      } catch (err) {
        res.status(500).json({ error: "Failed to prepare project media directory", detail: String(err) });
      }
    },
    upload.single("file"),
    async (req: Request, res: Response) => {
      try {
        if (!req.file) {
          res.status(400).json({ error: "No file uploaded" });
          return;
        }
        const pending = await storePendingUpload(
          store.projectDir(req.params.id),
          req.params.mediaId,
          req.file.path,
          req.file.originalname,
          req.file.mimetype,
          req.file.size,
        );
        await cleanupExpiredPendingMedia(store.projectDir(req.params.id));
        res.json({
          pending: true,
          mediaId: pending.mediaId,
          originalFilename: pending.originalFilename,
          byteSize: pending.byteSize,
        });
      } catch (err) {
        if (req.file?.path) await rm(req.file.path, { force: true }).catch(() => undefined);
        const status = err instanceof TypeError ? 415 : err instanceof RangeError ? 413 : 500;
        res.status(status).json({ error: "Failed to upload media", detail: String(err) });
      }
    },
  );

  router.get("/:id/media/pending", async (req: Request, res: Response) => {
    if (rejectInvalidProjectId(req, res)) return;
    try {
      const entries = await listPendingMedia(store.projectDir(req.params.id));
      res.json(entries.map(({ contentPath: _contentPath, entryDirectory: _entryDirectory, ...entry }) => ({
        ...entry,
        pending: true,
      })));
    } catch (err) {
      res.status(500).json({ error: "Failed to list pending media", detail: String(err) });
    }
  });

  router.delete("/:id/media/pending/:mediaId", async (req: Request, res: Response) => {
    if (rejectInvalidProjectId(req, res) || rejectInvalidMediaId(req, res)) return;
    try {
      await removePendingMedia(store.projectDir(req.params.id), req.params.mediaId);
      res.json({ removed: true, mediaId: req.params.mediaId });
    } catch (err) {
      res.status(500).json({ error: "Failed to remove pending media", detail: String(err) });
    }
  });

  // GET /api/projects/:id/media/:filename — serve a media file
  router.get("/:id/media/:filename", (req: Request, res: Response) => {
    if (rejectInvalidProjectId(req, res) || rejectInvalidMediaFilename(req, res)) return;
    const mediaDir = store.mediaDir(req.params.id);
    const filePath = resolveContainedPath(mediaDir, req.params.filename);
    res.sendFile(filePath, (err) => {
      handleMediaSendError(res, err);
    });
  });

  // POST /api/projects/:id/verify-media — authoritative project-scoped mapping + object proof.
  router.post("/:id/verify-media", async (req: Request, res: Response) => {
    if (rejectInvalidProjectId(req, res)) return;
    const body = req.body as Partial<MediaVerificationBatchRequest> | undefined;
    if (!Array.isArray(body?.mediaIds) || body.mediaIds.length > 100) {
      res.status(400).json({ error: "mediaIds must be an array of at most 100 ids" });
      return;
    }
    try {
      for (const mediaId of body.mediaIds) assertValidMediaId(mediaId);
    } catch {
      res.status(400).json({ error: "Invalid media id" });
      return;
    }

    const project = await store.loadProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const requestedMediaIds = [...new Set(body.mediaIds)];
    const items = new Map(project.mediaLibrary.items.map(item => [item.id, item]));
    const outcomes: MediaVerificationOutcome[] = [];
    for (const mediaId of requestedMediaIds) {
      const item = items.get(mediaId);
      const mapping = item ? "present" as const : "absent" as const;
      if (!item) {
        outcomes.push({ mediaId, status: "confirmed_missing", evidence: { authoritative: true, mapping, object: "absent", reason: "media id is not associated with this project" } });
        continue;
      }

      const filename = item.name;
      const expectedBytes = item.metadata.fileSize;
      let statError: unknown;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const info = await stat(resolveContainedPath(store.mediaDir(req.params.id), filename));
          const actualBytes = info.size;
          const corrupt = !info.isFile() || actualBytes <= 0 || (expectedBytes > 0 && actualBytes !== expectedBytes);
          outcomes.push({
            mediaId,
            status: corrupt ? "decode_error" : "available",
            evidence: { authoritative: true, mapping, object: "present", filename, expectedBytes, actualBytes, reason: corrupt ? "zero, truncated, or size-mismatched object" : undefined },
          });
          statError = undefined;
          break;
        } catch (error) {
          statError = error;
          const code = error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
          if (attempt === 0 && (code === "ENOENT" || code === "ENOTDIR")) continue;
          break;
        }
      }
      if (statError) {
        const code = statError && typeof statError === "object" && "code" in statError ? String(statError.code) : undefined;
        outcomes.push(code === "ENOENT" || code === "ENOTDIR"
          ? { mediaId, status: "confirmed_missing", evidence: { authoritative: true, mapping, object: "absent", filename, expectedBytes } }
          : { mediaId, status: "temporarily_unavailable", evidence: { authoritative: false, mapping, object: "unknown", filename, expectedBytes, reason: `media stat failed${code ? ` (${code})` : ""}` } });
      }
    }
    res.json({ projectId: req.params.id, outcomes });
  });

  // ═══ History ══════════════════════════════════════════════════════════════

  // GET /api/projects/:id/history — list commits for project.json
  router.get("/:id/history", async (req: Request, res: Response) => {
    if (rejectInvalidProjectId(req, res)) return;
    try {
      const history = await gitStore.getHistory(req.params.id);
      res.json(history);
    } catch (err) {
      res.status(500).json({ error: "Failed to get history", detail: String(err) });
    }
  });

  // GET /api/projects/:id/history/:sha — get project at a specific commit
  router.get("/:id/history/:sha", async (req: Request, res: Response) => {
    if (rejectInvalidProjectId(req, res)) return;
    try {
      const project = await gitStore.getProjectAtCommit(req.params.id, req.params.sha);
      if (!project) {
        res.status(404).json({ error: "Commit not found" });
        return;
      }
      res.json(project);
    } catch (err) {
      res.status(500).json({ error: "Failed to get project at commit", detail: String(err) });
    }
  });

  return router;
}
