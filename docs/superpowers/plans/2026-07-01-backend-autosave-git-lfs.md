# Backend Auto-Save with Git LFS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push every auto-save to a per-project git repository (with git-lfs for media files) so project structure and every media version are durably versioned on the local filesystem.

**Architecture:** Each project lives in `<projectsDir>/<projectId>/` as an independent git repo. `project.json` always declares the active media version via `isCurrent: true` on the relevant `MediaItem`. Every media asset version is stored as an immutable file in `media/` tracked by git-lfs. The web app pushes project JSON and media blobs to the orchestrator; the orchestrator commits after each write. On reload, the web app restores from the backend (primary) with IDB as fallback.

**Tech Stack:** Node.js `child_process.exec` for git, `multer` for multipart file upload, `express.static`-style route for media serving, existing Zustand project store + `autoSaveManager` on the web side.

---

## Version tracking model

Each `MediaItem.id` is a UUID unique to that version. All versions of "the same asset" share `assetGroupId`. `isCurrent: true` marks the active one. When the user picks a different version, only `project.json` changes (the `isCurrent` flag flips). All binary files remain in `media/` forever — nothing is deleted or overwritten. git-lfs deduplicates identical content automatically.

---

## File map

### Orchestrator (create/modify)
| File | Action |
|---|---|
| `apps/orchestrator/src/projects/git-store.ts` | **Create** — `GitStore` class: `ensureRepo`, `commitAsync` |
| `apps/orchestrator/src/projects/project-store.ts` | **Rewrite** — per-project dirs, `saveMedia`, `mediaDir`, `scanMedia` |
| `apps/orchestrator/src/projects/routes.ts` | **Modify** — add `PUT /:id`, `POST /:id/media/:mediaId`, `GET /:id/media/:filename`, `GET /config` |
| `apps/orchestrator/src/projects/index.ts` | **Modify** — re-export `GitStore` |
| `apps/orchestrator/src/app.ts` | **Modify** — wire multer, expose config route |
| `apps/orchestrator/package.json` | **Modify** — add `multer`, `@types/multer` |

### Core (modify)
| File | Action |
|---|---|
| `packages/core/src/types/project.ts` | **Modify** — add `remoteUrl?: string` to `MediaItem` |

### Web (create/modify)
| File | Action |
|---|---|
| `apps/web/src/services/backend-save.ts` | **Create** — `BackendSaveService`: `save`, `uploadMediaAsync`, `load`, `isReachable` |
| `apps/web/src/stores/project-store.ts` | **Modify** — call backend save in `initializeAutoSave`; upload media in `importMedia`, `addGeneratedMedia`, `replacePlaceholderMedia`; reset on `createNewProject`/`loadProject` |
| `apps/web/src/hooks/useProjectRecovery.ts` | **Modify** — try backend first when `autoRestoreProjectId` is set |

---

## Task 1: Per-project directory structure (orchestrator ProjectStore)

**Files:**
- Rewrite: `apps/orchestrator/src/projects/project-store.ts`

- [ ] **Step 1: Replace the class body**

