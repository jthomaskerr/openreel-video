# Project-save regression: async backend project creation

## Status and scope

This spec records the regression found on `feature/backend-autosave-git-lfs`.
The primary data-loss bug is fixed in the current checkout by commit `0dfec94`
(`fix(web): preserve edits during backend project creation`). This document is
an investigation record and acceptance contract, not a product-code change.

The related `{}`-as-Blob recovery failure is a separate downstream defect. It
is included only where it affects the observed user impact.

## Concrete current behavior

When the user creates a project while the orchestrator is reachable:

1. `createNewProject()` synchronously installs `createEmptyProject()` in the
   Zustand store. The project initially has a client-generated UUID.
2. A fire-and-forget chain calls `backendSaveService.isReachable()`, then
   `backendSaveService.create()`, which calls `POST /api/projects`.
3. The backend returns a newly-created, empty project with a canonical slug ID.
4. The current code checks that the live project still has the original UUID,
   then merges only the backend ID, `createdAt`, and a new `modifiedAt` into
   the live project. It preserves the live media library, timeline, settings,
   and other edits, and immediately calls `backendSaveService.save()`.
5. `backendSaveService.save()` skips UUID IDs, uploads in-memory media for slug
   IDs, sanitizes non-serializable fields, and sends `PUT /api/projects/:id`.
6. The orchestrator validates that the request path and payload IDs match,
   rejects UUID IDs, atomically writes `project.json`, awaits the Git commit,
   and returns a persistence receipt.

## Existing-project persistence regression (2026-07-13)

The follow-up failure affected `vintage-tokyo`: multiple edit types updated the
frontend and displayed `Auto saved`, but the UI had no evidence that Git persistence
completed. The backend returned success before its fire-and-forget commit, so commit
failures could not reach the browser and the local autosave label was misleading.

The persistence boundary now requires an awaited Git commit and a validated receipt.
The header separately reports local autosave and `Persisted <human duration> ago`.
Pending dots are larger and pulse; commit failures set a failed state and produce a
detailed, finite-lived toast. Toast duration is configurable in persisted General
settings. Frontend and backend logs cover every persistence stage, and fallback paths
emit diagnostics rather than silently eating errors.

A second root cause was debounce starvation: every project mutation cleared and
restarted the two-second backend timer. Editor activity that updated the project more
often than every two seconds left the UI permanently at `Persisted queued` and never
issued a PUT, so neither `project.json` nor Git changed. Backend scheduling now has a
five-second maximum queue age and persists the latest snapshot by that deadline.

Recovered copies could also retain a client UUID even when the backend project used
the `vintage-tokyo` slug. UUIDs are now reconciled through a unique exact project-name
match before queueing. Ambiguous or missing matches fail visibly and never PUT a UUID.

The historical broken behavior at step 4 replaced the live project with the
empty `POST` response. The immediate PUT therefore persisted an empty project.
The backend could retain an uploaded media file while its `project.json` no
longer referenced that item, producing an orphaned file and an empty media
library after reload.

There remains a separate timing edge case: if the page reloads before the
backend create resolves, recovery can still try the original UUID. The backend
does not create UUID worktrees, so `GET /api/projects/<client-uuid>` returns
404. Local IndexedDB auto-save records also retain the original UUID after the
live store swaps to the slug. These are follow-up persistence concerns, not a
reversal of the fixed merge bug.

## Root cause

The regression was a stale-snapshot replacement across an asynchronous identity
transition:

```ts
// Historical implementation
const merged = { ...backendProject, modifiedAt: Date.now() };
set({ project: merged });
backendSaveService.save(merged);
```

`backendProject` is intentionally an empty creation skeleton. It is not a
snapshot of edits made while `POST /api/projects` was pending. Replacing the
live state with it discarded imports and timeline edits, then the follow-up
save made the loss durable. The current implementation reads `get()` only
after the promise resolves and overlays the canonical backend identity onto
`current.project` instead.

## Affected files and symbols

