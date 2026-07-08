# Spec: Fix backend-save worktree creation race + client-UUID project IDs

> Source: Inbox #2 — `[Error] [BackendSave] auto-save push failed: Error: Backend save failed: HTTP 500 —
> Error: Command failed: git worktree add -b project/08668435-6052-4a9a-9399-d8ad531831de ... fatal: a branch
> named 'project/08668435-6052-4a9a-9399-d8ad531831de' already exists`
> Reporter note: "But it shouldn't be the uuid anyway"
>
> Related: `docs/superpowers/plans/2026-07-01-backend-autosave-git-lfs.md`, `docs/spec/project-lifecycle.md`

## 1. Problem statement

Auto-save pushes to the orchestrator (`backendSaveService.save()` → `PUT /api/projects/:id`) intermittently
fail with `HTTP 500` when a **brand-new** project is saved for the first time. The orchestrator's error is a
raw git failure:

```
Command failed: git worktree add -b project/<id> <path> HEAD
fatal: a branch named 'project/<id>' already exists
```

This is a symptom of two separable defects:

1. **Race condition** in `GitStore.ensureWorktree()` — the git-branch-creation path is not covered by the
   per-project mutex (`#withLock`) that the rest of `GitStore` uses, so two concurrent `PUT` requests for the
   same not-yet-existing project can both reach `git worktree add -b project/<id> ...` and the second one
   fails because the first already created the branch.
2. **Design gap** — the project ID that collides is a client-generated UUID (`08668435-...`), not an
   orchestrator-issued slug. The web app never calls `POST /api/projects` to create the project on the
   backend; it only ever `PUT`-upserts a project object whose `id` was minted client-side by
   `crypto`-backed `uuidv4()` in `createEmptyProject()`. This is a known, documented gap ("Current
   web-created projects still use client UUIDs ... switching the synchronous web creation flow to backend
   `POST` remains a follow-up" — `docs/superpowers/plans/2026-07-01-backend-autosave-git-lfs.md`). The
   reporter's "it shouldn't be the uuid anyway" is pointing at this gap directly.

Both defects should be addressed; #1 is the direct cause of the crash and must be fixed regardless of #2,
but #2 is the architectural root cause worth fixing so IDs are meaningful/orchestrator-owned and so the
race window in #1 shrinks (project creation becomes a single explicit `POST`, not implicit via the first
autosave `PUT`).

## 2. Root-cause analysis

### 2.1 The race in `GitStore`

`apps/orchestrator/src/projects/git-store.ts`:

- `commit()` (and `commitAsync()`) wrap all git mutation in `#withLock(projectId, fn)`, a per-project
  promise-chain mutex (`#locks: Map<string, Promise<void>>`).
- `ensureWorktree()` — called from `ProjectStore.saveProject()` → `ensureProjectDir()` on **every** `PUT`,
  and also from the media-upload route before `next()` — does **not** use `#withLock`. It directly does:

  ```ts
  async ensureWorktree(projectId: string): Promise<void> {
    await this.ensureSharedRepo();
    const wtPath = this.worktreePath(projectId);
    if (existsSync(join(wtPath, ".git"))) { ...; return; }
    if (existsSync(wtPath)) {
      await this.promoteExistingDirectoryToWorktree(projectId, wtPath);
    } else {
      await this.addWorktree(projectId, wtPath);   // <-- unguarded
    }
    ...
  }
  ```

- `addWorktree()` itself has a check-then-act race even in isolation:

  ```ts
  private async addWorktree(projectId: string, wtPath: string): Promise<void> {
    const branch = `project/${projectId}`;
    if (await this.branchExists(branch)) {
      await this.git(["worktree", "add", wtPath, branch], this.repoDir);
      return;
    }
    await this.git(["worktree", "add", "-b", branch, wtPath, "HEAD"], this.repoDir);
  }
  ```

  If two calls for the same `projectId` both run `branchExists()` before either has created the branch,
  both see `false` and both attempt `git worktree add -b project/<id> ...`. Git only allows one `-b` to
  succeed; the loser fails with exactly the observed `fatal: a branch named '...' already exists`.

### 2.2 Why two concurrent saves happen for a brand-new project

`apps/web/src/components/editor/EditorInterface.tsx`:

