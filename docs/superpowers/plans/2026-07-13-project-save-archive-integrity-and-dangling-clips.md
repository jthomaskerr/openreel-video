# Project Save Archive Integrity and Dangling Clips Implementation Plan

> **Executor:** GPT-5.4-mini. Execute tasks in order. Do not combine tasks or weaken assertions to make tests pass. Read `docs/spec/regressions/project-save-archive-integrity-and-dangling-clips-regression.md` before starting and re-check its acceptance criteria at the final gate.

**Goal:** Make every confirmed project save a complete, conflict-safe, independently verifiable snapshot whose Git commit contains only audited files, whose media use semantic collision-safe filenames, and whose dangling timeline clips are visibly and accessibly marked missing.

**Architecture:** Introduce a typed save transaction and receipt shared by the orchestrator and web client. The orchestrator audits the proposed project and media manifest before mutation, resolves media filenames inside the transaction, stages an explicit path allowlist, validates the staged diff, creates the commit message from that staged diff, verifies Git/LFS identities, and only then returns success. The client supplies a base revision, treats upload state as a hint rather than proof, reconciles structured conflicts once, and updates its confirmed receipt. Timeline rendering treats a missing media-library target as an explicit error state.

**Tech stack:** TypeScript, Express, Node filesystem and child-process APIs, Git/Git LFS, React, Zustand, Vitest/Node test runner, Testing Library, pnpm.

**Measurable outcome:** An incomplete, stale, destructive-without-intent, or unauditable save returns a structured 409 without changing the authoritative snapshot or HEAD. A successful receipt resolves to exactly the audited project JSON and media manifest. Semantic media filenames survive save/reload, collisions use the lowest available ` <n>` suffix, and every clip with a dangling media reference displays a persistent accessible missing marker.

## Execution rules for GPT-5.4-mini

1. Use Serena/code-review-graph for targeted navigation before editing. Never inspect or mutate `~/openreel-projects/vintage-tokyo`.
2. Run each task's focused failing test before implementation and record the expected failure.
3. Make only the files listed in that task unless a compiler error proves one directly related contract consumer must change. Document any added file in the commit body.
4. Use temporary repositories created by the test process. Add the fail-closed test-root guard before any new integration fixture can execute Git.
5. Never use `git add -A` in product save/upload code. Never make tests pass by broadening the transaction allowlist.
6. Keep all integrity decisions deterministic. No LLM call or probabilistic eval is required.
7. After each green task, run its focused test and typecheck the affected package, then commit with the supplied conventional-commit subject. Do not use `--no-verify`.
8. If an existing type does not expose a semantic filename, stop and trace the canonical `MediaItem` field. Do not create a second competing filename field.

## Task 1: Define the snapshot transaction, manifest, errors, and receipt contracts

**Files:**
- Create: `packages/core/src/project-persistence.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/project-persistence.test.ts`
- Modify: `apps/web/src/services/backend-save.ts`

**Steps:**
1. Add failing contract tests for deterministic manifest ordering/digest input, `MEDIA_INCOMPLETE`, `PROJECT_CONFLICT`, `DESTRUCTIVE_CHANGE_REQUIRES_INTENT`, and a receipt containing `commitSha`, `treeSha`, `projectBlobSha`, `sourceModifiedAt`, and `mediaManifestDigest`.
2. Define JSON-safe types: `ProjectBaseRevision`, `RequiredMediaManifestEntry`, `ProjectSaveRequest`, `ProjectSaveReceipt`, and the three structured 409 response bodies. Include `mediaId`, normalized semantic filename, relative physical path, expected byte size, and optional LFS OID in each manifest entry.
3. Add a canonical manifest serializer that sorts by `mediaId`, normalizes path separators, and rejects duplicate IDs or paths. Keep hashing in the orchestrator so core remains browser-safe.
4. Replace the web-local `PersistenceReceipt` shape with the shared type. Compile errors should enumerate every consumer that must later be migrated; do not fill receipt fields with fake values.
5. Run `pnpm --filter @openreel/core test:run` and `pnpm --filter @openreel/core typecheck`.

**Commit:** `feat(core): define verifiable project save contracts`

## Task 2: Add a fail-closed temporary-project-root guard

**Files:**
- Create: `apps/orchestrator/src/projects/test-project-root.ts`
- Test: `apps/orchestrator/src/projects/test-project-root.test.ts`
- Modify: project integration-test fixture helpers used by `apps/orchestrator/src/projects/routes.test.ts`

