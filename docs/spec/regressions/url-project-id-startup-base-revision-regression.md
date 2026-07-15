# URL project identity startup and confirmed base revision regression

**Status:** Implemented on 2026-07-16. Deterministic tests and live browser evidence are recorded below.

## Extends

This regression extends `docs/spec/regressions/project-save-regression.md`, especially the confirmed persistence receipt contract at lines 32–60 and the `vintage-tokyo` existing-project regression at lines 65–100. It also enforces the optimistic-concurrency requirements in `docs/spec/regressions/project-save-archive-integrity-and-dangling-clips-regression.md`, especially PSAR-14 and invariant 13.

Those specifications require every save to use a confirmed base revision. They do not yet state strongly enough that a URL project identity must control startup before any default project is instantiated or persisted.

## User-visible failure

Opening the reported query-before-fragment form:

`http://localhost:5173/?projectId=vintage-tokyo#/editor`

does not load `vintage-tokyo`. The editor displays a new empty project with a random UUID and generated name. In the exact reproduced run it displayed `Modern London`, no media, and no timeline content. It then reported persistence activity for UUID `83ab99dd-118c-4cb8-822c-f95ce6e6a1a8`, including:

`pending persistence timed out after 7000ms`

The recovery dialog then offered an IndexedDB save named `Vintage Tokyo`, while the random empty project remained active underneath. The application had not loaded or confirmed the authoritative backend project.

This is the source of the reported `No confirmed base revision is available for project ...` failure. The backend has a confirmed base revision, but startup never associates it with the active project. If the user accepts the offered recovery, `recoverFromAutoSave()` resets persistence for the recovered ID and calls `backendSaveService.save(projectToRecover)` before calling `backendSaveService.load(projectToRecover.id)`. The save correctly rejects because no confirmed base was established. The load that could establish it is ordered after the failing save and is unreachable.

The recovery failure is then hidden as a permanent busy state. In the reproduced browser run, 15 seconds after pressing **Recover Project**, the modal still displayed `Recovering...`; the selected save and recovery button were disabled, the empty `Modern London` project remained underneath, and no error or retry action appeared.

It also explains the accumulation of empty projects: startup is allowed to create, autosave, reconcile, or schedule persistence for a placeholder even though the caller supplied an authoritative project ID. This must be impossible.

## Confirmed evidence

### Backend is not the missing-revision source

`GET http://localhost:4041/api/projects/vintage-tokyo` returned HTTP 200 with a complete committed receipt:

| Field | Confirmed value |
|---|---|
| `projectId` | `vintage-tokyo` |
| `commitSha` | `86799730b3d4afdf16075c57749b0707992d2dc7` |
| `treeSha` | `c3afa8f2c08e22b01d0a982ce8da45312042d6aa` |
| `projectBlobSha` | `8f72520f1d85e7dc48fa87d2ba3860a746ff48fe` |
| `sourceModifiedAt` | `1783941188928` |
| `mediaManifestDigest` | `edc2b9e9fa944ea7be39e811ff5b64ab5bf45edb942c72784f9de1ff223d5c7a` |
| Project contents | 28 media items, 5 tracks, 13 clips |
| Required media | 28 locally verified LFS payloads |

The project repository HEAD, tree, and `project.json` blob resolve to the same three Git identities. The backend receipt is therefore available and internally consistent.

### Route control case

Opening the hash-router form:

`http://localhost:5173/#/editor?projectId=vintage-tokyo`

loaded `Vintage Tokyo`, displayed its 28 media items and 5 tracks, and showed `Persisted 56h ago` in an isolated browser profile. This proves the backend load and receipt-confirmation path works when the router receives the ID. It does not excuse the query-before-fragment form: that form also visibly contains an authoritative `projectId` and is already produced or preserved by current navigation.

### Current source path

1. `apps/web/src/hooks/use-router.ts` initializes routing exclusively from `window.location.hash` via `parseHash(window.location.hash)`. It ignores `window.location.search`.
2. With `/?projectId=vintage-tokyo#/editor`, the hash router resolves `editor` but returns no `projectId` because the ID is before the fragment.
3. `apps/web/src/App.tsx` passes only `params.projectId` to `useProjectRecovery()`. The authoritative search parameter is therefore never sent to recovery.
4. `apps/web/src/stores/project-store.ts` initializes `project` with `createEmptyProject()` before URL identity is resolved. `createEmptyProject()` assigns a UUID and generated name.
5. Autosave bindings observe that placeholder, create a local save, and schedule persistence even though an authoritative URL ID exists outside the hash.
6. Recovery discovery then offers prior local state for `vintage-tokyo` rather than first loading its backend receipt.
7. `recoverFromAutoSave()` calls `backendSaveService.resetForProject(projectToRecover.id)`, uploads local blobs, and calls `backendSaveService.save(projectToRecover)` before its later backend load. With no matching receipt in the persistence-status store, save throws `No confirmed base revision`.
8. `apps/web/src/components/welcome/RecoveryDialog.tsx` sets `selectedSave`, invokes `onRecover(saveId)` without awaiting it, and has no success/failure/finally transition. When recovery returns `false` or rejects, `selectedSave` is never cleared, so the modal remains disabled with `Recovering...` indefinitely.