```ts
const useAutoSave = () => {
  const { initializeAutoSave } = useProjectStore();
  useEffect(() => {
    initializeAutoSave().catch(console.error);
  }, [initializeAutoSave]);
};
```

`apps/web/src/main.tsx` renders the app inside `<React.StrictMode>`. In React 18 dev mode, StrictMode
intentionally double-invokes effects with no cleanup, so `initializeAutoSave()` — and therefore
`autoSaveManager.start(...)` plus `autoSaveManager.on("saved", ...)` — can run **twice** for the same mount.

`AutoSaveManager.start()` (`apps/web/src/services/auto-save.ts`) forces an immediate save:

```ts
start(getProject: () => Project): void {
  if (!this.config.enabled) return;
  this.stop();
  this.getProjectFn = getProject;
  this.isDirty = true;
  this.pendingProject = getProject();
  void this.saveIfDirty();          // <-- fires immediately
  this.intervalId = setInterval(() => { ... }, this.config.interval);
}
```

Two `start()` calls in quick succession each force an immediate `saveIfDirty()` → IndexedDB `save()` →
`emit("saved", ...)`. Because `on("saved", cb)` was also registered twice (two distinct closures, both
added to the `Set<AutoSaveEventCallback>`), a single `"saved"` emission can trigger
`backendSaveService.save(project)` multiple times back-to-back. Even outside of StrictMode/dev, the
debounced `markDirty()` path (subscribed via `useProjectStore.subscribe`, also double-registered under
StrictMode) can overlap with the periodic interval tick, producing two near-simultaneous `PUT` calls for
the same new project.

Because there is no explicit backend "create project" step, the **first** `PUT /api/projects/:id` for a
new project is what implicitly creates the worktree/branch on the backend — which is exactly the moment
the unguarded race in §2.1 is reachable. Once the worktree/branch already exists (steady state), the race
is not observable because `ensureWorktree()` short-circuits on `existsSync(join(wtPath, ".git"))`.

### 2.3 The ID design gap

`apps/web/src/stores/project/project-helpers.ts`:

```ts
export function createEmptyProject(name?: string, settings?: Partial<ProjectSettings>): Project {
  return {
    id: uuidv4(),   // client-generated UUID
    ...
  };
}
```

`apps/orchestrator/src/projects/project-store.ts` `createProject()` (used only by
`POST /api/projects`, which the web app never calls) generates a **slug** from the name via `toSlug()`,
not a UUID — contradicting `docs/spec/project-lifecycle.md` §9.1.4 ("Generate UUID project ID"), which is
itself stale relative to the implemented worktree-per-slug architecture described in
`docs/superpowers/plans/2026-07-01-backend-autosave-git-lfs.md`.

The web app's project store never calls `POST /api/projects`; `createNewProject()` in
`apps/web/src/stores/project-store.ts` only sets local state (`createEmptyProject()`) and calls
`backendSaveService.resetForProject()`. The backend project record and git worktree/branch are created
lazily on the *first autosave `PUT`*, using the client UUID as the (valid, per
`storage-validation.ts`'s `PROJECT_ID_PATTERN`) project id. Consequences:

- Project IDs for web-created projects are opaque UUIDs, not the human-meaningful slugs orchestrator
  otherwise uses (`GET /api/projects` listing, `docs/spec/project-lifecycle.md` §9.3.1 "Project ID (for
  debugging)").
- `renameProject()`'s slug-based rename-on-name-change logic (`ProjectStore.renameProject`, which changes
  the worktree directory/branch name to match the new slug) never runs its "move worktree" branch for
  these projects unless/until a rename is explicitly triggered — the initial ID staying a UUID forever is
  the actual intended behavior only by omission, not by design.
- The very first backend contact for a new project is an autosave `PUT`, an operation designed to be
  idempotent/repeatable, not creation — so nothing before now enforces "at most one creation attempt", which
  is why the concurrency in §2.2 was able to reach the unguarded git codepath in the first place.

## 3. Proposed fix

Two independent-but-complementary changes. Both are in scope for this spec; they can land as separate
commits/PRs given #1 is the urgent bug and #2 is a larger behavioral change.

### 3.1 Fix A — make worktree creation race-safe (required, addresses the HTTP 500 directly)

