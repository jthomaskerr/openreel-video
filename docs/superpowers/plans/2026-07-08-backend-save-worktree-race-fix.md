# Plan: Fix backend-save worktree creation race + client-UUID project IDs

> Spec: `docs/spec/2026-07-08-backend-save-worktree-race-fix.md`
> Inbox: #2

## Scope for this pass

Implement **Fix A** (required — closes the HTTP 500 crash) and **Fix B** (backend-driven project creation
so IDs are orchestrator slugs, not client UUIDs). Fix 3.3 (StrictMode double-invoke hardening) is folded
into Fix A's test coverage but the autosave-effect cleanup itself is included since it's cheap and directly
explains the observed duplicate saves.

Doc updates (`project-lifecycle.md`, git-lfs plan doc) are included as a final step since they're small and
already scoped in the spec.

## Steps

### 1. `apps/orchestrator/src/projects/git-store.ts` — serialize worktree creation, make it retry-safe

- Extract the mutating body of `ensureWorktree()` into a private `#ensureWorktreeInner(projectId)` that
  does **not** acquire a lock (same code as today, minus nothing — just a rename/extraction).
- `ensureWorktree(projectId)` (public) becomes: `assertValidProjectId` → `ensureSharedRepo()` →
  `#withLock(projectId, () => this.#ensureWorktreeInner(projectId))`.
- `#commitInner()` already runs inside `#withLock` (via `commit()`); change its call from
  `this.ensureWorktree(projectId)` to `this.#ensureWorktreeInner(projectId)` directly (still needs
  `ensureSharedRepo()` first — keep that call, or hoist it, since `#ensureWorktreeInner` will no longer call
  it if we move it out. Simplest: keep `ensureSharedRepo()` inside `#ensureWorktreeInner()` — it's already
  idempotent and cheap, no separate lock needed for it).
- In `addWorktree()`, wrap the `-b` creation in try/catch: on failure, if `branchExists(branch)` is now
  true, fall back to `git worktree add <path> <branch>` (attach to the branch another caller just created)
  instead of throwing. Only re-throw if the branch still doesn't exist (a genuine unrelated failure).
- Verify: `commitAsync` (fire-and-forget, used by media upload / create / rename routes) and `saveProject`'s
  `PUT` handler both funnel through the same lock key (`projectId`) so worktree-creation and post-creation
  commits for the same project never interleave across requests.

### 2. Orchestrator test: reproduce and verify the race is fixed

New file `apps/orchestrator/src/projects/git-store-concurrency.test.ts` (sibling of
`git-store-migration.test.ts`, same `node:test` + `mkdtemp` harness pattern):

- Build a `GitStore` against a fresh tmp repo dir, call `ensureSharedRepo()`.
- Fire `Promise.all([gitStore.ensureWorktree(id), gitStore.ensureWorktree(id)])` for a `projectId` that has
  never been touched.
- Assert both promises resolve without throwing.
- Assert exactly one worktree dir exists (`existsSync(join(repoDir, id, ".git"))`) and `git branch --list
  project/<id>` reports exactly one line.
- Add a second case that also races `ensureWorktree(id)` against `commit(id, "msg")` to cover the
  `#commitInner` path.

### 3. `apps/web/src/services/backend-save.ts` — add `create()`

- Add `async create(name: string, settings?: Partial<ProjectSettings>): Promise<Project | null>` wrapping
  `POST /api/projects` (mirrors `save`/`load` error handling: non-OK → return `null` or throw consistent
  with how callers will use it — throw on failure so `createNewProject()` can `try/catch` and fall back).
- Import `ProjectSettings` type alongside existing `Project`/`MediaItem` import from `@openreel/core`.

### 4. `apps/web/src/stores/project-store.ts` — `createNewProject()` backend-first

- Change `createNewProject` to (still synchronous-looking API is not required — check existing callers'
  usage first; if it's called without `await` anywhere it may need to become async-tolerant, i.e. keep
  local UUID project set synchronously and swap in the backend id once resolved, OR make it async
  end-to-end if all call sites already await/ignore the return). Plan:
  1. Set local state immediately using `createEmptyProject()` (unchanged) so the UI never blocks on
     network — this preserves current synchronous UX.
  2. Fire an async follow-up: if `backendSaveService.isReachable()`, call
     `backendSaveService.create(name, settings)`. On success, if the store's current project is still the
     just-created one (no user action swapped it away in the interim), replace `project.id`/other fields
     with the backend-returned project via the existing `loadProject`-style state update (careful: must not
     re-trigger `explicitlyCreated` reset or duplicate history stacks — reuse the same `set({ project: ...
     })` shape used elsewhere, not a full `loadProject()` call, to avoid resetting undo/redo).
  3. On backend-create failure/unreachable, leave the local UUID project as-is (current behavior,
     unchanged) — first autosave `PUT` will lazily create the backend record as it does today, now
     safely thanks to Fix A.
  4. Call `backendSaveService.resetForProject()` after any id swap too (currently called once at the end of
     `createNewProject`).
