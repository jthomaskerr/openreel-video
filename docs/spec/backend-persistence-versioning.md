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

### 14.2.4 Confirmed Commits

Persistence API responses SHALL wait for the corresponding Git commit. A successful
`PUT /api/projects/:id` response means both `project.json` and the Git history contain
the submitted state. Commit failures SHALL return HTTP 500 with a detailed `detail`
field and MUST propagate to the web client. The "nothing to commit" case remains a
successful idempotent persistence result.

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
3. Await a git commit for the new media file.
4. Return `{ filename: "<mediaId><ext>" }`.

### 14.3.3 Upload Deduplication

The `BackendSaveService` on the web side SHALL maintain a per-session `uploadedIds: Set<string>`. Before uploading a media blob, the service SHALL check whether the `mediaId` is already in this set:

- If present, the upload SHALL be skipped (idempotent).
- If a media item has a `remoteUrl` under the current backend project media route,
  the client SHALL issue `HEAD` for that exact URL. Only HTTP 200 proves the immutable
  media ID is current and permits skipping upload. Missing, malformed, or unreachable
  URLs SHALL fall back to uploading the Blob before PUT.
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

### 14.5.4 Media Completeness Handshake

Project JSON and the project `media/` directory SHALL be treated as one
persistence unit. A backend save MUST NOT report success or commit a project
snapshot that references required media binaries which are absent from the
project's `media/` directory.

Before writing or committing `project.json`, `PUT /api/projects/:id` SHALL compare
every file-backed `MediaItem` in the incoming media library with the authoritative
result of `scanMedia(projectId)`. This audit is by media ID, not filename. Image,
video, audio, and subtitle items require a stored binary unless a future typed
media-storage contract explicitly marks the item as external or virtual. A
thumbnail, `sourceFile` hint, stale `blob:` URL, or frontend-only `remoteUrl` is
not proof that the original binary is stored.

If any required media item is missing, the backend SHALL leave the existing
`project.json` and Git history unchanged and return HTTP `409`:

```json
{
  "saved": false,
  "code": "MEDIA_INCOMPLETE",
  "projectId": "vintage-tokyo",
  "missingItems": [
    {
      "mediaId": "1358784e-5cd4-434a-9690-62584bb3c650",
      "name": "nf9.jpeg",
      "type": "image",
      "reason": "file-not-found",
      "sourceFile": { "name": "nf9.jpeg", "size": 162717, "lastModified": 1782516508000 }
    }
  ]
}
```

The response SHALL include all missing items in deterministic media-library order.
It MUST NOT include absolute server paths or claim that a thumbnail is the original
file. Unexpected audit failures return HTTP `500`; an empty or malformed media ID
remains a request-validation error.

The frontend save sequence SHALL be:

1. Upload every new local media Blob and await every upload result.
2. PUT the sanitized project JSON.
3. If the backend returns `MEDIA_INCOMPLETE`, match each missing ID to the live
   media library and attempt to obtain its original bytes from, in order: a valid
   in-memory Blob, a readable `FileSystemFileHandle`, or another already-supported
   durable source that yields the original binary rather than a thumbnail.
4. Upload every recoverable missing item, await completion, then retry the PUT once.
5. If any item cannot be supplied, any upload fails, or the retry still reports
   missing media, stop. Do not loop, do not display `Persisted`, and do not discard
   the user's local project state.

Automatic recovery SHALL be silent only when the retry succeeds. Otherwise the
header persistence state becomes failed, the Problems/Log surfaces receive a
structured entry, and a finite-lived summary toast states the missing-item count.
Each affected media-browser item and every timeline clip that references it SHALL
show a persistent error marker until a later confirmed save proves that the binary
exists. The marker's accessible label and tooltip SHALL name the problem, for
example `Original media missing from saved project: nf9.jpeg`.

Selecting an affected item SHALL show actionable instructions:

- **Relink original file**: open a file picker, verify the selected file against
  available `sourceFile` name/size/last-modified hints, replace or rehydrate the
  item's Blob, upload it, and retry save.