**Steps:**
1. Write a regression test that passes `~/openreel-projects`, the configured normal projects root, and an arbitrary non-temp path. Assert rejection occurs before a supplied repository-command spy is invoked.
2. Write a positive test using the test framework's fresh temporary directory.
3. Implement a test-only guard that resolves symlinks/parents, requires the fixture root to be beneath the test's assigned temp root, and rejects equality with or containment of the configured user projects root. Do not use a basename-only or `/tmp` string check.
4. Wire every project/Git integration fixture through the guard before `GitStore` or `ProjectStore` construction.
5. Run the focused test and existing orchestrator project tests.

**Commit:** `test(orchestrator): prevent project fixtures reaching user data`

## Task 3: Implement safe semantic filename allocation

**Files:**
- Create: `apps/orchestrator/src/projects/media-filename.ts`
- Test: `apps/orchestrator/src/projects/media-filename.test.ts`
- Modify: `apps/orchestrator/src/projects/storage-validation.ts`

**Steps:**
1. Write table tests for `clip.mp4`, `clip 1.mp4`, lowest-gap reuse, multiple dots, no extension, hidden/dot names, separators, reserved traversal forms, Unicode normalization equivalents, and case-only collisions.
2. Define the target-filesystem comparison policy explicitly. Probe or inject case sensitivity for tests; normalize Unicode to the chosen persisted form before comparison.
3. Implement `sanitizeProjectFilename` and `allocateMediaFilename(desired, occupied, policy)`. Preserve the final extension and append ` <n>` to the stem, starting at 1. Never overwrite or rename an occupied entry.
4. Return both the persisted basename and comparison key so callers cannot repeat normalization inconsistently.
5. Run the focused test and orchestrator typecheck.

**Commit:** `feat(orchestrator): allocate safe semantic media filenames`

## Task 4: Build deterministic media manifests and pre-write completeness audits

**Files:**
- Create: `apps/orchestrator/src/projects/media-manifest.ts`
- Test: `apps/orchestrator/src/projects/media-manifest.test.ts`
- Modify: `apps/orchestrator/src/projects/project-store.ts`

**Steps:**
1. Test a complete project, an absent original, duplicate physical path, filename/project-field mismatch, wrong byte size, dangling clip, and stable digest regardless of media-library input order.
2. Add a read-only `ProjectStore.auditSnapshot(project)` path. It must scan required file-backed media, clip references, physical files, expected sizes, and manifest uniqueness without writing JSON, index files, media, or Git state.
3. Compute SHA-256 over the core canonical serializer. Report missing entries with semantic filename and media ID. Report dangling clips separately so they cannot be mistaken for a file scan miss.
4. Treat generated/non-file-backed media according to existing core type semantics. Do not require originals for text/shape/SVG-only entries.
5. Prove non-mutation by snapshotting project JSON bytes, worktree status, and HEAD before/after a failed audit.

**Commit:** `feat(orchestrator): audit snapshot media before mutation`

## Task 5: Make Git commits stage and validate an explicit allowlist

**Files:**
- Modify: `apps/orchestrator/src/projects/git-store.ts`
- Create: `apps/orchestrator/src/projects/git-store-allowlist.test.ts`

**Steps:**
1. Seed a temp repository with unrelated `.DS_Store`, `healthy-1.mp4`, `missing-1.mp4`, and a pre-existing deletion. Write a failing test proving a project save stages none of them.
2. Change `GitStore.commit`/`#commitInner` to require an explicit normalized relative-path allowlist and expected name-status entries. Reject absolute paths, traversal, duplicates, `.git`, and paths outside the project worktree.
3. Stage only allowlisted paths using pathspec-safe Git arguments. Intentional deletions must be named explicitly in the allowlist.
4. Read `git diff --cached --name-status -z`, compare it exactly to expected entries, and abort/reset only this transaction's index changes if there is any mismatch. Preserve unrelated pre-existing worktree changes.
5. Assert mismatch leaves HEAD unchanged and no unrelated path staged or committed.

**Commit:** `fix(orchestrator): restrict project commits to audited paths`

## Task 6: Generate truthful commit messages from the final staged diff

**Files:**
- Modify: `apps/orchestrator/src/projects/semantic-commit.ts`
- Modify: `apps/orchestrator/src/projects/semantic-commit.test.ts`
- Modify: `apps/orchestrator/src/projects/git-store.ts`

