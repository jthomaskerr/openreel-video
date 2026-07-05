# Backend, Persistence & Versioning — Operational Spec

> **Derived from user directives.** Source: 51 user messages in the Backend / Persistence category.
> Reference plans: [Backend Autosave + Git LFS plan](../superpowers/plans/2026-07-01-backend-autosave-git-lfs.md).
> Related spec: [Project Lifecycle spec](./project-lifecycle.md) (§9.4–9.5).

---

## 14.1 Versioning Model

### 14.1.1 Immutable Project Versions

Every save of `project.json` to the backend SHALL produce a new git commit. Project versions are immutable — no commit is ever amended, rebased, or force-pushed. The git history of each per-project repository is the authoritative version log.

Both media AND metadata SHALL be versioned together in each commit:

- `project.json` captures the full project state at that point in time, including which media version is active (`isCurrent`).
- Media files in `media/` are written once and never overwritten. A new version of an asset produces a new file with a new UUID.

### 14.1.2 Asset Version Model: `assetGroupId` + `isCurrent`

Each `MediaItem` SHALL carry:

- `id: string` — a UUID unique to that specific version of the asset.
- `assetGroupId: string` — a UUID shared by all versions of "the same" logical asset. All versions of an asset (original import, AI-generated variants, re-imports) SHALL share the same `assetGroupId`.
- `isCurrent: boolean` — exactly one item per `assetGroupId` SHALL have `isCurrent: true` at any time. This flag is the source of truth for which version is active; it lives in `project.json`, not in git HEAD.

When the user switches the active version of an asset:

1. The `isCurrent` flag on the previously active item SHALL be set to `false`.
2. The `isCurrent` flag on the newly selected item SHALL be set to `true`.
3. Only `project.json` changes — no media files are moved, renamed, or deleted.
4. The change SHALL be committed with a message indicating the version switch (e.g., "switch active version (1 asset(s))").

### 14.1.3 Version List and Revert

The system SHALL expose a version list for each asset that includes:

- All versions of the asset (all `MediaItem` entries sharing the same `assetGroupId`).
- The current version clearly marked (`isCurrent: true`).
- A creation or import timestamp for each version.

The user SHALL be able to revert to any prior version by selecting it as the active version. Reverting MUST NOT delete or lose subsequent versions — all versions remain in `media/` and in the git history. Reverting is simply a flip of the `isCurrent` flag.

---

## 14.2 Per-Project Git Repository

### 14.2.1 Directory Layout

Each project SHALL live in `<projectsDir>/<projectId>/` as an independent git repository. The directory structure SHALL be:

```
<projectsDir>/
  <projectId>/
    .git/
    .gitattributes
    project.json
    media/
      <mediaId>.<ext>
      <mediaId>.<ext>
      ...
```

### 14.2.2 Repository Initialization

The orchestrator's `GitStore` SHALL initialize each project repository on first write:

1. `git init` in the project directory.
2. `git lfs install --local` to enable git-lfs for this repository.
3. Write `.gitattributes` with the content:

   ```
   media/** filter=lfs diff=lfs merge=lfs -text
   ```

4. `git add .gitattributes` and `git commit -m "init: create project repository with git-lfs"`.

Initialization SHALL be idempotent — calling `ensureRepo` on an already-initialized directory is a no-op.

### 14.2.3 Git-LFS for Media

All files under `media/` SHALL be tracked by git-lfs via the `.gitattributes` rule. This ensures:

- Large binary files (video, audio, images) are stored efficiently.
- git-lfs deduplicates identical content automatically — if two versions of an asset happen to produce the same binary, only one copy is stored.
- The git repository itself remains lightweight, containing only `project.json` and metadata.

### 14.2.4 Fire-and-Forget Commits

Git commits SHALL be fire-and-forget: the `commitAsync` method SHALL never block the HTTP response. Commit failures SHALL be logged to stderr but MUST NOT propagate to the API caller. The "nothing to commit" case (no changes staged) SHALL be silently ignored, not treated as an error.

---

## 14.3 Media Storage

### 14.3.1 Immutable Media Files

Media files in `media/` SHALL be stored immutably:

- Each file is named `<mediaId>.<ext>` where `mediaId` is the `MediaItem.id` UUID and `ext` is the original file extension.
- Once written, a media file MUST NOT be overwritten, renamed, or deleted.
- Version switching is accomplished solely by flipping `isCurrent` flags in `project.json`.