- **Locate containing folder**: where the File System Access API is available,
  let the user choose a folder and search for matching `sourceFile` hints.
- **Remove missing item**: only after explicit confirmation, remove the media item
  and all dependent clips/references, then save the intentionally changed project.
- For generated or externally sourced media, instruct the user to download or
  regenerate the original asset and then relink it. A thumbnail is insufficient.

The UI MUST state that local edits remain available but the backend save is
incomplete. It MUST NOT recommend refreshing, clearing storage, or dismissing the
warning as a repair. Error markers clear only after a successful persistence receipt
for a snapshot in which the backend audit finds the item present, or after the user
explicitly removes the item and its references.

`GET /api/projects/:id` SHALL also return a read-only `missingItems` audit alongside
`project` and `mediaFiles`. This exposes legacy incomplete projects immediately on
load. Loading remains allowed so the user can relink or remove affected items, but
the returned missing IDs SHALL populate the same item and clip error markers. A
subsequent save still uses the authoritative PUT audit; the GET audit is not a
substitute for save-time validation.

### 14.5.5 Persistence Receipt and UI Status

`PUT /api/projects/:id` SHALL return only after Git commit completion:

```json
{ "saved": true, "projectId": "vintage-tokyo", "persistedAt": 1783890000000, "sourceModifiedAt": 1783889999000 }
```

The editor header SHALL show separate local and backend states:

- `Auto saved: <time>` means the local editor/IndexedDB stage completed.
- A larger success dot and `Persisted <human duration> ago` means the backend receipt
  confirmed a Git commit for the current project.
- Dots SHALL pulse only while their stage is operating and respect reduced-motion.
- Queued, persisting, failed, and not-yet-persisted states SHALL never be presented as
  successful persistence.
- The persistence dot SHALL be green only when the receipt project ID matches the
  current project and `sourceModifiedAt` exactly matches the current frontend
  `project.modifiedAt`. All other states are neutral, amber, or red.
- A recovered project with a client UUID SHALL NOT enter the persistence queue.
  The client first lists backend projects and reconciles only a unique exact-name
  match to its slug, migrates the local autosave identity, and then saves. Zero or
  multiple matches are a visible identity-reconciliation failure; the client MUST
  NOT invent a slug or overwrite an arbitrary project.

### 14.5.6 Failure Feedback, Timeout, and Logging

- Every backend persistence failure SHALL set the header state to failed and produce a
  detailed error toast containing the HTTP or Git failure detail and retry behavior.
- Toasts SHALL expire using `toastDurationMs` from the persisted `openreel-settings`
  store. The supported UI choices are 3, 5, 6, 10, and 15 seconds; programmatic values
  are clamped to 1–30 seconds.
- Frontend logs SHALL cover queueing, save start, media completion, PUT response,
  confirmed Git persistence, retry, and failure. Operational messages use
  `console.debug`/`console.info`; failures use `console.error` and the runtime error bus.
- Backend logs SHALL cover request validation, atomic project write, commit start,
  commit success, and failure with project ID and relevant timestamps/counts.
- Media completeness logs SHALL include project ID, missing media IDs/count, the
  upload-and-retry attempt number, and the final outcome. They MUST NOT include
  binary contents, data URLs, file handles, or absolute user filesystem paths.
- Persistence errors MUST NOT be swallowed. Expected reachability probes and
  idempotent skips MAY return a fallback value only after emitting a diagnostic log.
- Console-to-problem capture SHALL capture `console.error` only. Debug and info
  persistence telemetry MUST NOT create problem toasts.
- Backend save debounce SHALL have a five-second maximum queue age. Continuous
  project mutations MUST NOT postpone the PUT indefinitely; the latest snapshot at
  the deadline is persisted, and later changes schedule the next serialized save.
- A queued operation that has not begun a PUT within seven seconds SHALL transition
  to failed and emit a detailed error toast. A started PUT has a twenty-second request
  deadline and SHALL likewise fail visibly rather than remain in an operating state.