The safety check is behaving correctly. Startup violates its precondition by activating a newly generated project instead of loading the requested one.

## Required invariant

If a syntactically valid `projectId` is present in any supported entry URL, that ID is authoritative for the entire startup transaction.

Before that project has either loaded with a validated confirmed receipt or failed visibly, the application MUST NOT:

- call `createEmptyProject()` or `createNewProject()` for an active project;
- allocate a project UUID or generated project name;
- write an IndexedDB/local autosave record for a placeholder project;
- call `POST /api/projects`;
- upload media for another project ID;
- schedule or execute backend persistence for another project ID;
- reconcile by project name;
- replace, remove, or rewrite the requested `projectId` in the URL; or
- render an editable empty project as if loading succeeded.

There is no fallback-to-new-project behavior when `projectId` is present. A missing, invalid, unreachable, or unverifiable requested project produces a visible, non-mutating load failure with retry and project-picker actions. Creating a new project remains an explicit user action only.

## Supported URL normalization

Both reported entry forms MUST resolve to the same canonical identity before application startup side effects run:

- `/#/editor?projectId=vintage-tokyo`
- `/?projectId=vintage-tokyo#/editor`

The application may canonicalize the second form to the first with `history.replaceState`, but it must preserve the exact decoded project ID and all supported parameters. Canonicalization must happen before the project store, autosave bindings, recovery, editor mutation subscriptions, or welcome flow can create state.

If both search and hash locations contain a `projectId` and the values differ, startup MUST fail closed with an identity-conflict error. It must not choose one silently.

## Startup state contract

Startup with a URL project ID has these explicit states:

1. `resolving-url-identity`: parse and validate the ID; no project exists and no save-capable subscriptions run.
2. `loading-requested-project`: GET exactly the requested ID; placeholder creation and all writes remain disabled.
3. `confirming-base-revision`: validate project ID, `commitSha`, `treeSha`, `projectBlobSha`, `sourceModifiedAt`, manifest digest, and required media evidence.
4. `ready`: atomically install the project and its matching confirmed base revision, then enable autosave and editing.
5. `load-failed`: show a stable error; keep all project creation and persistence disabled until the user explicitly retries, chooses a different project, or invokes New Project.

Recovery is a bounded sub-transaction with `idle`, `recovering`, `recovered`, and `recovery-failed` states. Every recovery promise must settle into `recovered` or `recovery-failed` within a configured finite deadline. `recovery-failed` displays the exact actionable error, re-enables retry and alternate-save selection, and keeps the authoritative backend project active. A modal may never remain in `Recovering...` after the operation has returned `false`, rejected, or timed out.

The project and base revision are one atomic startup result. Code must never expose the loaded project with `baseRevision: null`, nor expose a base revision whose `projectId` differs from the active project.

## Deterministic regression tests

### Router tests

- Given `/#/editor?projectId=vintage-tokyo`, return the same route and parameters.
- Given `/?projectId=vintage-tokyo#/editor`, normalize to the canonical editor route and return `params.projectId === "vintage-tokyo"`.
- Given conflicting path/search and hash IDs, return a typed identity-conflict result and perform no navigation that discards either value.
- Assert normalization preserves encoded IDs and unrelated supported parameters without double decoding.

### Application startup tests

- Mount the application separately at `/#/editor?projectId=vintage-tokyo` and `/?projectId=vintage-tokyo#/editor`. Hold backend GET pending. For both forms, assert zero calls to `createEmptyProject`, `createNewProject`, autosave writes, `scheduleSave`, media upload, and project POST.
- Resolve GET with the confirmed receipt fixture. Assert `Vintage Tokyo` and its content are installed together with the matching base revision before editing becomes enabled.
- Reject GET or return an invalid receipt. Assert a visible load failure, no editable empty project, and the same zero-creation/zero-write call counts.
- Start with a newer local autosave for `vintage-tokyo`. Assert the backend project and base receipt remain authoritative until the user explicitly chooses recovery; never create a third project identity.
- Accept a newer local recovery for `vintage-tokyo`. Assert the recovery transaction first loads and validates the current backend base, then performs conflict/reconciliation handling. It must never attempt save before confirmed load.
- Run under React Strict Mode and remount/HMR simulation. Assert one logical GET and zero project creations.

### Recovery dialog tests

- Make `onRecover` resolve `false`. Assert `Recovering...` ends, controls re-enable, and a visible actionable error is rendered.
- Make `onRecover` reject. Assert the rejection is handled, controls re-enable, and retry is possible without remounting the dialog.
- Make `onRecover` never settle. Advance deterministic fake timers to the recovery deadline and assert a timeout error replaces the busy state.
- Make `onRecover` resolve `true`. Assert the dialog closes only after the recovered project and confirmed base revision are installed atomically.
- Select an older save after a failed newest-save recovery. Assert the newly selected attempt is enabled and independently tracked.

