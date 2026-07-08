import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { mkdirSync } from "node:fs";
import { extname } from "node:path";
import type { ProjectSettings, Project } from "@openreel/core";
import { ProjectStore } from "./project-store";
import { GitStore } from "./git-store";
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

// ── Commit message helpers ───────────────────────────────────────────────────

function generateCommitMessage(prev: Project | null, next: Project): string {
  if (!prev) return `save: initial save of "${next.name}"`;
  const parts: string[] = [];
  if (prev.name !== next.name) parts.push(`rename → "${next.name}"`);
  const prevClips = prev.timeline.tracks.reduce((n, t) => n + t.clips.length, 0);
  const nextClips = next.timeline.tracks.reduce((n, t) => n + t.clips.length, 0);
  const clipDelta = nextClips - prevClips;
  if (clipDelta > 0) parts.push(`+${clipDelta} clip(s)`);
  else if (clipDelta < 0) parts.push(`${clipDelta} clip(s)`);
  const nextMedia = next.mediaLibrary.items.length;
  const prevMedia = prev.mediaLibrary.items.length;
  const mediaDelta = nextMedia - prevMedia;
  if (mediaDelta > 0) parts.push(`+${mediaDelta} media item(s)`);
  const prevActive = new Set(prev.mediaLibrary.items.filter((i) => i.isCurrent).map((i) => i.id));
  const nextActive = new Set(next.mediaLibrary.items.filter((i) => i.isCurrent).map((i) => i.id));
  const switched = [...nextActive].filter((id) => !prevActive.has(id));
  if (switched.length > 0) parts.push(`switch active version (${switched.length} asset(s))`);
  if (parts.length === 0) parts.push("auto-save");
  return parts.join(", ");
}

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

// ── Router factory ───────────────────────────────────────────────────────────

export function createProjectRouter(store: ProjectStore, gitStore: GitStore): Router {
  const router = Router();

  // Multer: disk storage — destination = project media dir, filename = <mediaId><ext>
  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, _file, cb) => {
        try {
          assertValidProjectId(req.params.id);
          assertValidMediaId(req.params.mediaId);
          const dir = store.mediaDir(req.params.id);
          mkdirSync(dir, { recursive: true });
          cb(null, dir);
        } catch (err) {
          cb(err as Error, "");
        }
      },
      filename: (req, file, cb) => {
        try {
          assertValidMediaId(req.params.mediaId);
          const filename = `${req.params.mediaId}${extname(file.originalname)}`;
          assertValidMediaFilename(filename);
          cb(null, filename);
        } catch (err) {
          cb(err as Error, "");
        }
      },
    }),
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
      res.json({ project, mediaFiles });
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
      gitStore.commitAsync(project.id, `init: create project "${project.name}"`);
      res.status(201).json(project);
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
      gitStore.commitAsync(saved.id, `import: create from file "${saved.name}"`);
      res.status(201).json(saved);
    } catch (err) {
      console.error("[POST /api/projects/import] failed:", err);
      res.status(500).json({ error: "Failed to import project", detail: String(err) });
    }
  });

  // PUT /api/projects/:id — upsert project.json + git commit
  router.put("/:id", async (req: Request, res: Response) => {
    if (rejectInvalidProjectId(req, res)) return;
    try {
      const incoming = req.body as Project;
      if (!incoming?.id || incoming.id !== req.params.id || !incoming.name?.trim()) {
        res.status(400).json({ error: "Invalid project payload" });
        return;
      }

      if (isUuid(incoming.id)) {
        res.status(400).json({ error: "UUID project ids are not allowed — use the slug assigned by POST /api/projects" });
        return;
      }

      const prev = await store.loadProject(req.params.id);
      const saved = await store.saveProject(incoming);
      gitStore.commitAsync(req.params.id, generateCommitMessage(prev, saved));
      res.json({ saved: true });
    } catch (err) {
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
      gitStore.commitAsync(project.id, `rename → "${project.name}"`);
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
        gitStore.commitAsync(
          req.params.id,
          `media: add ${req.file.originalname} (${req.params.mediaId})`,
        );
        res.json({ filename: req.file.filename });
      } catch (err) {
        res.status(500).json({ error: "Failed to upload media", detail: String(err) });
      }
    },
  );

  // GET /api/projects/:id/media/:filename — serve a media file
  router.get("/:id/media/:filename", (req: Request, res: Response) => {
    if (rejectInvalidProjectId(req, res) || rejectInvalidMediaFilename(req, res)) return;
    const mediaDir = store.mediaDir(req.params.id);
    const filePath = resolveContainedPath(mediaDir, req.params.filename);
    res.sendFile(filePath, (err) => {
      if (err) res.status(404).json({ error: "Media file not found" });
    });
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