| File | Symbol / lines | Role |
|---|---|---|
| `apps/web/src/stores/project-store.ts` | `useProjectStore` → `createNewProject()`, lines 1554–1624 | Starts local creation, backend create race, canonical slug swap, initial full save. |
| `apps/web/src/services/backend-save.ts` | `BackendSaveService.create()`, lines 142–159 | Calls `POST /api/projects`; returns the empty backend skeleton and canonical ID. |
| `apps/web/src/services/backend-save.ts` | `BackendSaveService.save()`, lines 165–194 | Skips UUID IDs, uploads blobs, then PUTs sanitized project JSON. |
| `apps/web/src/services/auto-save.ts` | `AutoSaveManager.start()` and `saveIfDirty()`, lines 125–204 | Starts an immediate local IndexedDB save and later periodic/debounced saves. |
| `apps/orchestrator/src/projects/routes.ts` | `createProjectRouter()`, PUT handler lines 220–243 | Rejects UUID PUTs and persists slug-ID project JSON. |
| `apps/orchestrator/src/projects/project-store.ts` | `ProjectStore.saveProject()`, lines 136–174 | Creates/ensures the worktree and atomically replaces `project.json`. |
| `apps/web/src/stores/project-store.test.ts` | backend project creation test lines 247–334 | Deterministic regression test for edits during pending backend creation. |
| `apps/web/src/services/backend-save.test.ts` | save tests lines 152–211 | Covers UUID suppression, slug PUT, and media-before-project ordering. |
| `apps/orchestrator/src/projects/routes.test.ts` | UUID PUT test lines 82–112 | Confirms rejected UUID writes do not touch storage or Git. |

## User-visible impact

Before the fix, a user could create a project and immediately import media or
edit the timeline. When backend creation completed, the UI silently lost those
changes. On a later reload the project appeared empty or its media appeared
missing. If the media upload had already completed, the backend could contain a
binary with no corresponding `MediaItem` reference.

The related recovery path could also pass a JSON-deserialized `{}` in place of
a Blob to `URL.createObjectURL()`, causing a `TypeError` in waveform preview
and a WebKit `WebKitBlobResource` error. That symptom is covered by the
media-recovery tests and should not be used as the sole proof of the save race.

## Reproduction

### Deterministic test reproduction

Run the test named:

`ProjectStore > project creation > backend project creation > regression:
preserves media imported during pending backend create`

The test makes `isReachable()` resolve true, holds `create()` on a deferred
promise, injects a media item while creation is pending, resolves the backend
response, and asserts that the slug swap and immediate save retain the item.
Against the historical implementation, the item count becomes zero and the
save receives the empty backend skeleton.

### Browser reproduction of the historical bug

1. Start the web app and orchestrator.
2. Delay `window.fetch` for `/api/projects` POST/GET requests by about three
   seconds.
3. Create a new project.
4. Immediately import an audio or video file, or make a timeline edit.
5. Reload before the delayed backend creation resolves.
6. Inspect the project after reload and the response from
   `GET /api/projects/<slug>`.

Expected historical failure: `mediaLibrary.items` is empty even though the
backend media scan may still report the uploaded file. The fixed code must
retain the imported item in `project.json` and show it after reload once the
slug creation/save completes.

## Acceptance criteria

- Edits made after local creation but before `POST /api/projects` resolves are
  preserved when the canonical slug is installed.
- The initial post-creation backend save contains the current media library,
  timeline, settings, and other live edits, not the empty POST response.
- A successful slug project save uploads media before PUTting project JSON.
- A UUID project is never PUT or uploaded to the backend.
- The backend rejects UUID PUTs without calling `saveProject()` or committing.
- A PUT is successful only after the corresponding Git commit completes and returns a
  receipt containing the matching project ID and `persistedAt`.
- A Git commit failure returns HTTP 500, produces a detailed frontend failure toast,
  and never displays a successful persisted state.
- The local `Auto saved` label is visually distinct from confirmed backend Git
  persistence.
