# Project save/archive integrity: Task 8 onward handoff

Date: 2026-07-13

## Objective

Continue and finish Task 12A through Task 16 in:

`docs/superpowers/plans/2026-07-13-project-save-archive-integrity-and-dangling-clips.md`

Tasks 8 through 12 are implemented, reviewed, tested, and committed. Task 12A is partially implemented and uncommitted. Tasks 13 through 16 have not started.

## Mandatory startup

Before repository exploration:

1. Call Serena `initial_instructions`.
2. Activate `/Volumes/Joseph/Projects1/ai-agents/openreel-video`.
3. Confirm Hindsight is present in session context. Do not use Serena memory tools.
4. Do not use the TokenSave/code graph currently configured for this checkout. It reported that its index belongs to `/Volumes/Joseph/Projects1/ai-agents/pi-inbox`, so its results are stale for this repository.
5. Use `rtk` before every shell command.
6. Preserve all unrelated dirty files listed below.

Use mini subagents for bounded implementation tasks. Review and independently rerun their focused tests before committing.

## Git state

Branch: `feature/backend-autosave-git-lfs`

Task 12A implementation base before this handoff-only commit: `aa0bbdc`. Run `rtk git log -1 --oneline` for the current HEAD.

The branch is ahead of `origin/feature/backend-autosave-git-lfs` by 8 commits. The Task 8 onward commits have not been pushed.

Task commits:

- `169d5c8 feat(orchestrator): verify archived Git LFS media payloads`
- `92575cb fix(orchestrator): make project saves atomic and conflict safe`
- `abd4928 fix(orchestrator): guard destructive project shrink saves`
- `9b19fd2 fix(orchestrator): attach media uploads to snapshot commits`
- `aa0bbdc fix(web): reconcile incomplete and stale project saves`

Earlier relevant commits already on the branch:

- `8ae2bcb feat(core,web): add shared project persistence contracts`
- `83d4b89 feat(orchestrator): audit media manifests before project saves`
- `eac6add docs: refresh regression notes and plan audits`

## Completed work and evidence

### Task 8: Git LFS payload verification

Implemented committed pointer validation, local LFS object size/SHA-256 checks, explicit remote states, receipt evidence, and digest separation.

Evidence:

- LFS + media manifest focused suite: 10/10 passed independently.
- Route and core persistence tests passed during implementation.
- Orchestrator typecheck passed.

Important design:

- Canonical media manifest digest excludes machine-dependent LFS availability.
- LFS pointer presence alone does not prove the object.
- Index pointer verification was later added by Task 11 for pre-ref pending-media commits.

### Task 9: atomic optimistic save transaction

Implemented the shared Git project lock, typed conflict responses, allowlisted staging, receipt verification, and a fsynced recovery journal.

Evidence:

- Save transaction tests: 8/8 passed independently.
- Route tests: 9/9 at Task 9, later expanded.
- Orchestrator typecheck passed.

Important design:

- `GitStore.withProjectTransaction()` holds the same lock used by ordinary Git commits and supplies non-reentrant transaction operations.
- The journal recovers process loss before ref update by restoring prior JSON and after ref update by publishing the confirmed target blob.
- Recovery unstages only transaction-owned paths and preserves unrelated worktree/index state.

### Task 10: destructive shrink guard

Implemented negative-delta thresholds for media, clip, track, and serialized structural size. Protected changes require current-base proof plus `saveIntent: "user"` and `destructiveIntent: true`, or an exact internal removal/reference manifest.

Evidence:

- Destructive guard + transaction suite: 13/13 passed independently.
- Core and orchestrator typechecks passed.

Policy constants are 3 media, 3 clips, 1 track, and 16 KiB structural loss. Equality is allowed; threshold plus one is protected.

### Task 11: pending media attachment

Uploads now remain under `.openreel-pending-media` until a typed save claims them. Save-time allocation uses the existing NFC/case-safe lowest-free semantic filename allocator, preserves media IDs, stages media under the shared lock, verifies LFS pointers from the index before ref update, and commits project JSON plus media atomically.

Evidence independently rerun by the parent:

- Transaction/LFS/manifest/pending tests: 21/21 passed.
- Route tests: 11/11 passed.
- Typecheck passed during subagent verification.

The real Git LFS integration proves one commit, stable ID, `Interview 1.mp4` collision allocation, committed pointer OID/size, local LFS object integrity, `git lfs fsck --objects`, allowlist isolation, and crash recovery back to pending state.

Known low-priority limitation: upload type validation trusts multipart MIME metadata and exact byte count rather than magic-byte container sniffing.

### Task 12: web save reconciliation

