# Tasks: Project Lifecycle and Persistence

**Input**: Implementation-aligned review of `specs/001-project-lifecycle/` and the installed codebase.

**Current outcome**: Preserve the proven managed-workspace persistence architecture and correct only faults that can lose work, save an incomplete snapshot, or apply one project's work/status to another project.

## Reconciliation rule

- `[x]` means repository evidence and deterministic tests prove the behavior exists.
- Unbuilt enhancements that are not necessary for minimal correct operation are listed under Future Scope without active task checkboxes.
- Every production correction below followed red-green-refactor and retains its focused regression.

## Phase 1: Proven existing implementation

- [x] T001 Stable backend-confirmed project creation and canonical managed-workspace identity are implemented in `apps/web/src/stores/project-store.ts` and `apps/web/src/services/backend-save.ts`.
- [x] T002 Atomic journaled saves, rollback, crash recovery, and base-revision conflict rejection are implemented and covered in `apps/orchestrator/src/projects/save-transaction.test.ts` and `apps/orchestrator/src/projects/routes.test.ts`.
- [x] T003 Required-media verification, explicit missing-media state, and preservation of unresolved references are implemented in the orchestrator and web media-verification paths.
- [x] T004 Automatic semantic Git versions, newest-first history, and read-only historical retrieval are implemented and covered by the orchestrator persistence tests.
- [x] T005 Project discovery by stable identity, name, and modification time is implemented by `BackendSaveService.listProjects` and the existing project chooser.
- [x] T006 Rotating IndexedDB recovery records and recovery discovery are implemented by `AutoSaveManager`.
- [x] T007 Plain project-data import/export and legacy normalization are implemented by `ProjectManager` and `ProjectSerializer`; stricter future-format validation is deferred below.
- [x] T008 The Spec Kit task bootstrap regression is implemented in `.specify/scripts/bash/setup-tasks.test.sh`.

## Phase 2: Critical minimal-correctness corrections

These items are critical because failure can misreport durable state, lose a queued edit, persist an incomplete user snapshot, or apply one project's completion to another project.

- [x] T009 Add the authoritative confirmed-receipt dirty-state truth table and `isProjectDirty` in `apps/web/src/stores/persistence-status-store.test.ts` and `apps/web/src/stores/persistence-status-store.ts`.
- [x] T010 Make explicit Save reuse the complete engine-backed snapshot, await local recovery persistence, await `backendSaveService.save(snapshot, "user")`, identify the project on failure, and propagate rejection in `apps/web/src/stores/project-store.ts`.
- [x] T011 Add a typed autosave completion payload and reject a completion whose project identity differs from the active project in `apps/web/src/services/auto-save.ts` and `apps/web/src/stores/project-store.ts`.
- [x] T012 Replace the singleton scheduled snapshot with project-ID-keyed queue state, capture each originating base revision, preserve independent retries, and project only active-project status in `apps/web/src/services/backend-save.ts`.
- [x] T013 Stop project creation from clearing another project's queued persistence before the backend confirms the new project in `apps/web/src/stores/project-store.ts`.
- [x] T014 Warn before browser unload when an explicitly created project differs from its confirmed durable receipt in `apps/web/src/hooks/useProjectUnloadGuard.ts` and `apps/web/src/App.tsx`.

## Phase 3: Verification and delivery

- [x] T015 Run the focused core/web lifecycle suites and record exact pass/fail/skip counts in `specs/001-project-lifecycle/quickstart.md`.
- [x] T016 Run the proven orchestrator atomic-save, conflict, history, and migration suites and record exact results.
- [x] T017 Run the web TypeScript compiler and resolve every lifecycle-related diagnostic.
- [x] T018 Verify in the real browser that explicit Save waits for durable confirmation, a queued project-A save survives opening/creating project B without changing B's status, and dirty refresh/close requests a browser confirmation.
- [x] T019 Run `rtk git diff --check`, confirm no Future Scope production code leaked into the change, and update the Time Machine queue status.

## Future Scope

The following missing work is intentionally deferred because the installed system can operate correctly without it:

- Save / Discard / Cancel replacement dialogs and a generalized transition-request store. Current scope preserves edits through project-bound automatic persistence and warns before dirty browser unload.
- Rich stale-conflict summary, export/reload/keep-editing dialog, and semantic entity/field-level merge or difference review. Current canonical storage already rejects stale writes without overwriting the newer durable revision.
- A new strict portable/recovery file envelope decoder, future-version rejection, exhaustive 100-element round-trip fixture, and packaged-media/checksum exports.
- Recovery hardening that offers only a validated newer same-project record and installs it as local unsaved state without immediate durable recovery save.
- Independent project-source error panels and Retry controls in the chooser.
- New lifecycle Playwright coverage for every deferred dialog/recovery/import scenario and mobile/accessibility polish specific to those new surfaces.
- Open/save percentile instrumentation and usability-study success criteria.
- An independent durable project worker, cross-session listener notifications, separately persisted worker progress, and worker-triggered version policy.
- Named durable snapshots and restoration UI.