```typescript
// apps/orchestrator/src/projects/project-store.ts
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname, basename } from "node:path";
import type { Project, ProjectSettings } from "@openreel/core";

export interface ProjectSummary {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  readonly modifiedAt: number;
}

function defaultSettings(): ProjectSettings {
  return { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 };
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

  projectDir(id: string): string {
    return join(this.projectsDir, id);
  }

  private projectJsonPath(id: string): string {
    return join(this.projectDir(id), "project.json");
  }

  mediaDir(id: string): string {
    return join(this.projectDir(id), "media");
  }

  async ensureProjectDir(id: string): Promise<void> {
    await mkdir(this.mediaDir(id), { recursive: true });
  }

  async listProjects(): Promise<ProjectSummary[]> {
    await mkdir(this.projectsDir, { recursive: true });
    const entries = await readdir(this.projectsDir, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory());
    const summaries: ProjectSummary[] = [];
    for (const dir of dirs) {
      const jsonPath = join(this.projectsDir, dir.name, "project.json");
      if (!existsSync(jsonPath)) continue;
      try {
        const raw = await readFile(jsonPath, "utf-8");
        const p = JSON.parse(raw) as Project;
        summaries.push({ id: p.id, name: p.name, createdAt: p.createdAt, modifiedAt: p.modifiedAt });
      } catch { /* skip corrupt */ }
    }
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

  async saveProject(project: Project): Promise<void> {
    await this.ensureProjectDir(project.id);
    const updated: Project = { ...project, modifiedAt: Date.now() };
    await writeFile(this.projectJsonPath(project.id), JSON.stringify(updated, null, 2), "utf-8");
  }

  async createProject(name: string, settings?: Partial<ProjectSettings>): Promise<Project> {
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
    const path = this.projectJsonPath(id);
    if (!existsSync(path)) return false;
    // Remove project.json only; leave media for git history
    const { unlink } = await import("node:fs/promises");
    await unlink(path);
    return true;
  }

  /** Save a media blob to <projectDir>/media/<mediaId><ext> */
  async saveMedia(projectId: string, mediaId: string, filename: string, buffer: Buffer): Promise<string> {
    await this.ensureProjectDir(projectId);
    const ext = extname(filename);
    const storedName = `${mediaId}${ext}`;
    await writeFile(join(this.mediaDir(projectId), storedName), buffer);
    return storedName;
  }

  /** Scan media dir and return { [mediaId]: storedFilename } */
  async scanMedia(projectId: string): Promise<Record<string, string>> {
    const dir = this.mediaDir(projectId);
    if (!existsSync(dir)) return {};
    const files = await readdir(dir);
    const result: Record<string, string> = {};
    for (const file of files) {
      const mediaId = basename(file, extname(file));
      result[mediaId] = file;
    }
    return result;
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/orchestrator && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/orchestrator/src/projects/project-store.ts
git commit -m "refactor(orchestrator): per-project directory layout with media dir"
```

---

## Task 2: GitStore with git-lfs

**Files:**
- Create: `apps/orchestrator/src/projects/git-store.ts`

- [ ] **Step 1: Create the file**

```typescript
// apps/orchestrator/src/projects/git-store.ts
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const execAsync = promisify(exec);

const GITATTRIBUTES = `# git-lfs tracks all media files
media/** filter=lfs diff=lfs merge=lfs -text
`;

async function run(cmd: string, cwd: string): Promise<void> {
  await execAsync(cmd, { cwd });
}

export class GitStore {
  /**
   * Ensure <dir> is a git repo with lfs enabled and .gitattributes written.
   * Idempotent — safe to call on every save.
   */
  async ensureRepo(dir: string): Promise<void> {
    if (existsSync(join(dir, ".git"))) return;

    await run("git init", dir);
    await run("git lfs install --local", dir);

    await writeFile(join(dir, ".gitattributes"), GITATTRIBUTES, "utf-8");
    await run("git add .gitattributes", dir);
    await run('git commit -m "init: create project repository with git-lfs"', dir);
  }

  /**
   * Stage all changes and commit. Fire-and-forget — never throws to caller.
   * The HTTP response is not held waiting for git.
   */
  commitAsync(dir: string, message: string): void {
    this._commit(dir, message).catch((err) =>
      console.error(`[GitStore] commit failed in ${dir}:`, err),
    );
  }

  private async _commit(dir: string, message: string): Promise<void> {
    await this.ensureRepo(dir);
    await run("git add -A", dir);
    try {
      await run(`git commit -m ${JSON.stringify(message)}`, dir);
    } catch (err: unknown) {
      // "nothing to commit" is not a real error
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("nothing to commit")) throw err;
    }
  }
}

