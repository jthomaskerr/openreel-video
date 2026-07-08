# Backend Auto-Save with Git LFS Implementation Plan

> Status: backend autosave/git-lfs gap pass implemented and verified on 2026-07-08. The implementation intentionally goes beyond the original flat per-project-repo plan by using a shared git repository with project worktrees/branches.

## Goal

Every explicitly-created project is saved to the backend filesystem and versioned with git/git-lfs. Project JSON is the source of truth for structure and active media versions; media binaries are immutable files stored under each project worktree's `media/` directory.

## Current architecture

- Project storage root: `MV_PROJECTS_REPO`, defaulting to `~/openreel-projects`.
- Storage model: one shared git repository at `projectsRepo`.
- Project model: each project has a git worktree at `<projectsRepo>/<projectSlug>/` on branch `project/<projectSlug>`.
- Project identity: backend-created projects use slug IDs derived from project names. Current web-created projects still use client UUIDs and are persisted by backend `PUT` upsert; switching the synchronous web creation flow to backend `POST` remains a follow-up.
- Project file: `<projectsRepo>/<projectSlug>/project.json`.
- Media files: `<projectsRepo>/<projectSlug>/media/<mediaId><ext>`.
- Git LFS: shared `.gitattributes` tracks `media/**`.
- Git commits: orchestrator commits asynchronously after project/media writes; git ops are serialized per project to avoid index lock races.
- Restore model: backend-only. There is no IndexedDB fallback. If the backend/orchestrator cannot serve a project, the web app surfaces an error.

## Version tracking model

Each `MediaItem.id` is unique to one media version. Versions of the same logical asset share `assetGroupId`. `isCurrent: true` marks the active version. Switching versions changes only `project.json`; media files remain immutable in `media/` and are never overwritten or deleted by version switching.

## Implemented file map

### Orchestrator

| File | Current role |
|---|---|
| `apps/orchestrator/src/projects/git-store.ts` | Shared repo/worktree manager, git-lfs setup, existing-dir worktree promotion, per-worktree LFS rule repair, async/awaitable commits, history lookup, remote config/push support |
| `apps/orchestrator/src/projects/project-store.ts` | Project CRUD backed by git worktrees, slug IDs, atomic `project.json` writes, media scanning, UUID-dir migration helper that promotes legacy dirs into worktrees |
| `apps/orchestrator/src/projects/routes.ts` | Project CRUD, media upload/serve, config/remote endpoints, history endpoints; validates project/media path params before storage access |
| `apps/orchestrator/src/projects/storage-validation.ts` | Shared project/media id and filename validation plus path containment helper |
| `apps/orchestrator/src/projects/storage-validation.test.ts` | Helper coverage for valid slug/UUID/media names and traversal/path separator rejection |
| `apps/orchestrator/src/projects/git-store-migration.test.ts` | Regression coverage for root/nested UUID migration into commit-capable worktrees and existing-worktree Git LFS rule repair |
| `apps/orchestrator/src/projects/index.ts` | Exports `ProjectStore`, `GitStore`, router |
| `apps/orchestrator/src/app.ts` | Wires `GitStore`, `ProjectStore`, project router, generated assets, health endpoint, 50mb JSON body limit |
| `apps/orchestrator/package.json` | Includes `multer` and `@types/multer` |

### Core

| File | Current role |
|---|---|
| `packages/core/src/types/project.ts` | `MediaItem.remoteUrl?: string` for backend-served media URLs |

### Web

| File | Current role |
|---|---|
| `apps/web/src/services/backend-save.ts` | Backend project save/load, media upload, project sanitization, remoteUrl population |
| `apps/web/src/stores/project-store.ts` | Pushes backend saves on autosave, uploads imported/generated/replaced media, resets backend upload tracking on project switch |
| `apps/web/src/hooks/useProjectRecovery.ts` | Backend-only auto-restore when `autoRestoreProjectId` is set; no IDB fallback |

## Orchestrator API