**Steps:**
1. Replace the `fileCount = 1` assumption with staged-diff input containing status and path. Add tests for project JSON plus media additions/deletions and renamed paths if supported.
2. Make the commit sequence: stage allowlist, read/validate cached diff, derive semantic project changes plus file changes, format message, then commit.
3. Assert every staged path appears exactly once in the body and `Files changed` equals the distinct cached path count. Keep the subject succinct and deterministic.
4. Ensure a message cannot be supplied from an earlier/unvalidated worktree view. The API may accept semantic JSON changes, but the final file list must come from the staged diff.
5. Run semantic and allowlist tests together.

**Commit:** `fix(orchestrator): derive commit messages from staged changes`

## Task 7: Return independently verifiable Git object identities

**Files:**
- Modify: `apps/orchestrator/src/projects/git-store.ts`
- Test: `apps/orchestrator/src/projects/git-store-allowlist.test.ts`
- Modify: `apps/orchestrator/src/projects/routes.ts`

**Steps:**
1. Extend the Git commit result with commit SHA, tree SHA, and `project.json` blob SHA resolved from the created commit, not the working tree.
2. Add a verification helper that resolves the receipt's commit/tree/blob and checks the committed project blob plus manifest digest against the audited transaction.
3. Add a test that tampers with the expected manifest or staged tree and asserts commit confirmation aborts with HEAD unchanged.
4. Return the shared receipt fields from PUT only after verification succeeds. Preserve no-op save behavior by returning the last confirmed identities rather than invented SHAs.

**Commit:** `feat(orchestrator): return verifiable project save receipts`

## Task 8: Verify Git LFS payload availability, not pointer presence

**Files:**
- Create: `apps/orchestrator/src/projects/lfs-integrity.ts`
- Test: `apps/orchestrator/src/projects/lfs-integrity.test.ts`
- Modify: `apps/orchestrator/src/projects/media-manifest.ts`

**Steps:**
1. Create a temp LFS fixture, retain a pointer, remove its local object, and assert verification reports media ID, semantic filename, and OID.
2. Parse pointer metadata using Git LFS plumbing where practical. Verify local object presence and size. Do not accept a 129-byte pointer file as the original.
3. Represent remote durability as an explicit check/result. If no remote durability target is configured, receipt state must say local-only; if configured, verify upload/reachability before calling the receipt durable.
4. Add LFS OIDs and verification state to the audited manifest/receipt without making the canonical digest machine-dependent.
5. Run focused tests with a clear skip only when Git LFS itself is unavailable; CI/release verification must require it.

**Commit:** `feat(orchestrator): verify archived Git LFS media payloads`

## Task 9: Implement an atomic save transaction with optimistic concurrency

**Files:**
- Create: `apps/orchestrator/src/projects/save-transaction.ts`
- Test: `apps/orchestrator/src/projects/save-transaction.test.ts`
- Modify: `apps/orchestrator/src/projects/routes.ts`
- Modify: `apps/orchestrator/src/projects/project-store.ts`

**Steps:**
1. Add failing tests for absent media, two saves from one base revision, staged-manifest mismatch, and commit failure. For every failure assert unchanged authoritative JSON bytes, project index, worktree status, HEAD, and LFS refs.
2. Serialize transactions per project using the existing Git/project lock boundary. Compare submitted base commit/tree to current state before any mutation; return `409 PROJECT_CONFLICT` with submitted and current revisions on mismatch.
3. Inside one transaction: validate request, audit proposed snapshot, prepare temporary JSON/media changes, allocate final names, stage the explicit allowlist, validate staged diff, build message, commit, verify receipt, then atomically publish the confirmed state.
4. On failure, remove only transaction-owned temporary files and index entries. Never discard unrelated user worktree changes.
5. Route PUT through the transaction and map typed failures to structured 409 responses. Remove the direct pre-audit `saveProject(incoming)` flow.

**Commit:** `fix(orchestrator): make project saves atomic and conflict safe`

## Task 10: Protect destructive structural shrink

**Files:**
- Create: `apps/orchestrator/src/projects/destructive-change.ts`
- Test: `apps/orchestrator/src/projects/destructive-change.test.ts`
- Modify: `apps/orchestrator/src/projects/save-transaction.ts`