In `apps/orchestrator/src/projects/git-store.ts`:

- Wrap `ensureWorktree()`'s mutating path in the existing `#withLock(projectId, fn)` mutex (or introduce a
  dedicated `#withLock` call around just the worktree-creation branch), so concurrent `PUT`/media-upload
  requests for the same never-before-seen `projectId` serialize instead of racing on
  `git worktree add -b`.
  - Note `#commitInner()` itself calls `ensureWorktree()` when `!existsSync(join(wtPath, ".git"))` — if
    `ensureWorktree()` acquires the same per-project lock, `commit()`'s existing `#withLock` call would
    deadlock (promise chain re-entrancy on the same key). The lock needs restructuring: either (a) extract
    an unlocked `#ensureWorktreeInner()` used by both `ensureWorktree()` (locked) and `#commitInner()`
    (already locked, calls the unlocked inner form directly), or (b) make `#withLock` reentrant-safe for a
    single in-flight chain. Option (a) is simpler and matches the existing `#commitInner` pattern.
- Additionally/defensively, make `addWorktree()` idempotent against a lost race even under the lock, by
  catching the specific git failure (`already exists`) and retrying the non-`-b` path once:
  ```ts
  try {
    await this.git(["worktree", "add", "-b", branch, wtPath, "HEAD"], this.repoDir);
  } catch (err) {
    if (String(err).includes("already exists") && (await this.branchExists(branch))) {
      await this.git(["worktree", "add", wtPath, branch], this.repoDir);
      return;
    }
    throw err;
  }
  ```
  This guards against any remaining external race (e.g. a concurrent process outside this Node instance,
  or a horizontally-scaled orchestrator — currently out of scope but cheap insurance) and turns a fatal
  500 into a successful, idempotent worktree attach.
- Add/extend orchestrator tests: a concurrency test that calls `ensureWorktree(id)` (or the `PUT` route
  handler) twice in parallel for a fresh `id` and asserts both resolve successfully and exactly one
  worktree/branch exists afterward. `apps/orchestrator/src/projects/git-store-migration.test.ts` is the
  closest existing precedent for this kind of test; a new `git-store-concurrency.test.ts` (or an addition
  to an existing git-store test file, if one exists beyond migration) is appropriate.

### 3.2 Fix B — stop minting client UUIDs as backend project IDs (addresses "it shouldn't be the uuid anyway")

Move project creation to be backend-driven, closing the gap called out as a "follow-up" in the git-lfs
plan doc:

- `apps/web/src/stores/project-store.ts` `createNewProject()` should, for the "explicit user creation"
  entry points described in `docs/spec/project-lifecycle.md` §9.1.2 (New Project button, `/new` command,
  Start Scratch), call `POST /api/projects { name, settings }` and use the **orchestrator-returned**
  `Project` (with its slug `id`) as the new project state, instead of locally minting a UUID via
  `createEmptyProject()`/`uuidv4()`.
  - Preserve current offline/backend-unreachable behavior: if the backend is unreachable
    (`backendSaveService.isReachable()` already exists for this), fall back to the current local
    `createEmptyProject()` UUID path so project creation still works fully offline. This keeps `explicitlyCreated`
    gating semantics (§9.4.3 of `project-lifecycle.md`) intact either way.
- `renameProject`-driven slug changes already exist server-side (`ProjectStore.renameProject`); once
  creation goes through `POST`, this becomes the only place project directory/branch names change, which
  is already handled.
- Existing UUID-identified projects already saved to `~/openreel-projects/<uuid>/` continue to work
  unchanged — `storage-validation.ts`'s `PROJECT_ID_PATTERN` (`^[a-z0-9][a-z0-9-]{0,127}$`) accepts
  lowercase UUIDs, and nothing in this spec proposes migrating already-created UUID projects (that is a
  separate, larger migration decision — see Open Questions).