### 14.3.2 Media Upload

The web app SHALL upload media blobs to the orchestrator via `POST /api/projects/:id/media/:mediaId` as `multipart/form-data`. The orchestrator SHALL:

1. Accept the file via multer with disk storage.
2. Write the file to `<projectDir>/media/<mediaId><ext>`.
3. Fire a git commit for the new media file.
4. Return `{ filename: "<mediaId><ext>" }`.

### 14.3.3 Upload Deduplication

The `BackendSaveService` on the web side SHALL maintain a per-session `uploadedIds: Set<string>`. Before uploading a media blob, the service SHALL check whether the `mediaId` is already in this set:

- If present, the upload SHALL be skipped (idempotent).
- If absent, the `mediaId` SHALL be optimistically added to the set before the upload fires.
- On upload failure, the `mediaId` SHALL be removed from the set to allow retry.

The set SHALL be cleared via `resetForProject()` when a new project is created or an existing project is loaded.

### 14.3.4 Media Serving

The orchestrator SHALL serve media files via `GET /api/projects/:id/media/:filename`. The response SHALL be the raw binary with appropriate `Content-Type` derived from the file extension. A `404` SHALL be returned if the file does not exist.

### 14.3.5 `remoteUrl` on MediaItem

The `MediaItem` type SHALL include an optional `remoteUrl?: string` field. This field:

- SHALL be populated by `BackendSaveService.load()` when a project is loaded from the backend, set to `<BASE_URL>/api/projects/<projectId>/media/<storedFilename>`.
- SHALL be stripped during sanitization before `PUT` (never echoed back to the backend).
- MAY be used by the engine as a fallback media source when the local IndexedDB blob is absent.

---

## 14.4 Project JSON and File Paths

### 14.4.1 Relative File Paths

All file paths stored in `project.json` SHALL be relative to the project file's parent directory (`<projectDir>/`). The system MUST NOT store absolute paths. When resolving a path from `project.json`, the resolver SHALL join it with the project directory.

### 14.4.2 Importing a Project JSON File

When the user imports a project via a JSON file, the system MUST import all referenced files, not just the JSON. This includes:

- All media files referenced by `MediaItem` entries.
- Any auxiliary files referenced in the project structure.

The import flow SHALL:

1. Parse the JSON to identify all referenced file paths.
2. Resolve each path relative to the imported JSON file's location.
3. Copy or ingest each referenced file into the project's `media/` directory.
4. Rewrite paths in the imported project to use the new media IDs.

---

## 14.5 Auto-Save and Backend Push

### 14.5.1 Auto-Save Cycle

The web app's auto-save manager SHALL push project state to the orchestrator on each save cycle via `PUT /api/projects/:id`. The push SHALL be gated:

- `explicitlyCreated` MUST be `true` before any backend push occurs. This flag is set only when the user completes an explicit project creation flow.
- While `explicitlyCreated` is `false`, auto-save pushes to the backend SHALL be suppressed.

### 14.5.2 Configurable Auto-Save Interval

The auto-save interval SHALL be configurable via the `AUTOSAVE_INTERVAL_MS` environment variable on the orchestrator. The web app SHALL read this value from `GET /api/projects/config`, which returns:

```json
{ "autosaveIntervalMs": 60000 }
```

The default value SHALL be `60000` (60 seconds) when the environment variable is not set. The web app SHALL use this value to configure its auto-save timer.

### 14.5.3 Sanitization Before PUT

Before sending project JSON to the backend via `PUT`, the web app SHALL strip the following fields from every `MediaItem`:

| Field | Reason |
|---|---|
| `blob` | Runtime-only `Blob` reference; not serializable. |
| `fileHandle` | `FileSystemFileHandle`; runtime-only. |
| `remoteUrl` | Backend-populated; must not be echoed back. |
| `waveformData` | `Float32Array`; not JSON-safe. |
| `filmstripThumbnails` | Runtime-only; regenerated on load. |

Additionally, engine-side ephemeral clip arrays SHALL be stripped from the top-level project object:

- `textClips`
- `shapeClips`
- `svgClips`
- `stickerClips`