**Steps:**
1. Encode deterministic metrics for media count, clip count, track count, and serialized structural size. Put thresholds in named constants with tests at each boundary.
2. Reproduce the incident's 28-media/13-clip/full-project to test-shaped snapshot. Assert autosave rejection without mutation.
3. Allow a protected destructive save only when the base revision is current and explicit user destructive intent is present, or when a server transaction enumerates every removal and dependent reference.
4. Reject inferred intent from autosave, retry, recovery, or test metadata. Return `DESTRUCTIVE_CHANGE_REQUIRES_INTENT` with metric deltas.

**Commit:** `fix(orchestrator): guard destructive project shrink saves`

## Task 11: Make media upload pending until attached to a snapshot

**Files:**
- Modify: `apps/orchestrator/src/projects/routes.ts`
- Modify: `apps/orchestrator/src/projects/save-transaction.ts`
- Test: `apps/orchestrator/src/projects/routes.test.ts`

**Steps:**
1. Add tests proving upload alone does not produce a project persistence receipt or durable orphan commit, and that snapshot commit atomically includes the pending media and matching project filename.
2. Change upload to place bytes in a transaction-owned pending area keyed by project/media identity. Validate size/type and allocate the semantic filename inside the subsequent save transaction.
3. Include the pending media path and project JSON in one audited allowlist. Expired/unreferenced pending uploads must be visible as pending and safely cleanable, never represented as saved project membership.
4. Preserve stable media IDs while updating the canonical project filename to the allocator's result before commit.

**Commit:** `fix(orchestrator): attach media uploads to snapshot commits`

## Task 12: Make the web save service prove originals and reconcile once

**Files:**
- Modify: `apps/web/src/services/backend-save.ts`
- Test: `apps/web/src/services/backend-save.test.ts`
- Modify: the project store receipt/base-revision state discovered through Serena references

**Steps:**
1. Test a media item with no Blob, readable handle, or proven exact remote object. Assert no PUT occurs and the caller receives visible incomplete-persistence state.
2. Test `uploadedIds` containing an ID while authoritative HEAD/audit says absent. Assert re-upload or visible failure. Treat `uploadedIds` only as a request coalescing cache.
3. Send the last confirmed base revision and explicit save intent with each PUT. Store the returned verified receipt as the next base only after success.
4. Handle `MEDIA_INCOMPLETE` by attempting original recovery once, rebuilding a fresh snapshot, and retrying once. Do not recurse. Handle `PROJECT_CONFLICT` by surfacing conflict and preserving the newer server state.
5. Ensure filename allocation returned by the server updates the matching `MediaItem` before the receipt becomes confirmed.

**Commit:** `fix(web): reconcile incomplete and stale project saves`

## Task 13: Mark dangling clips missing and remove UUID-primary labels

**Files:**
- Modify: `apps/web/src/components/editor/timeline/ClipComponent.tsx`
- Modify: `apps/web/src/components/editor/timeline/ClipComponent.test.tsx`
- Modify: the existing missing-media manifest/store selector discovered through Serena references, if needed

**Steps:**
1. Render a clip whose `mediaId` has no media-library row. Assert a persistent Missing/Error marker, accessible explanation, repair action, and semantic manifest title. Assert the UUID prefix is absent from the primary label or appears only as secondary diagnostic text.
2. Render multiple clips referencing the same missing item and assert every clip is marked.
3. Define `isMissingMedia` as `!mediaItem || getMediaStatus(mediaItem) is missing/error`. Recover a semantic name from the last confirmed manifest when the library row is absent; otherwise use a clear `Missing media` label, never the ID prefix alone.
4. Clear markers only after relink plus confirmed persistence receipt, not immediately after selecting a local file.
5. Cover compact timeline rendering and accessible name/description behavior in component tests.

**Commit:** `fix(web): expose dangling timeline media references`

## Task 14: Cover media views and missing-only filtering

**Files:**
- Modify: existing media pane grid/list/grouped/filter components found by Serena
- Modify: their colocated tests

**Steps:**
1. Add a shared selector/view-model test that classifies absent library targets and manifest-known missing media consistently.
2. Add focused tests for grid, list, grouped media, search, and missing-only filtering. A missing item must not disappear because a view expects a full `MediaItem` row.
3. Reuse the same semantic title and repair action semantics as the timeline. Do not create view-specific missing-state rules.
4. Run the affected web tests and web typecheck.

**Commit:** `fix(web): keep missing media visible across editor views`

## Task 15: Correct persistence documentation and add operator verification

**Files:**
- Modify: `docs/spec/backend-persistence-versioning.md`
- Modify: `docs/spec/project-lifecycle.md`
- Modify: `docs/spec/regressions/project-save-regression.md`
- Modify: `docs/spec/regressions/project-save-missing-media-regression.md`
- Create: `docs/runbooks/project-save-integrity-verification.md`