- Toasts expire using the configured persisted timeout.
- Debug/info persistence logs are not converted into error toasts.
- Continuous editor mutations cannot keep persistence queued for more than five
  seconds.
- Queued and active persistence operations have explicit seven-second and
  twenty-second deadlines respectively; timeout is a visible failure, never a
  permanent operating state.
- Media hydrated from the current backend project is skipped only after an HTTP 200
  `HEAD` freshness check for its exact backend URL. New, missing, stale, malformed,
  or unreachable media URLs enter the upload stage before project PUT.
- A reload after the create/save sequence returns the same project structure and
  media references that were visible before reload.
- Failed or unreachable backend creation leaves the local project usable and
  reports the failure without replacing it with an empty project.
- Recovery does not attempt to treat a deserialized `{}` as a Blob.
- The implementation defines behavior for reload during the unresolved
  UUID-to-slug window: either delay recovery until identity resolution, persist
  a durable alias, or explicitly recover from the local UUID save and reconcile
  it into the slug project. A 404 with silent data loss is not acceptable.

## Required regression tests

Existing coverage must remain green:

- `apps/web/src/stores/project-store.test.ts`: deferred backend creation with
  a media import during the pending window; assert slug ID, media retention,
  and merged initial save.
- `apps/web/src/services/backend-save.test.ts`: UUID save suppression; slug PUT;
  media upload before project PUT.
- `apps/web/src/hooks/useProjectRecovery.test.ts`: recovery of persisted media
  without passing invalid JSON Blob placeholders to media consumers.
- `apps/orchestrator/src/projects/routes.test.ts`: UUID PUT rejected before
  `saveProject()` or Git commit.

Add before closing the remaining edge case:

- Hold `backendSaveService.create()` pending, trigger recovery/reload, and
  assert that the client does not issue `GET` for the temporary UUID as the
  authoritative project ID, or that it safely reconciles that save after the
  slug is known.
- Assert that the local auto-save key/project ID is migrated or aliased when
  the backend slug replaces the temporary UUID.
- Add a failure-path test where `create()` rejects after local edits; assert
  that the local project and its edits remain intact and no empty backend save
  is attempted.

## Verification evidence

Repository evidence:

- `git show 0dfec94^:apps/web/src/stores/project-store.ts` shows the historical
  replacement with `{ ...backendProject, modifiedAt }`.
- `apps/web/src/stores/project-store.ts` now merges into `current.project` and
  calls `backendSaveService.save(merged)`.
- The deterministic regression test at lines 247–334 asserts slug adoption,
  media retention, and the non-empty save payload.
- The handoff `docs/handoff/2026-07-09-backend-autosave-race-condition.md`
  records a live reproduction, targeted test results, and TypeScript
  verification. It reports the targeted store, backend-save, and recovery
  suites passing, plus `pnpm exec tsc --noEmit -p apps/web` clean. It also
  records two unrelated pre-existing `AssetBuckets.test.tsx` failures in the
  full web suite.

Session limitations:

- The code-review graph/semantic graph MCP tools requested by the repository
  instructions were not exposed in this session. Serena symbol search and
  targeted file reads were used instead.
- Browser tooling was not available in this session, so no new browser run was
  performed. The browser reproduction and post-fix reload evidence above is
  transcribed from the dated handoff, not claimed as a fresh verification.
- A fresh local test command could not run because the environment has no
  `node` executable (`pnpm exec vitest ...` exited with `env: node: No such
  file or directory`).

## Verification command set

With Node available, run:

```sh
cd apps/web
pnpm exec vitest run src/stores/project-store.test.ts
pnpm exec vitest run src/services/backend-save.test.ts
pnpm exec vitest run src/hooks/useProjectRecovery.test.ts
pnpm exec tsc --noEmit -p apps/web
```

Then perform the delayed-create browser reproduction and verify both the UI
media library and the backend `project.json`/`GET /api/projects/<slug>` payload.
