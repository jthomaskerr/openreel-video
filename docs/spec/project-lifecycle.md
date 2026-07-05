# Project Lifecycle — Operational Spec

> **Derived from user directives.** Source: 99 user messages in the Project Management category.
> Reference plans: [Backend Autosave + Git LFS plan](../superpowers/plans/2026-07-01-backend-autosave-git-lfs.md).

---

## 9.1 Project Creation

### 9.1.1 No Automatic Creation

The system MUST NOT create projects automatically under any circumstance. Projects SHALL only come into existence via an explicit user action — the "New Project" action, the `/new` command, or the "Start from scratch" flow. Any code path that creates a project without user intent is a defect.

### 9.1.2 Name Prompt

Every project-creation path MUST prompt the user for a project name before the project is created. The prompt SHALL:

- Accept a non-empty, trimmed string.
- Reject blank or whitespace-only names.
- Default to a suggested name derived from context when available (e.g., the imported file or folder name), but the user MUST still confirm or edit it.

The following entry points SHALL all trigger the name-prompt flow:

- **New Project button** — a toolbar or menu action labeled "New Project".
- **`/new` command** — a keyboard-driven command palette entry.
- **Start from scratch** — a landing-page or welcome-screen action.

### 9.1.3 Import-Driven Naming

When a project is created via an import action (e.g., "Import folder as project", "Import media file"), the project name SHALL default to the importer's best available name — the folder name, the file basename, or metadata extracted from the imported asset. The user MAY override this default in the name prompt.

### 9.1.4 Backend Project Record

On creation, the orchestrator SHALL:

1. Accept a `POST /api/projects` with `{ name, settings? }`.
2. Validate that `name` is a non-empty trimmed string; return `400` otherwise.
3. Generate a UUID project ID.
4. Create the per-project directory at `<projectsDir>/<projectId>/`.
5. Write `project.json` with default settings, an empty media library, and an empty timeline.
6. Initialize a git repository in the project directory with git-lfs enabled and a `.gitattributes` tracking `media/**`.
7. Return the full `Project` object with status `201`.

---

## 9.2 Project Deletion

### 9.2.1 Full Directory Removal

Deleting a project MUST remove the entire project directory and all its contents, including:

- `project.json`
- The `media/` directory and all media files within it
- The `.git/` directory (the entire git history)
- `.gitattributes` and any other project-scoped files

The orchestrator SHALL implement this as a recursive directory removal, not merely unlinking `project.json`. The `DELETE /api/projects/:id` endpoint SHALL return `200` on success and `404` if the project does not exist.

### 9.2.2 Confirmation

The UI SHOULD present a confirmation dialog before executing deletion, warning that the action is irreversible and that all media and version history will be lost.

---

## 9.3 Project Picker

### 9.3.1 Listing

The project picker SHALL list all projects known to the orchestrator, obtained via `GET /api/projects`. Each entry SHALL display at minimum:

- Project name
- Last modified timestamp (relative or absolute)
- Project ID (for debugging; MAY be hidden by default)

Projects SHALL be sorted by `modifiedAt` descending (most recently modified first).

### 9.3.2 Multi-Select

The picker MUST support multi-select: the user SHALL be able to select zero or more projects via checkboxes or a click-with-modifier pattern (Shift-click for range, Ctrl/Cmd-click for toggle).

### 9.3.3 Bulk Actions

When one or more projects are selected, the picker SHALL expose bulk actions. At minimum:

- **Delete selected** — delete all selected projects (with a single confirmation dialog listing the project names).
- **Export selected** — TODO: define export format and behavior.

Bulk actions SHALL operate on all selected projects atomically where possible; partial failures SHALL be reported per-project.

### 9.3.4 Per-Project Toolbar

Each project row SHALL have a per-project action toolbar with at minimum:

- **Open** — load the project into the editor.
- **Rename** — inline or dialog-based rename.
- **Delete** — delete this single project (with confirmation).
- **Duplicate** — TODO: define duplicate behavior (deep copy of directory + new UUID).

---

## 9.4 Backend Persistence & Versioning

### 9.4.1 Per-Project Git Repository

Each project directory SHALL be an independent git repository. The orchestrator's `GitStore` SHALL:

- Initialize the repo on first write (`git init`, `git lfs install --local`).
- Write `.gitattributes` tracking `media/**` with `filter=lfs diff=lfs merge=lfs -text`.
- Commit after every project save and media upload.
- Use fire-and-forget commits — the HTTP response MUST NOT block on git operations.

### 9.4.2 Git-LFS for Media

All media files in `media/` SHALL be tracked by git-lfs. The `.gitattributes` file SHALL be committed as part of repo initialization. Media files are stored immutably — once written, a media file is never overwritten. Version switching is accomplished by flipping `isCurrent` flags in `project.json`, not by replacing files.

### 9.4.3 Auto-Save Push

The web app's auto-save manager SHALL push project state to the orchestrator on each save cycle. However, this push SHALL be gated by an `explicitlyCreated` flag:

- `explicitlyCreated` SHALL be set to `true` only when the user completes the New Project name-prompt flow (or an equivalent explicit creation path).
- While `explicitlyCreated` is `false`, auto-save pushes to the backend MUST be suppressed.
- The flag SHALL be reset when a new project is created or an existing project is loaded.

This prevents the backend from receiving saves for projects that were not intentionally created by the user (e.g., default or transient project states).

### 9.4.4 Sanitization

Before sending project JSON to the backend, the web app SHALL strip non-serializable and ephemeral fields:

- `blob`, `fileHandle` — runtime-only references.
- `remoteUrl` — never echoed back to the backend.
- `waveformData` — `Float32Array`, not JSON-safe.
- `filmstripThumbnails` — runtime-only.
- Engine-side clip arrays (`textClips`, `shapeClips`, `svgClips`, `stickerClips`) — ephemeral.

---

## 9.5 Project Restore

### 9.5.1 Backend-First Strategy

On application load, when an `autoRestoreProjectId` is present, the restore flow SHALL:

1. **Attempt backend load first** — call `GET /api/projects/:id` on the orchestrator. This is the primary store.
2. If the backend returns a valid project, populate `remoteUrl` on each `MediaItem` from the `mediaFiles` map, then hydrate local blobs from IndexedDB for any media that has a matching ID.
3. **Fall back to IndexedDB** only if the backend is unreachable or the project is not found. Load the most recent IDB auto-save for that project ID.
4. If neither source has data, present the recovery dialog with available saves.

### 9.5.2 Media URL Resolution

When a project is loaded from the backend, each `MediaItem` SHALL have its `remoteUrl` populated as:

```
<BASE_URL>/api/projects/<projectId>/media/<storedFilename>
```

The engine MAY use `remoteUrl` as a fallback source when the local IDB blob is absent.

---

## 9.6 Open Questions

- **Duplicate behavior**: What exactly does "Duplicate project" do? Deep-copy the directory with a new UUID? Copy media files or hard-link them?
- **Export format**: What format should bulk export produce? A tarball of project directories? A portable project bundle?
- **Project picker search/filter**: Should the picker support text search, date-range filtering, or tag-based filtering?
- **Project archival**: Should there be an "archive" state distinct from deletion?
- **Multi-window / multi-tab**: What happens when the same project is opened in two browser tabs? Is there a locking mechanism?
- **Orchestrator auth**: Is there any authentication or authorization on project routes, or is the orchestrator assumed to be localhost-only?