- `GET /api/health`
- `GET /api/projects/config` → `{ autosaveIntervalMs, remote }`
- `PUT /api/projects/config` → set remote URL and push branches
- `GET /api/projects` → list projects visible at `projectsRepo/*/project.json`
- `POST /api/projects` → create project worktree and initial project
- `GET /api/projects/:id` → load project and media filename map
- `PUT /api/projects/:id` → upsert `project.json` using the supplied client/backend ID and async commit
- `PATCH /api/projects/:id` → rename project/slug/worktree
- `DELETE /api/projects/:id` → remove worktree/project dir
- `POST /api/projects/:id/media/:mediaId` → upload media file to `media/<mediaId><ext>` and async commit
- `GET /api/projects/:id/media/:filename` → serve media file
- `GET /api/projects/:id/history` → list commits touching `project.json`
- `GET /api/projects/:id/history/:sha` → load historical `project.json`

## Backend-only restore contract

- Web calls `backendSaveService.load(projectId)`.
- Backend returns `{ project, mediaFiles }`.
- Web populates each media item's `remoteUrl` from `mediaFiles`.
- Web calls `loadProject(backendProject)` directly.
- Auto-restore does **not** call `loadProjectMedia`; backend-served `remoteUrl` values are the media hydration path.
- If backend load fails or returns non-OK, recovery does **not** consult IndexedDB; it shows a project-server error.

## Cleanup / migration notes

Current filesystem cleanup retained only the two non-trivial `Just down-1 (Mastered with Thunder at 100pct)` project copies:

- `~/openreel-projects/a74ae794-eb05-4989-9ac0-d166e1e38ae6`
- `~/openreel-projects/projects/a74ae794-eb05-4989-9ac0-d166e1e38ae6`

Other empty/test project dirs were moved to quarantine under `~/openreel-projects/.deleted-projects-*`.

Migration update: `migrateUuidDirs()` now scans both `projectsRepo/*` and legacy nested `projectsRepo/projects/*` UUID project directories, promotes migrated directories into real `project/<slug>` git worktrees without losing `project.json` or `media/`, writes the updated slug-id `project.json`, and commits the migration. `createApp()` starts the migration best-effort at orchestrator startup.

Git LFS repair update: `ensureWorktree()` and commits now repair the `media/** filter=lfs diff=lfs merge=lfs -text` rule inside existing project worktrees as well as the shared repo root, so pre-existing project branches receive the media tracking rule before the next project/media commit.

Path hardening update: orchestrator project/media route params and store/git path entrypoints now reject empty values, traversal (`..`), path separators, and percent-encoded separator variants before filesystem or git worktree path use. Served media filenames are resolved under the project `media/` directory before `sendFile`.

## Validation checklist

- [x] `git lfs version` succeeds.
- [x] `pnpm --filter @openreel/orchestrator typecheck` or orchestrator `tsc --noEmit` passes.
- [x] `pnpm --filter @openreel/orchestrator exec node --import tsx --test src/projects/storage-validation.test.ts` passes.
- [x] `pnpm --filter @openreel/orchestrator exec node --import tsx --test src/projects/git-store-migration.test.ts` passes.
- [x] `pnpm --filter @openreel/web typecheck` or web `tsc --noEmit` passes.
- [ ] Start orchestrator on port `4041`.
- [ ] Start web app.
- [ ] Create a project with a unique name; verify `<projectsRepo>/<slug>/project.json` exists.
- [ ] Import media; verify `<projectsRepo>/<slug>/media/<mediaId><ext>` exists.
- [ ] Verify `git -C <projectsRepo>/<slug> log --oneline` contains project/media commits.
- [ ] Verify `git -C <projectsRepo>/<slug> lfs ls-files` lists media files.
- [ ] Reload web with `autoRestoreProjectId`; verify backend restore works with media via `remoteUrl`.
- [x] Stop orchestrator and reload; verify the app shows the backend/project-server error instead of falling back to IDB. (covered by `useProjectRecovery` test; browser verification not run because this lane changed backend/test behavior only)
- [ ] Switch active asset version; verify only `project.json` changes and all media files remain present.

## Commit plan

Commit this work as small, atomic commits after validation:

1. `docs: sync backend autosave plan to worktree architecture`
2. `fix(orchestrator): reconcile project repo migration and listing` (if migration/listing is changed)
3. `test: validate backend-only project recovery` (if tests are added/updated)
4. `chore: remove stale project fixture dirs` (if repository-tracked cleanup is needed)