Implemented exact remote proof before PUT, confirmed base revisions, explicit save intent, one bounded `MEDIA_INCOMPLETE` recovery retry, conflict preservation, canonical filename reconciliation after full receipt validation, and load/create/import receipt handoff.

Evidence independently rerun by the parent:

- `apps/web/src/services/backend-save.test.ts`: 30/30 passed.
- `apps/orchestrator/src/projects/routes.test.ts`: 13/13 passed.
- Web and orchestrator typechecks passed during subagent verification.

Important design:

- Any successful HEAD is not enough. Exact origin/path, expected content length, and compatible non-HTML MIME metadata are required.
- Completed upload IDs do not authorize skipping proof. Only in-flight upload promises coalesce requests.
- Receipt identity, canonical project ID/time, LFS local state, and all commit fields are validated before local filename mutation or base advancement.
- GET/create/import return a confirmed receipt so a real session has a base revision before its first PUT.

## Current uncommitted Task 12A work

These files belong to Task 12A:

- New: `packages/core/src/media-availability.ts`
- New: `packages/core/src/media-availability.test.ts`
- Modified: `packages/core/src/index.ts`
- Modified: `apps/orchestrator/src/projects/routes.ts`
- Modified: `apps/orchestrator/src/projects/routes.test.ts`
- New: `apps/web/src/services/media-verification.ts`
- New: `apps/web/src/services/media-verification.test.ts`
- Modified: `apps/web/src/services/backend-save.ts`

Do not discard this work. Review the diff before editing.

Implemented so far:

- Shared runtime states/evidence contract.
- Batch endpoint currently named `POST /api/projects/:id/verify-media`. It was moved from `/api/projects/:id/media/verify` because the existing parameterized media route captured the latter path. Reassess route ordering/naming, but do not reintroduce the collision.
- Endpoint reloads project mapping and performs a fresh media scan/stat/size proof.
- Web verifier supports batch proof, HEAD-to-range fallback, HTML/wrong MIME/bad range/zero/truncated rejection, deduplication, bounded concurrency, cancellation, retry/backoff/jitter, and generation plus URL guards.
- Availability state is kept in a sidecar `Map`, not in `Project` or `MediaItem` serialization.
- `BackendSaveService.load` calls the runtime verifier before hydration.
- Thumbnail failure is log-only/non-missing; decode failure has a distinct sidecar state.

Last reported tests:

- Core targeted test: 1/1 passed.
- Web media verification tests: 9/9 passed after deterministic cancellation timing fixes.
- Orchestrator typecheck passed.
- The new route suite was 13/14 before the endpoint collision fix. The rerun after renaming to `/:id/verify-media` was interrupted and must be run first.
- Web typecheck was blocked only by unrelated concurrent edits in `apps/web/src/features/generation/audio/audio.test.ts` (`TS2307 Cannot find module '.'`). Do not fix or include that unrelated work unless Joseph explicitly asks.

Required immediate commands:

```bash
rtk pnpm --filter @openreel/orchestrator exec tsx --test src/projects/routes.test.ts
rtk pnpm --filter @openreel/web exec vitest run src/services/media-verification.test.ts
rtk pnpm --filter @openreel/core exec vitest run src/media-availability.test.ts
rtk pnpm --filter @openreel/orchestrator exec tsc --noEmit
rtk pnpm --filter @openreel/web exec tsc --noEmit
```

The route test may need sandbox escalation because tsx can create an IPC pipe.

## Task 12A gaps that must be closed before commit

The Task 12A mini subagent explicitly reported these gaps:

1. No UI consumer/subscription yet exposes availability state.
2. No explicit post-load background callback rehydrates Blob/source/thumbnail after recovery once `load()` has returned.
3. Tests do not separately cover 401, 403, and 5xx batch payload mapping.
4. Confirm dangling clip IDs absent from the media library are handled consistently with Task 13 rather than silently omitted from verification.
5. Confirm timeout, DNS/refusal/CORS-like errors, abort, offline/HMR, stale project, stale generation, dedupe across multiple clips, and relink races each have deterministic assertions.
6. Confirm runtime availability is absent from sanitized/autosave JSON with a direct serialization test.
7. Confirm recovery cannot overwrite a newer relink and atomically updates all runtime consumers.
8. Run Serena diagnostics on every Task 12A file after the concurrent unrelated web changes settle.

Do not commit Task 12A until these are resolved and focused tests plus both relevant typechecks pass. Browser behavior is still required later.

## Unrelated dirty files: preserve and exclude

The following dirty/untracked files are not part of Tasks 8–12A and appeared from user/concurrent work. Do not modify, stage, commit, or clean them:

