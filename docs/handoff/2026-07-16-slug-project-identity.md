# Handoff: slug-only project identity and startup recovery

Date: 2026-07-16

## Objective

Finish the approved project identity correction:

- `project.id` remains the field name, but its value is always an immutable backend-reserved slug.
- A supplied `projectId` must load only that project. Startup must never create a replacement or placeholder project.
- New project creation is backend-first and requires backend availability.
- Project names remain mutable and never rename the slug.
- Remove the temporary client UUID identity and reconciliation path.
- Make recovery bounded and ensure it cannot freeze on `Recovering...`.

This directly addresses Inbox #22 and the regression specified in:

- `docs/spec/regressions/url-project-id-startup-base-revision-regression.md`
- `docs/spec/project-persistence.md`

## Mandatory startup

Before repository exploration:

1. Call Serena `initial_instructions`.
2. Activate `/Volumes/Joseph/Projects1/ai-agents/openreel-video`.
3. Confirm Hindsight is available. Do not use Serena memory tools.
4. Prefer the code-review graph for architecture and impact if it is available and indexed for this checkout. Otherwise use Serena for targeted semantic navigation.
5. Prefix every shell command with `rtk`.
6. The browser UI must be verified against the running services on ports 5173 and 4041 before completion.

## Git state

Branch: `feature/backend-autosave-git-lfs`

HEAD when this handoff was written:

- `c3cb9f0 chore(repo): ignore machine-local agent artifacts`

The worktree was clean before adding this handoff.

Relevant pushed commits:

- `accac2b docs: specify URL project startup regression`
- `ec3dec3 fix(orchestrator): preserve loadable media receipts`
- `5318e40 fix(generation): harden upload and finalization boundaries`
- `fbdd5b0 feat(generation): complete resumable WaveSpeed workflow`
- `f88cfcb fix(web): distinguish missing from unavailable media`
- `b4f6d00 docs(generation): align WaveSpeed delivery evidence`
- `59ad24e chore(repo): update project tooling and inbox state`
- `c3cb9f0 chore(repo): ignore machine-local agent artifacts`

Do not rewrite or squash these commits. Continue with small test-first commits.

## Confirmed runtime evidence

The live backend project `vintage-tokyo` is valid and has a confirmed base revision. A direct backend GET returned:

- commit: `86799730b3d4afdf16075c57749b0707992d2dc7`
- tree: `c3afa8f2c08e22b01d0a982ce8da45312042d6aa`
- project blob: `8f72520f1d85e7dc48fa87d2ba3860a746ff48fe`
- 28 media items
- 5 tracks
- 13 clips
- 28 locally verified LFS payloads

Therefore, the original failure is not missing backend data. It is frontend startup identity and recovery behavior.

Browser reproduction in a clean Chrome profile:

1. `http://localhost:5173/#/editor?projectId=vintage-tokyo` loads the correct project.
2. `http://localhost:5173/?projectId=vintage-tokyo#/editor` ignores the query before the fragment.
3. The ignored identifier causes an empty generated project to be created and offered as a local recovery candidate.
4. One reproduced generated project was `Modern London` with UUID `83ab99dd-118c-4cb8-822c-f95ce6e6a1a8`.
5. Pressing `Recover Project` freezes on `Recovering...`.

Screenshot evidence:

- `/tmp/openreel-recovery-frozen-regression.png`

## Root causes already identified

### URL parsing

`useRouter()` parses only `window.location.hash`. It recognizes a query after the hash route but not the ordinary page query before the fragment.

Both of these forms need an explicit compatibility decision in tests. The already observed required behavior is that a supplied `projectId` is authoritative and must never be replaced by a new project:

- `/#/editor?projectId=vintage-tokyo`
- `/?projectId=vintage-tokyo#/editor`

Prefer one canonical URL form for generated links, but parse both forms during migration.

### Eager placeholder creation

The project store initializes with `createEmptyProject()`, which assigns a UUID before routing or backend loading has resolved. Autosave then persists this placeholder. This is the source of the hundreds of empty projects.

The store must represent unresolved startup explicitly. It must not expose or autosave an editable project until one of these has completed:

- the requested slug loaded with a confirmed receipt;
- the backend reserved a new slug and returned the new project with a confirmed receipt.

### UUID reconciliation

The current client-first flow creates a UUID, later receives a backend slug, and reconciles identities. This creates races, stale autosaves, 404s, and project replacement hazards.

Remove normal-runtime use of:

- `isClientOnlyProjectId`
- `reconcileBackendIdentity`
- pending UUID creation metadata
- normal-runtime `migrateProjectId`

UUIDs remain correct for media, clips, actions, jobs, effects, and other non-project entities.

### Frozen recovery

`recoverFromAutoSave()` saves before it has loaded and confirmed the backend base revision. `RecoveryDialog.handleRecover()` does not await the recovery result and does not clear `selectedSave` when recovery returns false or rejects.

Recovery must:

- load the authoritative backend project and confirmed receipt first;
- validate that the autosave belongs to the same slug;
- merge or reject deterministically;
- perform at most one bounded persistence attempt;
- always settle the dialog state on success, false, or exception;
- never create a new project as a recovery fallback when a slug was supplied.