- Update `docs/spec/project-lifecycle.md` §9.1.4 to match the implemented slug-ID architecture (it
  currently says "Generate UUID project ID", which is already stale/wrong relative to
  `ProjectStore.createProject()`'s `toSlug()` behavior) and update
  `docs/superpowers/plans/2026-07-01-backend-autosave-git-lfs.md`'s "Project identity" note to mark the
  follow-up as done once implemented.

### 3.3 Secondary hardening — reduce duplicate autosave triggers (nice-to-have, reduces race likelihood further)

Not required once Fix A lands (the backend becomes safe under concurrency regardless), but worth flagging
since it's the proximate trigger observed in the error:

- `useAutoSave()` in `EditorInterface.tsx` has no cleanup and no re-entrancy guard, so StrictMode's
  double-invoke — and any future remount — double-registers `autoSaveManager` listeners/intervals. Consider
  either:
  - Guarding `AutoSaveManager.start()`/`initialize()` to be idempotent (no-op if already started/initialized
    for the same project), or
  - Adding an effect cleanup that calls `stopAutoSave()` / unregisters the `"saved"` listener, mirroring the
    pattern used elsewhere in this file for bridges (`initializePlaybackBridge`/`disposePlaybackBridge`, etc).
  This is optional relative to the inbox item but directly explains why the bug is observed in the first
  place and is cheap to fix alongside Fix A.

## 4. Files touched (expected)

| File | Change |
|---|---|
| `apps/orchestrator/src/projects/git-store.ts` | Serialize `ensureWorktree()`'s creation path under the per-project lock; make `addWorktree()` retry-safe on "already exists" |
| `apps/orchestrator/src/projects/*.test.ts` (new or extended) | Concurrency regression test for `ensureWorktree()` |
| `apps/web/src/stores/project-store.ts` | `createNewProject()` calls `POST /api/projects` when backend reachable; local-UUID fallback when not |
| `apps/web/src/services/backend-save.ts` | Add a `create(name, settings)` method wrapping `POST /api/projects` (mirrors existing `save`/`load`) |
| `apps/web/src/components/editor/EditorInterface.tsx` | (optional, Fix 3.3) add autosave init cleanup/idempotency guard |
| `docs/spec/project-lifecycle.md` | Correct §9.1.4 to describe slug IDs, not UUID IDs |
| `docs/superpowers/plans/2026-07-01-backend-autosave-git-lfs.md` | Mark "web-created projects still use client UUIDs" follow-up as resolved |

## 5. Acceptance criteria

- [ ] Two concurrent `PUT /api/projects/:id` (or `ensureWorktree(id)`) calls for a project id that does not
      yet exist on the backend both succeed (no `HTTP 500`, no `fatal: a branch ... already exists`), and
      exactly one worktree + one `project/<id>` branch exists afterward.
- [ ] A new orchestrator test reproduces the pre-fix race (fails without Fix A, passes with it).
- [ ] Creating a new project via the "New Project" button / `/new` command / "Start scratch" flow while the
      orchestrator is reachable results in a project whose `id` is the orchestrator-issued slug, and
      `GET /api/projects` lists it under that slug immediately (not only after the first autosave).
- [ ] Creating a new project while the orchestrator is unreachable still works (local UUID fallback), and
      autosave later succeeds once the backend becomes reachable (existing retry/backoff behavior, if any,
      is unaffected).
- [ ] `docs/spec/project-lifecycle.md` and the git-lfs plan doc no longer contradict the implemented slug-ID
      behavior.
- [ ] Existing tests (`storage-validation.test.ts`, `git-store-migration.test.ts`, `backend-save.test.ts`,
      `project-store.test.ts`) continue to pass.

## 6. Open questions

- Should already-persisted UUID-named projects be migrated to slugs retroactively (similar to
  `ProjectStore.migrateUuidDirs()`, which currently only migrates *legacy* UUID dirs missing the
  worktree layout, not UUID dirs that already have a valid worktree)? Out of scope for this fix unless
  requested — flagging so it isn't silently conflated with Fix B.
- Should `POST /api/projects` be made idempotent/collision-safe against slug collisions in the same way
  Fix A hardens `PUT`'s worktree creation (two users naming a project the same thing at the same time)?
  `ProjectStore.createProject()` does not currently check for an existing slug before writing — worth a
  follow-up but not required to close this inbox item, since it's a distinct (much rarer) race from the
  one reported.
- Do we want `AutoSaveManager` to expose a promise/state so `useAutoSave()` can await "already
  initialized" instead of relying on StrictMode-safe idempotency guards ad hoc? (Relevant to §3.3.)