- `.pi/inbox.md`
- `.serena/project.yml`
- `.claude/settings.local.json`
- `.serena/memories/`
- `apps/orchestrator/src/services/generation/uploads.ts`
- `apps/orchestrator/src/services/generation/uploads.test.ts`
- `apps/orchestrator/src/routes/wavespeed.test.ts`
- `apps/web/src/features/generation/audio/index.ts`
- `apps/web/src/features/generation/audio/audio.test.ts`
- `docs/spec/wavespeed-generation.md`
- `docs/superpowers/plans/2026-07-10-wavespeed-generation.md`
- `apps/web/vite.config.ts.timestamp-1783823302424-53318d7e202578.mjs`

Always stage explicit Task files only.

## Remaining plan sequence

### Finish Task 12A

Close the gaps above, independently review, run focused tests/typechecks, then commit:

`fix(web): distinguish media outages from confirmed absence`

### Task 13: timeline dangling clips

Use the `build-web-apps:react-best-practices` and `ui-ux-pro-max` skills because this changes React UI/state/accessibility. Read each full `SKILL.md` before task actions and announce skill use.

Required outcomes include:

- Every clip with no media row or `confirmed_missing` is persistently marked.
- Semantic last-confirmed manifest title where available; never UUID prefix as primary label.
- Distinct verifying, temporarily unavailable, unauthorized, decode error, and missing states/actions.
- Relink becomes primary only for confirmed missing.
- Markers clear only after relink plus confirmed receipt.
- Multiple clips, compact rendering, accessible name/description tests.
- Browser reproduction and verification are mandatory before claiming the UI fix complete.

Commit:

`fix(web): expose dangling timeline media references`

### Task 14: media views and missing-only filtering

Continue using the React and UI/UX skills.

Create one shared selector/view model and use it across grid, list, grouped media, search, missing-only, timeline, preview, inspector, and Problems. Only `confirmed_missing` enters missing count/filter; transient/unauthorized/decode states do not. Verify one-item/all retry actions do not mutate semantic project data.

Run affected web tests, web typecheck, and browser verification.

Commit:

`fix(web): keep missing media visible across editor views`

### Task 15: documentation and runbook

Update the exact files listed in the plan. Create:

`docs/runbooks/project-save-integrity-verification.md`

Document semantic naming, lowest-free suffix, confirmed receipt contract, pre-write audit, allowlist staging, staged-diff message, LFS proof, pending uploads, concurrency, destructive intent, 409s, authoritative verification, and runtime-only availability.

The runbook must contain read-only receipt verification commands and explicitly forbid `vintage-tokyo` as a fixture.

Commit:

`docs: align persistence contracts with archive integrity`

### Task 16: full deterministic and browser verification

Follow every step in the plan. Browser verification is non-negotiable.

Known approved browser workflow in this environment:

- Start the app with `pnpm dev` on port 5173, using `rtk`.
- Chrome/CDP helper commands have previously been approved:
  - `node scripts/chrome-cdp.mjs`
  - `node /tmp/openreel-cdp.mjs`
  - headless Chrome at port 9223 for `http://localhost:5173/editor?...`

Use an isolated temporary fixture. Never use `vintage-tokyo`. Prove the fixture root before any Git/filesystem mutation.

Run focused suites first, then full `pnpm test`, `pnpm typecheck`, and `pnpm lint`. The repository has previously lacked a usable ESLint 9 config in package-local attempts; diagnose the root command before claiming lint unavailable. Do not suppress failures.

Record commands, fixture, receipt identities, browser observations, LFS assumptions, and acceptance checklist evidence in the implementation plan under Task 16.

Commit:

`test: verify project archive integrity end to end`

Finally push the branch without bypassing hooks.

## Known environment/test behavior

- Git LFS 3.7.1 is installed.
- Node 26.5.0 has intermittently crashed in combined parallel node:test runs with `InternalCallbackScope::Close` async-id assertions. The same route suites pass when run alone. Treat application assertion failures as real; isolate suites to distinguish the native runner crash.
- Some HTTP route tests can fail with sandbox `listen EPERM` when run concurrently. Rerun the exact suite alone or request escalation.
- Never use `git reset --hard`, broad checkout, or whole-index/worktree reset.

## Completion standard

For each task:

1. Review the mini subagent diff, do not accept its report at face value.
2. Independently rerun focused deterministic tests.
3. State why it is correct and important failure modes.
4. Stage only task-owned files.
5. Make the named atomic conventional commit.

Final status must use exactly one of `DONE`, `DONE_WITH_CONCERNS`, `BLOCKED`, or `NEEDS_CONTEXT`, include restart commands, and identify every unverified assumption.