### Persistence tests

- After successful URL startup, make one deterministic semantic edit. Assert the PUT contains the exact confirmed revision from GET and the response advances the stored revision.
- Assert a scheduled save cannot accept a project until startup state is `ready` and its project ID equals the confirmed receipt project ID.
- Assert `No confirmed base revision` cannot be produced by a startup placeholder because no startup placeholder can exist.
- Assert a stale or mismatched revision still returns `409 PROJECT_CONFLICT`; this regression must not weaken the existing safety gate.

### End-to-end browser regression

Use an isolated browser profile and a fixture copy, never the user project repository for mutations:

1. Run the flow once with `/#/editor?projectId=vintage-tokyo` and once with `/?projectId=vintage-tokyo#/editor`.
2. Confirm no welcome screen, generated project name, empty editor, tour, or new-project request appears.
3. Confirm the URL retains `projectId=vintage-tokyo` after canonicalization.
4. Confirm the rendered title is `Vintage Tokyo`, the media library has 28 items, and the timeline has 5 tracks and 13 clips.
5. Confirm the persistence UI has a validated persisted state backed by commit `86799730b3d4afdf16075c57749b0707992d2dc7` or the fixture's equivalent receipt.
6. Confirm the network log contains one GET for `vintage-tokyo`, zero project POSTs, zero requests for UUID project IDs, and no PUT before a user edit.
7. Add a newer local recovery fixture, press **Recover Project**, and exercise success, no-base failure, and timeout outcomes. Confirm no outcome leaves `Recovering...` indefinitely and every failure exposes retry.
8. Reload and repeat. Assert project count and local autosave identity count are unchanged.

## Acceptance criteria

- A URL containing `projectId=vintage-tokyo` loads only `vintage-tokyo`.
- Startup creates zero temporary, in-memory active, IndexedDB, or backend projects when `projectId` is present.
- The welcome/new-project flow cannot intercept or discard a URL project identity.
- Path/query and hash-router entry forms have identical project-loading behavior.
- The editor becomes writable only after project data and its matching confirmed base revision are installed atomically.
- Load failure is visible and non-mutating. It never falls back to an empty project.
- Recovery success closes the modal only after atomic project/base installation; recovery failure or timeout exits the busy state, shows the cause, and permits retry.
- Repeated reload, Strict Mode, HMR, backend delay, and backend failure cannot increase the project count.
- The existing no-base-revision and conflict guards remain mandatory, but normal URL startup satisfies them using the confirmed GET receipt.

## Failure modes retained by design

- A malformed or conflicting URL identity fails closed.
- A backend outage leaves the editor non-writable and offers retry/project-picker actions.
- An incomplete receipt or failed media audit does not install a base revision and does not create a replacement project.
- A newer local recovery snapshot is presented as an explicit conflict choice, never silently substituted and never assigned a fabricated base revision.
- A stale save is rejected as `PROJECT_CONFLICT`; URL normalization does not authorize overwrite.

## Implementation evidence

- `parseLocation()` merges the compatibility page query with the hash route query; the canonical hash value wins when both are present.
- The project store starts with a non-editable `unresolved` sentinel and autosave remains disabled until a backend load or create confirms a persistence receipt.
- URL startup performs only `backendSaveService.load(requestedSlug)`. A missing or mismatched project is terminal and never calls project creation or recovery.
- Project creation is backend-first. The backend-returned slug becomes active only after `baseRevision` is confirmed.
- Normal runtime UUID reconciliation and pending UUID creation metadata were removed. UUID project loads and autosaves are quarantined.
- Recovery loads the matching backend slug and confirmed base before one persistence attempt, reloads the result, and returns `false` with a visible error on every failure path.
- `RecoveryDialog` awaits recovery and clears `Recovering...` in `finally` for `false` and rejected promises.

Deterministic coverage:

- `src/hooks/use-router.test.ts`
- `src/hooks/useProjectRecovery.test.ts`
- `src/components/welcome/RecoveryDialog.test.tsx`
- `src/stores/project-store.test.ts`
- orchestrator project route and Git-store identity tests

Live browser verification passed against `http://localhost:5173` and `http://localhost:4041` using system Chrome through Playwright. The test opened both supported URL forms in isolated pages, refreshed each, and confirmed `Vintage Tokyo` remained visible with no unresolved-project, load-error, onboarding-tour, or framework overlay. The network ledger contained zero project-collection POSTs and zero PUT/PATCH/DELETE requests; read-only media verification requests were allowed. The backend project ID list was identical before and after the run, and the browser console contained no errors.

The permanent check is `apps/web/e2e/project-identity.spec.ts`, run with `pnpm --filter @openreel/web test:e2e -- e2e/project-identity.spec.ts`. Screenshot evidence was captured outside the repository at `/tmp/openreel-project-identity-hash.png` and `/tmp/openreel-project-identity-page-query.png`.