## Approved architecture

### Identity contract

- `Project.id` is an immutable slug.
- Slugs are collision-safe and reserved by the backend before the frontend activates the project.
- The editable display name is separate and may change freely.
- The frontend never manufactures a project identity.
- Offline creation is not supported.

### Backend creation

The backend should own slug allocation. `ProjectStore.createProject()` currently derives `toSlug(name)` but does not perform collision-safe reservation.

Add an atomic reservation operation with deterministic suffixing, for example:

- `my-project`
- `my-project-2`
- `my-project-3`

The reservation must be safe under concurrent create requests. Do not check existence and create outside the same project lock or atomic filesystem/Git operation.

The create response must contain the canonical project and confirmed base revision receipt. The frontend must not activate or autosave the project before validating that receipt.

### Legacy UUID autosaves

Do not retain UUIDs as normal project identifiers. Handle old UUID-keyed autosaves through an explicit one-time migration or quarantine boundary only.

Safe default:

- never send a UUID project ID to the backend;
- never create a backend project automatically from a UUID autosave;
- if the autosave contains a known canonical slug, re-key it once after validating the backend project;
- otherwise quarantine it and present a clear import/recovery choice without mutating backend state.

## Implementation sequence

### 1. Map contracts and impact

Use Serena to locate definitions and references for:

- `createEmptyProject`
- `createNewProject` / project creation store actions
- `isClientOnlyProjectId`
- `reconcileBackendIdentity`
- `migrateProjectId`
- `recoverFromAutoSave`
- `RecoveryDialog.handleRecover`
- `useRouter`
- backend `ProjectStore.createProject`
- project create and load routes
- autosave startup effects

Inspect existing regression tests before changing production code.

### 2. Write failing deterministic tests

At minimum cover:

1. A slug in either supported URL form is parsed before project initialization.
2. When `projectId` is supplied, no create request occurs on load failure, timeout, or backend unavailability.
3. Store startup does not autosave an unresolved placeholder.
4. New project creation calls the backend first and activates only the returned slug plus confirmed receipt.
5. Two projects with the same requested name receive distinct immutable slugs.
6. Concurrent same-name create requests cannot reserve the same slug.
7. Renaming a project does not change its ID.
8. UUID IDs are rejected at the backend project boundary.
9. Recovery always clears `Recovering...` on false and rejection.
10. Recovery cannot save before a confirmed base revision exists.
11. Recovery for a requested slug never creates a replacement project.
12. Legacy UUID autosaves follow the explicit migration/quarantine policy only.

### 3. Implement backend-first slug reservation

Implement the backend contract and tests first. Preserve the existing strict UUID rejection on PUT. Return the canonical receipt from create.

### 4. Remove client UUID project startup

Replace eager `createEmptyProject()` initialization with an unresolved/loading state. Guard autosave, editing, and recovery until a confirmed project exists.

Delete the normal UUID-to-slug handoff only after all callers have moved to backend-first creation.

### 5. Correct URL and recovery behavior

Parse the canonical route and compatibility page-query form. Ensure route startup decides load versus create before any project side effect.

Make recovery awaitable, bounded, receipt-aware, and terminal on every outcome.

### 6. Verify and document

Run focused tests first, then package typechecks. Reproduce the exact `vintage-tokyo` flow in a browser against ports 5173 and 4041.

Required browser assertions:

- both URL forms load `vintage-tokyo` without any POST create request;
- no empty project appears in the backend project list;
- refresh preserves the confirmed base revision;
- recovery succeeds or reports a terminal error, never freezes;
- creating two same-name projects yields distinct slugs;
- renaming either project preserves its slug.

Update the regression spec with final test names and browser evidence. Commit and push each verified logical change.

## Focused verification baseline

The dirty work that preceded this handoff was committed and pushed. Its relevant focused verification passed:

- orchestrator project persistence: 21 tests
- orchestrator generation boundaries: 7 tests
- web generation workflow: 61 tests
- web media availability UI: 36 tests
- orchestrator typecheck: passed
- web typecheck: passed

These results do not prove the slug migration. The new project identity regressions and browser scenarios above are still required.

## Important failure modes

- Treating the display name as identity would make renames destructive.
- Reserving slugs with a non-atomic existence check would allow concurrent collisions.
- Keeping a hidden UUID placeholder would preserve the autosave race even if URLs parse correctly.
- Falling back from failed slug load to create would recreate the original data-loss behavior.
- Accepting any successful GET without receipt validation would restore the no-base-revision failure.
- Retrying recovery without a bound could recreate the frozen screen through a save/load loop.
- Migrating arbitrary UUID autosaves automatically could attach local data to the wrong backend project.

## Completion standard

Do not mark this complete based only on unit tests or typechecking. Completion requires:

- backend-reserved immutable project slugs;
- no normal-runtime UUID project identity path;
- no project creation when a URL supplies `projectId`;
- no unresolved placeholder autosave;
- confirmed base revision before editing or recovery persistence;
- deterministic regression coverage;
- exact browser verification against the live frontend and backend;
- clean atomic commits pushed to the current branch.