- The header SHALL independently watchdog operating-state timestamps. A queued or
  saving state that survives HMR without its owning operation is immediately failed
  with a detailed toast.

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
| `GET` | `/api/projects/:id` | Load project + `mediaFiles` map + missing-item audit |
| `POST` | `/api/projects` | Create project (`{ name, settings? }`) |
| `PUT` | `/api/projects/:id` | Audit media completeness, then upsert `project.json` + Git commit; return `409 MEDIA_INCOMPLETE` without mutation when required binaries are absent |
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

### 14.9.1 Semantic commit boundary and complete messages

- A `PUT` whose only difference from the backend working copy is `modifiedAt` MUST write the new `project.json` but MUST NOT create a Git commit. The timestamp-only change remains uncommitted in the project worktree until a later semantic change arrives.
- Timestamp-only receipts MUST report `saved: true` and `committed: false`, and MUST NOT include `persistedAt`. They acknowledge a backend write, not Git persistence.
- The next semantic save MUST commit the pending `modifiedAt` together with the actual change.
- Every semantic commit message MUST have a succinct first line describing the substance, followed by a body listing every semantic change across every changed file.
- If the backend LLM integration generates the message, its prompt MUST state that `ALL semantic changes across ALL <n> changed files` must be captured. A deterministic complete fallback remains mandatory.

## 14.10 Open Questions

- **Orchestrator authentication:** Is there any authentication or authorization on project routes, or is the orchestrator assumed to be localhost-only?
- **Concurrent access:** What happens when the same project is opened in two browser tabs? Is there a locking mechanism?
- **Project archival:** Should there be an "archive" state distinct from deletion that preserves the git history but hides the project from the picker?
- **Duplicate project:** What exactly does "Duplicate project" do? Deep-copy the directory with a new UUID? Copy media files or hard-link them?
- **Export format:** What format should project export produce? A tarball of the project directory? A portable bundle?
- **Git garbage collection:** Should the orchestrator ever run `git gc` on project repositories? Under what conditions?
- **Media file cleanup on version delete:** If a user explicitly deletes a specific version of an asset, should the corresponding media file be removed, or should all files remain forever?
- **Large media upload resilience:** Should media uploads support resumable/chunked upload for very large files?

## 15. Runtime media availability and authoritative absence

This section is a normative amendment derived from `regressions/backend-outage-false-missing-media-regression.md` and controls wherever older text equates an absent browser `Blob`, failed hydration, or failed request with missing durable media.

- Snapshot completeness and runtime availability are separate facts. Completeness is established by the committed manifest/object audit. Availability describes the current session's ability to verify, fetch, and decode those bytes.
- The runtime states are `available`, `verifying`, `temporarily_unavailable`, `confirmed_missing`, `decode_error`, and `unauthorized`. They MUST NOT be serialized into semantic project JSON or alter durable media identity/provenance.
- Backend-identified media with no current Blob begins `verifying`. Timeout, refusal, DNS, CORS-like rejection, abort, offline/HMR interruption, and `5xx` produce `temporarily_unavailable`; `401`/`403` produce `unauthorized`; decode/corruption produces `decode_error`. None is missing.
- A batch verification endpoint SHALL scope requests by project and media ID, verify both mapping and object, and return version/ETag/size evidence when available. Only authoritative `404`/`410` for mapping/object, rechecked once when a manifest race is possible, may establish backend absence.
- If `HEAD` is unsupported, verification SHALL fall back to a small ranged `GET`. HTML error bodies with `200`, invalid MIME/range metadata, zero/truncated objects, stale cache evidence, and project-ID mismatches cannot establish availability.
- Verification is bounded, deduplicated per project/media ID, cancellable, retryable with exponential backoff and jitter, and guarded by active project plus request generation. Late responses MUST NOT mutate another project or overwrite a newer relink.
- Transient verification failure MUST NOT clear media identity, remove clips, trigger relink, increment confirmed-missing counts, or be autosaved as semantic missing state. Recovery SHALL atomically update every UI consumer and hydrate media/thumbnails without requiring reload.
- Save-time `MEDIA_INCOMPLETE` remains authoritative for the audited transaction. A client-side transport failure while asking for that audit is availability uncertainty, not evidence that the media is missing.