- Check all call sites of `createNewProject` (grep via `code_graph` references) to confirm none assume the
  new project's `id` is available synchronously right after the call in a way that would break.

### 5. `apps/web/src/components/editor/EditorInterface.tsx` — autosave init idempotency (Fix 3.3)

- Add a cleanup to `useAutoSave()`'s effect that calls `stopAutoSave()` on unmount, matching the
  bridge-init/dispose pattern already used elsewhere in this file.
- Confirm `AutoSaveManager.start()` already fully resets (`this.stop()` at top) so a second `start()` call
  is safe/idempotent — it is, per current code. The remaining gap is the `"saved"` listener being
  registered twice with no dedupe; add an `off()` in the same cleanup or make `initializeAutoSave()` in
  `project-store.ts` guard against double-registration (e.g. only call `autoSaveManager.on("saved", ...)`
  once per store lifetime via a module-level flag). Prefer the simplest fix: guard inside
  `initializeAutoSave` in the store with a `#autoSaveInitialized` flag so repeated calls are no-ops.

### 6. Web tests

- `apps/web/src/services/backend-save.test.ts`: add a case for `create()` — success path returns parsed
  project, failure path throws/returns null per chosen contract.
- `apps/web/src/stores/project-store.test.ts`: add/extend a case around `createNewProject` verifying
  backend-unreachable fallback keeps local UUID behavior (mock `backendSaveService.isReachable` → false).
  A reachable-backend success-path test can mock `isReachable` → true and `create` → returns a fixed slug
  project, asserting the store's `project.id` ends up as the slug.

### 7. Docs

- `docs/spec/project-lifecycle.md` §9.1.4: replace "Generate UUID project ID" language with the slug-based
  behavior actually implemented by `ProjectStore.createProject()`.
- `docs/superpowers/plans/2026-07-01-backend-autosave-git-lfs.md`: update the "Project identity" bullet to
  note the web app now creates via `POST /api/projects` and uses backend slug ids (once implemented), and
  add this plan's file to context if useful.

## Validation checklist

- [ ] `pnpm --filter @openreel/orchestrator exec node --import tsx --test src/projects/git-store-concurrency.test.ts` passes.
- [ ] `pnpm --filter @openreel/orchestrator exec node --import tsx --test src/projects/git-store-migration.test.ts` still passes.
- [ ] `pnpm --filter @openreel/orchestrator exec node --import tsx --test src/projects/storage-validation.test.ts` still passes.
- [ ] `pnpm --filter @openreel/orchestrator typecheck` passes.
- [ ] `pnpm --filter @openreel/web typecheck` passes.
- [ ] `pnpm --filter @openreel/web test -- backend-save` passes (new `create()` cases).
- [ ] `pnpm --filter @openreel/web test -- project-store` passes (new `createNewProject` cases).
- [ ] Manual/browser verification (per repo AGENTS.md — UI fix, browser check required):
  - [ ] Start orchestrator (`pnpm --filter @openreel/orchestrator dev`, port 4041) and web
        (`pnpm --filter @openreel/web dev`, port 5173).
  - [ ] Create a new project via "New Project" in the browser; confirm no console error, confirm
        `~/openreel-projects/<slug>/project.json` exists with the human-readable slug (not a UUID).
  - [ ] Confirm autosave (wait ~30s or trigger a change) pushes successfully with no
        `[BackendSave] auto-save push failed` console error.
  - [ ] Stop orchestrator, create a new project (backend unreachable), confirm project still creates
        locally with a UUID id and no unhandled error; confirm autosave gracefully fails
        (existing/unchanged behavior).

## Commit plan

1. `fix(orchestrator): serialize worktree creation to prevent duplicate branch race`
2. `test(orchestrator): add concurrency regression test for ensureWorktree`
3. `feat(web): create projects via backend POST with slug ids, UUID fallback offline`
4. `fix(web): guard autosave init against duplicate listener registration`
5. `docs: correct project-lifecycle spec to describe slug project ids`