**Steps:**
1. Replace UUID-basename requirements with the semantic filename invariant and lowest-free ` <n>` collision rule. State normalization/case policy and stable-ID separation.
2. Replace fire-and-forget commit language with the confirmed, verifiable receipt contract.
3. Document pre-write audit, allowlisted staging, staged-diff message generation, LFS payload verification, pending uploads, optimistic concurrency, destructive intent, and structured 409 responses.
4. Add read-only receipt verification commands for commit/tree/blob, manifest digest, cached/committed path list, and LFS object availability. Explicitly forbid using `vintage-tokyo` as a fixture.
5. Cross-link the regression spec and this implementation plan.

**Commit:** `docs: align persistence contracts with archive integrity`

## Task 16: Full deterministic and browser verification

**Files:**
- Create or modify only isolated browser fixture/e2e support required by existing test conventions
- Update: `docs/superpowers/plans/2026-07-13-project-save-archive-integrity-and-dangling-clips.md` with verification evidence

**Steps:**
1. Run focused suites first, then `pnpm test`, `pnpm typecheck`, and `pnpm lint`. Fix root causes; do not suppress diagnostics.
2. Start `pnpm dev` and use an isolated fixture project. Record initial commit/tree/blob/manifest identities.
3. Remove one fixture backend original while retaining its pointer/reference. Reload and verify the media item and every dependent clip show persistent accessible missing state.
4. Trigger autosave. Verify `409 MEDIA_INCOMPLETE`, visible failed persistence, unchanged last-good JSON, and no new commit.
5. Relink the original, save, reload, and verify semantic filename/clip title and marker clearing after a confirmed receipt.
6. Open a stale tab, commit a newer edit elsewhere, then attempt a destructive shrink from the stale tab. Verify `PROJECT_CONFLICT` and preservation of the newer full project.
7. Import three same-named files and verify `clip.mp4`, `clip 1.mp4`, and `clip 2.mp4` in both project JSON and storage with stable distinct IDs and unchanged bytes.
8. Inspect the final commit. Verify its message path count, committed paths, receipt identities, manifest digest, and LFS payload state agree exactly.
9. Record commands, fixture path, browser observations, receipt values, and any unverified remote-LFS assumption below this task. No product restart is required beyond restarting the dev processes; state exact commands if configuration changed.

**Commit:** `test: verify project archive integrity end to end`

## Final acceptance checklist

- [ ] `MEDIA_INCOMPLETE` is non-mutating and names every missing semantic file/media ID.
- [ ] `PROJECT_CONFLICT` prevents stale overwrite and reports both revisions.
- [ ] Destructive shrink requires current-base proof plus explicit intent.
- [ ] Save/upload commits contain only the audited allowlist; unrelated files and deletions remain untouched.
- [ ] Commit message and file count exactly match the final staged diff.
- [ ] Receipt commit/tree/project-blob/manifest identities independently resolve and agree.
- [ ] LFS pointer-only state cannot pass original-media durability verification.
- [ ] Persisted basenames equal normalized project filenames; collisions select the lowest free suffix without overwrite.
- [ ] Uploads are pending until atomically attached to a project snapshot.
- [ ] Client upload cache cannot substitute for authoritative content proof.
- [ ] Dangling clips and every media-pane variant show persistent accessible missing state with semantic titles.
- [ ] All fixtures are proven beneath their assigned temporary root before any Git/filesystem mutation.
- [ ] Focused tests, full tests, typecheck, lint, and required browser scenario pass with recorded evidence.

## Important failure modes to re-check during review

- Auditing after replacing `project.json` still permits data loss.
- Resetting the whole index/worktree on transaction failure can destroy unrelated user changes.
- A correct LFS pointer does not prove its payload exists locally or remotely.
- Filename comparison that ignores filesystem case/Unicode behavior can overwrite an existing original.
- Allocating a filename separately from project JSON update can commit mismatched names.
- A session upload cache can become stale after backend deletion, branch change, or failed transaction.
- Generating the message before final staging recreates the incident's truthful-message failure.
- Clearing missing UI state before a confirmed receipt can hide an unpersisted repair.
- Size-only shrink rejection can block legitimate edits; the protected current-base plus explicit-intent path must remain available.
- Integration tests that construct stores before validating their root can repeat the real-project incident.