The sanitization function SHALL produce a plain object suitable for `JSON.stringify`, with no circular references or non-serializable types.

---

## 14.6 Project Restore

### 14.6.1 Backend-First Strategy

On application load, when an `autoRestoreProjectId` is present, the restore flow SHALL follow this priority:

1. **Backend (primary):** Call `GET /api/projects/:id` on the orchestrator. If the backend returns a valid project:
   - Populate `remoteUrl` on each `MediaItem` from the `mediaFiles` map.
   - Hydrate local blobs from IndexedDB for any media that has a matching ID (so the engine has immediate local access).
   - Load the fully restored project into the editor.
2. **IndexedDB (fallback):** If the backend is unreachable or the project is not found, load the most recent IDB auto-save for that project ID.
3. **Recovery dialog:** If neither source has data, present the recovery dialog with available saves.

This strategy replaces the previous IDB-only auto-restore. The backend is the authoritative store; IndexedDB is a local cache and fallback.

### 14.6.2 Media Blob Hydration

When restoring from the backend, media items SHALL have their blobs hydrated from IndexedDB where available. The `remoteUrl` field provides a fallback URL for the engine to fetch media on demand if the local blob is absent.

---

## 14.7 Project Deletion

### 14.7.1 Full Directory Removal

Deleting a project MUST remove the entire project directory, not just `project.json`. This includes:

- `project.json`
- The `media/` directory and all media files
- The `.git/` directory (entire git history)
- `.gitattributes` and any other project-scoped files

The orchestrator's `DELETE /api/projects/:id` endpoint SHALL perform a recursive directory removal. The endpoint SHALL return `200` on success and `404` if the project does not exist.

> **Note:** The plan's `ProjectStore.deleteProject` initially only unlinked `project.json`. The operational requirement overrides this: the full directory MUST be removed. The implementation SHALL use `fs.rm(dir, { recursive: true })` or equivalent.

---

## 14.8 API Contract Summary

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/projects/config` | Return `{ autosaveIntervalMs }` |
| `GET` | `/api/projects` | List all projects (summaries) |
| `GET` | `/api/projects/:id` | Load project + `mediaFiles` map |
| `POST` | `/api/projects` | Create project (`{ name, settings? }`) |
| `PUT` | `/api/projects/:id` | Upsert `project.json` + git commit |
| `PATCH` | `/api/projects/:id` | Rename project (`{ name }`) |
| `DELETE` | `/api/projects/:id` | Remove entire project directory |
| `POST` | `/api/projects/:id/media/:mediaId` | Upload media file (multipart) |
| `GET` | `/api/projects/:id/media/:filename` | Serve media file |

---

## 14.9 Commit Message Conventions

Git commit messages SHALL follow a consistent format for human readability of the version history:

| Trigger | Message Pattern |
|---|---|
| Initial repo creation | `init: create project repository with git-lfs` |
| Project creation | `init: create project "<name>"` |
| First save | `save: initial save of "<name>"` |
| Rename | `rename → "<newName>"` |
| Clip changes | `+N clip(s)` / `-N clip(s)` |
| Media changes | `+N media item(s)` |
| Version switch | `switch active version (N asset(s))` |
| Media upload | `media: add <originalFilename> (<mediaId>)` |
| No detected changes | `auto-save` |

Multiple changes in a single commit SHALL be joined with `, ` (e.g., `rename → "v2", +3 clip(s), +1 media item(s)`).

---

## 14.10 Open Questions

- **Orchestrator authentication:** Is there any authentication or authorization on project routes, or is the orchestrator assumed to be localhost-only?
- **Concurrent access:** What happens when the same project is opened in two browser tabs? Is there a locking mechanism?
- **Project archival:** Should there be an "archive" state distinct from deletion that preserves the git history but hides the project from the picker?
- **Duplicate project:** What exactly does "Duplicate project" do? Deep-copy the directory with a new UUID? Copy media files or hard-link them?
- **Export format:** What format should project export produce? A tarball of the project directory? A portable bundle?
- **Git garbage collection:** Should the orchestrator ever run `git gc` on project repositories? Under what conditions?
- **Media file cleanup on version delete:** If a user explicitly deletes a specific version of an asset, should the corresponding media file be removed, or should all files remain forever?
- **Large media upload resilience:** Should media uploads support resumable/chunked upload for very large files?