export const gitStore = new GitStore();
```

- [ ] **Step 2: Export from index**

Edit `apps/orchestrator/src/projects/index.ts` to add:
```typescript
export { GitStore, gitStore } from "./git-store";
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd apps/orchestrator && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/orchestrator/src/projects/git-store.ts apps/orchestrator/src/projects/index.ts
git commit -m "feat(orchestrator): GitStore — git-lfs repo init and async commit"
```

---

## Task 3: Add multer to orchestrator

**Files:**
- Modify: `apps/orchestrator/package.json`

- [ ] **Step 1: Install multer**

```bash
cd apps/orchestrator && pnpm add multer && pnpm add -D @types/multer
```

- [ ] **Step 2: Verify**

```bash
cd apps/orchestrator && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add apps/orchestrator/package.json pnpm-lock.yaml
git commit -m "chore(orchestrator): add multer for multipart file uploads"
```

---

## Task 4: New orchestrator routes

**Files:**
- Rewrite: `apps/orchestrator/src/projects/routes.ts`

- [ ] **Step 1: Replace routes.ts**

```typescript
// apps/orchestrator/src/projects/routes.ts
import { Router } from "express";
import type { Request, Response } from "express";
import multer from "multer";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ProjectSettings, Project } from "@openreel/core";
import { ProjectStore } from "./project-store";
import { gitStore } from "./git-store";

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
  const prevMedia = prev.mediaLibrary.items.filter((i) => i.isCurrent !== false).length;
  const nextMedia = next.mediaLibrary.items.filter((i) => i.isCurrent !== false).length;
  const mediaDelta = nextMedia - prevMedia;
  if (mediaDelta > 0) parts.push(`+${mediaDelta} media item(s)`);
  // Detect active-version switch
  const prevActive = new Set(prev.mediaLibrary.items.filter((i) => i.isCurrent).map((i) => i.id));
  const nextActive = new Set(next.mediaLibrary.items.filter((i) => i.isCurrent).map((i) => i.id));
  const switched = [...nextActive].filter((id) => !prevActive.has(id));
  if (switched.length > 0) parts.push(`switch active version (${switched.length} asset(s))`);
  if (parts.length === 0) parts.push("auto-save");
  return parts.join(", ");
}

// ── Router factory ───────────────────────────────────────────────────────────

export function createProjectRouter(store: ProjectStore): Router {
  const router = Router();

  // Multer: disk storage, destination per project, filename = <mediaId><ext>
  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, _file, cb) => {
        const dir = store.mediaDir(req.params.id);
        mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (req, file, cb) => {
        const { path: pathMod } = require("node:path") as typeof import("node:path");
        const ext = pathMod.extname(file.originalname);
        cb(null, `${req.params.mediaId}${ext}`);
      },
    }),
  });

  // GET /api/projects/config — expose autosave interval to web app
  router.get("/config", (_req: Request, res: Response) => {
    res.json({
      autosaveIntervalMs: parseInt(process.env["AUTOSAVE_INTERVAL_MS"] ?? "60000", 10),
    });
  });

  // GET /api/projects — list all
  router.get("/", async (_req: Request, res: Response) => {
    try {
      res.json(await store.listProjects());
    } catch (err) {
      res.status(500).json({ error: "Failed to list projects", detail: String(err) });
    }
  });

  // GET /api/projects/:id — load project + media URL map
  router.get("/:id", async (req: Request, res: Response) => {
    try {
      const project = await store.loadProject(req.params.id);
      if (!project) { res.status(404).json({ error: "Project not found" }); return; }
      const mediaMap = await store.scanMedia(req.params.id);
      res.json({ project, mediaFiles: mediaMap });
    } catch (err) {
      res.status(500).json({ error: "Failed to load project", detail: String(err) });
    }
  });

  // POST /api/projects — create new
  router.post("/", async (req: Request, res: Response) => {
    try {
      const { name, settings } = req.body as { name?: string; settings?: Partial<ProjectSettings> };
      if (!name?.trim()) { res.status(400).json({ error: "Project name is required" }); return; }
      const project = await store.createProject(name.trim(), settings);
      gitStore.commitAsync(store.projectDir(project.id), `init: create project "${project.name}"`);
      res.status(201).json(project);
    } catch (err) {
      res.status(500).json({ error: "Failed to create project", detail: String(err) });
    }
  });

  // PUT /api/projects/:id — upsert project.json + git commit
  router.put("/:id", async (req: Request, res: Response) => {
    try {
      const incoming = req.body as Project;
      if (!incoming?.id || incoming.id !== req.params.id) {
        res.status(400).json({ error: "Invalid project payload" }); return;
      }
      const prev = await store.loadProject(req.params.id);
      await store.saveProject(incoming);
      const message = generateCommitMessage(prev, incoming);
      gitStore.commitAsync(store.projectDir(req.params.id), message);
      res.json({ saved: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to save project", detail: String(err) });
    }
  });

  // PATCH /api/projects/:id — rename
  router.patch("/:id", async (req: Request, res: Response) => {
    try {
      const { name } = req.body as { name?: string };
      if (!name?.trim()) { res.status(400).json({ error: "Project name is required" }); return; }
      const project = await store.renameProject(req.params.id, name.trim());
      if (!project) { res.status(404).json({ error: "Project not found" }); return; }
      gitStore.commitAsync(store.projectDir(req.params.id), `rename → "${project.name}"`);
      res.json(project);
    } catch (err) {
      res.status(500).json({ error: "Failed to rename project", detail: String(err) });
    }
  });

  // DELETE /api/projects/:id
  router.delete("/:id", async (req: Request, res: Response) => {
    try {
      const deleted = await store.deleteProject(req.params.id);
      if (!deleted) { res.status(404).json({ error: "Project not found" }); return; }
      res.json({ deleted: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to delete project", detail: String(err) });
    }
  });

  // POST /api/projects/:id/media/:mediaId — upload one media file
  router.post("/:id/media/:mediaId", upload.single("file"), async (req: Request, res: Response) => {
    try {
      if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }
      const storedName = req.file.filename; // set by multer diskStorage filename cb
      gitStore.commitAsync(
        store.projectDir(req.params.id),
        `media: add ${req.file.originalname} (${req.params.mediaId})`,
      );
      res.json({ filename: storedName });
    } catch (err) {
      res.status(500).json({ error: "Failed to upload media", detail: String(err) });
    }
  });

  // GET /api/projects/:id/media/:filename — serve a media file
  router.get("/:id/media/:filename", (req: Request, res: Response) => {
    const filePath = join(store.mediaDir(req.params.id), req.params.filename);
    res.sendFile(filePath, (err) => {
      if (err) res.status(404).json({ error: "Media file not found" });
    });
  });

  return router;
}
```

- [ ] **Step 2: Fix the require() inside the multer callback** — replace `require("node:path")` with a top-level import:

At the top of the file (already have `join` imported from `node:path`). Change the `filename` callback to:
```typescript
filename: (req, file, cb) => {
  const ext = join(file.originalname).match(/\.[^.]+$/)?.[0] ?? "";
  cb(null, `${req.params.mediaId}${ext}`);
},
```

Or simpler — import `extname` at the top level and use it:
```typescript
import { join, extname } from "node:path";
// ...
filename: (req, file, cb) => {
  cb(null, `${req.params.mediaId}${extname(file.originalname)}`);
},
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd apps/orchestrator && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/orchestrator/src/projects/routes.ts
git commit -m "feat(orchestrator): PUT upsert, POST media upload, GET media serve, GET config routes"
```

---

## Task 5: Wire orchestrator app

**Files:**
- Modify: `apps/orchestrator/src/app.ts`

- [ ] **Step 1: Increase JSON body limit to 50mb (project JSON with embedded text can be large)**

In `app.ts`, change:
```typescript
app.use(express.json({ limit: "10mb" }));
```
to:
```typescript
app.use(express.json({ limit: "50mb" }));
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd apps/orchestrator && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/orchestrator/src/app.ts
git commit -m "chore(orchestrator): raise JSON body limit to 50mb"
```

---

## Task 6: Add remoteUrl to MediaItem (core)

**Files:**
- Modify: `packages/core/src/types/project.ts`

- [ ] **Step 1: Add the field**

In the `MediaItem` interface, after the `group` field, add:

```typescript
/** Backend URL where this media version's binary is stored. Populated on backend load; stripped before save. */
readonly remoteUrl?: string;
```

- [ ] **Step 2: Verify TypeScript across the workspace**

```bash
cd packages/core && npx tsc --noEmit
```
Expected: no errors. (Adding an optional field is backwards-compatible — no callers break.)

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/types/project.ts
git commit -m "feat(core): add MediaItem.remoteUrl for backend media URL"
```

---

## Task 7: BackendSaveService (web)

**Files:**
- Create: `apps/web/src/services/backend-save.ts`

- [ ] **Step 1: Create the service**

```typescript
// apps/web/src/services/backend-save.ts
import type { Project, MediaItem } from "@openreel/core";

const BASE_URL: string =
  (import.meta.env["VITE_ORCHESTRATOR_URL"] as string | undefined) ?? "http://localhost:4041";

/** Strip non-serialisable fields before sending project to backend. */
function sanitize(project: Project): object {
  return {
    ...project,
    mediaLibrary: {
      ...project.mediaLibrary,
      items: project.mediaLibrary.items.map((item: MediaItem) => ({
        ...item,
        blob: undefined,
        fileHandle: undefined,
        remoteUrl: undefined,      // never echo back
        waveformData: undefined,   // Float32Array — not JSON-safe
        filmstripThumbnails: undefined,
      })),
    },
    // Engine-side clips are ephemeral — not persisted
    textClips: undefined,
    shapeClips: undefined,
    svgClips: undefined,
    stickerClips: undefined,
  };
}

/** Extension from file's MIME type or original filename. */
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
  /** Track which mediaIds have been successfully uploaded this session. */
  private uploadedIds = new Set<string>();

  resetForProject(): void {
    this.uploadedIds.clear();
  }

  /** Check if orchestrator is reachable. */
  async isReachable(): Promise<boolean> {
    try {
      const res = await fetch(`${BASE_URL}/api/health`, { method: "HEAD" });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * PUT project JSON to backend. Blobs, fileHandles, and engine-only fields
   * are stripped before sending.
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
   * Upload a media blob for a specific version. Idempotent — already-uploaded
   * mediaIds are skipped. Fire-and-forget: errors are logged, never thrown.
   */
  uploadMediaAsync(projectId: string, mediaId: string, blob: Blob, filename: string): void {
    if (this.uploadedIds.has(mediaId)) return;
    this.uploadedIds.add(mediaId); // optimistic mark

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
        this.uploadedIds.delete(mediaId); // allow retry
        console.error(`[BackendSave] media upload failed (${mediaId}):`, err);
      });
  }

  /**
   * Load project from backend. Returns null if backend is unreachable or
   * project not found. Media items get remoteUrl populated.
   */
  async load(projectId: string): Promise<Project | null> {
    try {
      const res = await fetch(`${BASE_URL}/api/projects/${projectId}`);
      if (!res.ok) return null;
      const { project, mediaFiles } = (await res.json()) as BackendProjectResponse;

      // Populate remoteUrl on each media item
      const items = project.mediaLibrary.items.map((item) => {
        const filename = mediaFiles[item.id];
        if (!filename) return item;
        return {
          ...item,
          remoteUrl: `${BASE_URL}/api/projects/${projectId}/media/${filename}`,
        };
      });

      return {
        ...project,
        mediaLibrary: { ...project.mediaLibrary, items },
      };
    } catch {
      return null;
    }
  }
}

export const backendSaveService = new BackendSaveService();
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd apps/web && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/services/backend-save.ts
git commit -m "feat(web): BackendSaveService — save, uploadMedia, load"
```

---

## Task 8: Wire backend save into project store

**Files:**
- Modify: `apps/web/src/stores/project-store.ts`

- [ ] **Step 1: Import backendSaveService**

At the top of `project-store.ts`, alongside the other service imports, add:
```typescript
import { backendSaveService } from "../services/backend-save";
```

- [ ] **Step 2: Reset uploaded-media tracking on new/loaded project**

In `createNewProject` action, after `set({...})`:
```typescript
backendSaveService.resetForProject();
```

In `loadProject` action, after `set({...})`:
```typescript
backendSaveService.resetForProject();
```

- [ ] **Step 3: Fire backend save after each IDB auto-save**

In `initializeAutoSave`, after the `useProjectStore.subscribe(...)` call, add a listener on the autoSaveManager `saved` event:

```typescript
autoSaveManager.on("saved", () => {
  if (!get().explicitlyCreated) return;
  const fullProject = getFullProject(); // same fn used in autoSaveManager.start()
  backendSaveService.save(fullProject).catch((err) =>
    console.warn("[BackendSave] auto-save push failed:", err),
  );
});
```

> **Note:** `getFullProject` is the inline lambda already defined in `initializeAutoSave`. Extract it to a local const so it can be reused:
> ```typescript
> const getFullProject = () => {
>   const { project } = get();
>   const titleEngine = useEngineStore.getState().getTitleEngine();
>   const graphicsEngine = useEngineStore.getState().getGraphicsEngine();
>   return {
>     ...project,
>     textClips: titleEngine?.getAllTextClips() || [],
>     shapeClips: graphicsEngine?.getAllShapeClips() || [],
>     svgClips: graphicsEngine?.getAllSVGClips() || [],
>     stickerClips: graphicsEngine?.getAllStickerClips() || [],
>   };
> };
> autoSaveManager.start(getFullProject);
> // ... subscribe ...
> autoSaveManager.on("saved", () => {
>   if (!get().explicitlyCreated) return;
>   backendSaveService.save(getFullProject()).catch((err) =>
>     console.warn("[BackendSave] auto-save push failed:", err),
>   );
> });
> ```

- [ ] **Step 4: Upload media on import**

In `importMedia`, after the successful blob save (`await saveMediaBlob(...)`), add:
```typescript
backendSaveService.uploadMediaAsync(
  get().project.id,
  newMediaItem.id,
  params.file as Blob,
  params.file.name,
);
```

> Find the exact location by searching for `saveMediaBlob` in `importMedia` — it's called once when the media item is created.

- [ ] **Step 5: Upload generated media**

In `addGeneratedMedia`, after the successful `saveMediaBlob(item.id, blob)` call, add:
```typescript
backendSaveService.uploadMediaAsync(
  get().project.id,
  item.id,
  blob,
  item.name,
);
```

- [ ] **Step 6: Upload on placeholder replacement**

In `replacePlaceholderMedia`, after `saveMediaBlob`, add:
```typescript
backendSaveService.uploadMediaAsync(
  get().project.id,
  mediaId,
  blob,
  name,
);
```

- [ ] **Step 7: Verify TypeScript**

```bash
cd apps/web && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/stores/project-store.ts
git commit -m "feat(web): push auto-saves and media uploads to backend"
```

---

## Task 9: Backend-first restore in useProjectRecovery

**Files:**
- Modify: `apps/web/src/hooks/useProjectRecovery.ts`

- [ ] **Step 1: Import what's needed**

At the top of `useProjectRecovery.ts`, add:
```typescript
import { backendSaveService } from "../services/backend-save";
```

Also get `loadProject` from the store:
```typescript
const recoverFromAutoSave = useProjectStore((s) => s.recoverFromAutoSave);
const loadProject = useProjectStore((s) => s.loadProject);
```

- [ ] **Step 2: Replace the auto-restore branch**

In `checkForRecovery`, replace the existing `autoRestoreProjectId` branch:

```typescript
if (autoRestoreProjectId) {
  // Try backend first — it is the primary store
  const backendProject = await backendSaveService.load(autoRestoreProjectId);
  if (backendProject) {
    // Populate blobs from IDB for any media that has remoteUrl
    const { loadProjectMedia } = await import("../services/media-storage");
    const { restoreMediaItem } = await import("../utils/media-recovery");
    const stored = await loadProjectMedia(backendProject.id);
    const blobMap = new Map(stored.map((m) => [m.id, m.blob]));

    const restoredItems = await Promise.all(
      backendProject.mediaLibrary.items.map((item) =>
        restoreMediaItem({ ...item, blob: null }, blobMap.get(item.id)),
      ),
    );

    const fullyRestored = {
      ...backendProject,
      mediaLibrary: { ...backendProject.mediaLibrary, items: restoredItems },
    };

    loadProject(fullyRestored);
    setState({ isChecking: false, availableSaves: [], showDialog: false, error: null });
    return;
  }

  // Backend unreachable or no save — fall back to IDB
  const projectSaves = saves
    .filter((s) => s.projectId === autoRestoreProjectId)
    .sort((a, b) => b.timestamp - a.timestamp);
  if (projectSaves.length > 0) {
    await recoverFromAutoSave(projectSaves[0].id);
  }
  setState({ isChecking: false, availableSaves: [], showDialog: false, error: null });
  return;
}
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd apps/web && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Run existing recovery tests**

```bash
cd apps/web && npx vitest run src/hooks/useProjectRecovery.test.ts
```
Expected: all pass (mock covers backendSaveService).

> If tests fail with "backendSaveService not mocked", add to the mock at the top of the test file:
> ```typescript
> vi.mock("../services/backend-save", () => ({
>   backendSaveService: {
>     load: vi.fn().mockResolvedValue(null),
>     uploadMediaAsync: vi.fn(),
>     resetForProject: vi.fn(),
>     save: vi.fn().mockResolvedValue(undefined),
>     isReachable: vi.fn().mockResolvedValue(true),
>   },
> }));
> ```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/hooks/useProjectRecovery.ts
git commit -m "feat(web): restore from backend first, IDB as fallback"
```

---

## Task 10: Smoke test end-to-end

- [ ] **Step 1: Confirm git-lfs is installed on the machine**

```bash
git lfs version
```
Expected: `git-lfs/X.Y.Z ...`

If not installed: `brew install git-lfs && git lfs install`

- [ ] **Step 2: Start the orchestrator**

```bash
cd apps/orchestrator && pnpm dev
```
Expected: `Orchestrator running on port 4041`

- [ ] **Step 3: Start the web app**

```bash
cd apps/web && pnpm dev
```

- [ ] **Step 4: Create a project, name it, import a media file**

In the browser:
1. Create new project → give it a name
2. Import a video or image file
3. Wait ~30 seconds (one auto-save cycle)

- [ ] **Step 5: Verify backend files**

```bash
ls music-video-studio/projects/
# expect: one directory named <project-uuid>/

ls music-video-studio/projects/<id>/
# expect: project.json  .gitattributes  .git/  media/

ls music-video-studio/projects/<id>/media/
# expect: <mediaId>.<ext> file

cat music-video-studio/projects/<id>/project.json | python3 -m json.tool | grep name
# expect: your project name

cd music-video-studio/projects/<id> && git log --oneline
# expect: 2–3 commits (init + save + media)

git lfs ls-files
# expect: media/<mediaId>.<ext> listed
```

- [ ] **Step 6: Test reload restore**

1. Reload the browser
2. Expected: project restores automatically (no dialog), same name and media visible

- [ ] **Step 7: Test version switching**

1. Generate a second version of an asset (via AI generation or re-import)
2. In the media panel, switch the active version to v1
3. Wait for auto-save
4. Check git log: `git log --oneline` — expect a commit with "switch active version"
5. project.json should have `isCurrent: true` on the v1 item and `false` on v2
6. Both files should still exist in `media/`

---

## Self-review checklist

- [x] **No migration** — per-project dirs from scratch, no flat-file handling
- [x] **All version files immutable** — `media/<mediaId><ext>` is written once, never overwritten
- [x] **Active version in project.json** — `isCurrent` flag on MediaItem; project.json is the source of truth for which version is active, not git HEAD
- [x] **git-lfs** — ensured on first commit per repo; `.gitattributes` tracks `media/**`
- [x] **Fire-and-forget git** — `commitAsync` never blocks HTTP response
- [x] **Backend first on reload** — IDB is fallback, not primary
- [x] **Media upload deduplicated** — `uploadedIds` Set prevents re-uploading same version
- [x] **Sanitization** — blob, fileHandle, waveformData, filmstripThumbnails all stripped before PUT
- [x] **remoteUrl populated on load** — engine can use it when IDB blob is absent
- [x] **Configurable interval** — `AUTOSAVE_INTERVAL_MS` env var on orchestrator; web reads existing auto-save interval
