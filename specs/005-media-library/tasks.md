# Tasks: Media Library and Import

**Input**: Design documents from `/specs/005-media-library/`  
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Tests**: Required by the feature specification and repository quality gates. Write each regression test first, observe the relevant failure, then implement.

**Organization**: Tasks are grouped by user story and ordered so each story ends in an independently testable increment.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel because it changes a different file and has no dependency on an incomplete task
- **[Story]**: Maps work to a user story in `spec.md`

## Phase 1: Setup and Baseline

**Purpose**: Establish reproducible evidence before changing behavior.

- [X] T001 Run the existing focused media-library suites and record the baseline failures/passes in `specs/005-media-library/quickstart.md`
- [X] T002 Confirm current TypeScript contracts and test scripts for `@openreel/core` and `@openreel/web` in `packages/core/package.json` and `apps/web/package.json`

---

## Phase 2: Foundational Typed Boundaries

**Purpose**: Create shared results and diagnostics required by multiple stories.

**Critical**: Complete before user-story implementation.

- [X] T003 Add discriminated import outcome, import stage, rejection reason, recovery action, dependency summary, and mutation result types in `apps/web/src/services/media-import-outcome.ts`
- [X] T004 [P] Add pure structured diagnostic context/serialization tests in `apps/web/src/services/media-diagnostics.test.ts`
- [X] T005 Implement contextual media diagnostics without raw user-facing stacks in `apps/web/src/services/media-diagnostics.ts`
- [X] T006 Export or import the foundational types only at their owning web boundaries in `apps/web/src/services/media-import-outcome.ts`, `apps/web/src/stores/project-store.ts`, and `apps/web/src/components/editor/media-timeline-insertion.ts`

**Checkpoint**: Import, deletion, and insertion can return explicit data instead of silent control flow.

---

## Phase 3: User Story 1 - Import Durable Media (Priority: P1) MVP

**Goal**: Every submitted file is preflighted, processed independently, and reported as durable, degraded, rejected, or failed with a recovery action.

**Independent Test**: Import a mixed video/audio/image/SRT batch with valid, invalid, oversized, insufficient-capacity, persistence-failed, and handle-failed fixtures; verify ordered itemized outcomes and reload durability.

### Tests for User Story 1

- [X] T007 [P] [US1] Add byte-boundary, capacity, and unsupported-estimate preflight tests that do not allocate GiB payloads in `apps/web/src/services/media-import-policy.test.ts`
- [X] T008 [P] [US1] Add batch-service tests proving preflight rejection precedes the importer and later files can continue in `apps/web/src/services/media-import-batch.test.ts`
- [X] T009 [P] [US1] Add project-store regressions for SRT validation, exact re-import identity, local persistence degradation, metadata preservation, and observable upload failure in `apps/web/src/stores/media-import.test.ts`
- [X] T010 [P] [US1] Add component regressions for ordered batch progress, itemized summary, thrown/returned failures, and handle warnings in `apps/web/src/components/editor/AssetsPanel.test.tsx`

### Implementation for User Story 1

- [X] T011 [US1] Implement configurable 2 GiB preflight policy using file size and optional StorageManager evidence in `apps/web/src/services/media-import-policy.ts`
- [X] T012 [US1] Integrate preflight before media-bridge metadata extraction/thumbnail work and preserve specific validation errors in `apps/web/src/stores/project-store.ts` and `apps/web/src/services/media-import-batch.ts`
- [X] T013 [US1] Make project import/replace persistence return durable or retryable degraded outcomes, reject unusable SRT input, and preserve stable identity/user metadata in `apps/web/src/stores/project-store.ts`
- [X] T014 [US1] Make backend media upload completion/failure observable without blocking local success in `apps/web/src/services/backend-save.ts` and `apps/web/src/stores/project-store.ts`
- [X] T015 [US1] Aggregate every file result, retain filename/index/stage progress, continue after failures, and show an accessible itemized completion summary in `apps/web/src/components/editor/AssetsPanel.tsx`
- [X] T016 [US1] Replace silent dropped-file and directory-handle persistence catches with contextual non-blocking recovery warnings in `apps/web/src/components/editor/AssetsPanel.tsx`

**Checkpoint**: User Story 1 is independently complete when all mixed-batch outcomes are visible and durable successes survive reload.

---

## Phase 4: User Story 2 - Find and Inspect Assets (Priority: P1)

**Goal**: Search, grouping, density, selection, inspection, status, and keyboard access remain correct across mixed libraries.

**Independent Test**: Seed mixed media/status/scene fixtures and verify every search, group, collapse, view, selection, status, and keyboard combination without project mutation.

### Tests for User Story 2

- [X] T017 [P] [US2] Extend search/view/selection/live-region regressions for source name, title, description, tags, group, and empty results in `apps/web/src/components/editor/AssetsPanel.test.tsx`
- [X] T018 [P] [US2] Extend type/status/tag/no-grouping and collapse/expand accessibility coverage in `apps/web/src/components/editor/AssetBuckets.test.tsx`
- [X] T019 [P] [US2] Add inspector coverage for technical metadata, availability, provenance, previews, and safe action availability in `apps/web/src/components/editor/inspector/AssetInspectorWithTabs.preview.test.tsx`

### Implementation for User Story 2

- [X] T020 [US2] Correct any failing search/view/selection semantics and accessible progress/result announcements in `apps/web/src/components/editor/AssetsPanel.tsx`
- [X] T021 [US2] Correct any failing bucket grouping, disabled-state, accessible-name, focus, and keyboard behavior in `apps/web/src/components/editor/AssetBuckets.tsx`
- [X] T022 [US2] Present complete status/technical/provenance information and gate unavailable actions in `apps/web/src/components/editor/asset-manager/AssetDetailShared.tsx` and `apps/web/src/components/editor/inspector/AssetInspectorWithTabs.tsx`

**Checkpoint**: User Story 2 is independently complete when all fixture combinations expose the expected visible set and accessible state.

---

## Phase 5: User Story 3 - Insert Media at the Intended Timeline Position (Priority: P1)

**Goal**: Placement uses captured zero/non-zero time and compatible tracks, while every failure returns actionable evidence without partial selection state.

**Independent Test**: Insert each supported timeline media type with compatible, locked, incompatible, removed, and absent tracks at zero and non-zero positions.

### Tests for User Story 3

- [X] T023 [P] [US3] Add regressions for missing media, failed track creation, removed/locked track, failed clip creation, unchanged selection, and structured error identifiers in `apps/web/src/components/editor/media-timeline-insertion.test.ts`
- [X] T024 [P] [US3] Add timeline drag/drop contract regressions for compatibility and surfaced failure in `apps/web/src/components/editor/timeline/media-drop.test.ts` and `apps/web/src/components/editor/timeline/TrackLane.media-drop.test.tsx`

### Implementation for User Story 3

- [X] T025 [US3] Return typed insertion success/failure, preserve captured time including zero, revalidate asynchronous track state, and delay UI selection mutation until clip success in `apps/web/src/components/editor/media-timeline-insertion.ts`
- [X] T026 [US3] Surface insertion failures with media/track identifiers and recovery guidance from library callers in `apps/web/src/components/editor/AssetsPanel.tsx`
- [X] T027 [US3] Apply the same insertion result and failure contract to timeline drop callers in `apps/web/src/components/editor/timeline/media-drop.ts` and `apps/web/src/components/editor/timeline/TrackLane.tsx`

**Checkpoint**: User Story 3 is independently complete when every deterministic placement succeeds exactly once or returns an actionable failure with no misleading state.

---

## Phase 6: User Story 4 - Recover Missing or Changed Sources (Priority: P2)

**Goal**: Verification and relinking distinguish absence from transient failure, reject stale results, preserve stable IDs, and report every ambiguous/unmatched/failed item.

**Independent Test**: Exercise available, missing, transient, offline, cancelled, malformed, wrong-type, truncated, timeout, stale, exact-match, partial-match, and ambiguous relink fixtures.

### Tests for User Story 4

- [X] T028 [P] [US4] Retain and extend verification classification, timeout/cancellation, bounded work, and stale project/generation/URL tests in `apps/web/src/services/media-verification.test.ts`
- [X] T029 [P] [US4] Add missing-only lifecycle regressions independent of current search results in `apps/web/src/components/editor/AssetsPanel.test.tsx`
- [X] T030 [P] [US4] Add exact, partial, failed, and ambiguous folder-relink result tests with stable IDs in `apps/web/src/services/media-storage.test.ts`

### Implementation for User Story 4

- [X] T031 [US4] Preserve authoritative verification classification and add any missing structured diagnostics without weakening stale-result guards in `apps/web/src/services/media-verification.ts`
- [X] T032 [US4] Extract deterministic filename-plus-size candidate resolution that refuses ambiguous matches in `apps/web/src/services/media-storage.ts`
- [X] T033 [US4] Report linked, unmatched, ambiguous, and failed relink counts while preserving media IDs and turning off resolved missing-only mode in `apps/web/src/components/editor/AssetsPanel.tsx`

**Checkpoint**: User Story 4 is independently complete when no transient result becomes missing and no ambiguous relink is silently chosen.

---

## Phase 7: User Story 5 - Organize and Manage Assets Safely (Priority: P2)

**Goal**: Metadata, download, workflow association, replace, and deletion preserve identity and block destructive dependency breakage.

**Independent Test**: Edit normalized metadata, download available bytes, replace an asset, and attempt deletion with zero, timeline, and protected-workflow dependencies plus cleanup failure.

### Tests for User Story 5

- [X] T034 [P] [US5] Add dependency-summary, blocked deletion, undo/redo deletion, and cleanup-failure regressions in `apps/web/src/stores/delete-media-asset.test.ts`
- [X] T035 [P] [US5] Extend replacement tests for stable IDs, user metadata, version/generation provenance, and timeline references in `apps/web/src/stores/replace-media-asset.test.ts`
- [X] T036 [P] [US5] Add keyboard tag normalization, immutable filename, save-failure retention, and action availability tests in `apps/web/src/components/editor/asset-manager/AssetDetailShared.test.tsx`

### Implementation for User Story 5

- [X] T037 [US5] Implement typed dependency discovery and block referenced media deletion before project mutation in `apps/web/src/stores/project-store.ts`
- [X] T038 [US5] Keep project deletion undoable, run blob cleanup only after model success, and return cleanup-failed separately in `apps/web/src/stores/project-store.ts`
- [X] T039 [US5] Present dependency counts, cleanup failures, metadata save failures, and only valid download/replace/delete actions in `apps/web/src/components/editor/asset-manager/AssetDetailShared.tsx`
- [X] T040 [US5] Preserve normalized user metadata, immutable source filename, stable IDs, provenance, and references through save/replace operations in `apps/web/src/stores/project-store.ts`

**Checkpoint**: User Story 5 is independently complete when referenced assets cannot be deleted and every permitted mutation remains recoverable and visible.

---

## Phase 8: Polish and Cross-Cutting Verification

**Purpose**: Prove the complete feature and capture traceable evidence.

- [X] T041 Run focused deterministic suites from `specs/005-media-library/quickstart.md` and resolve every regression in the affected source/test files
- [X] T042 Run `@openreel/web` TypeScript checking and resolve diagnostics in all media-library changed files
- [X] T043 Run affected-test analysis and the repository-required affected suites for all changed source files
- [X] T044 [DEFERRED 2026-07-22] Browser verification for mixed import outcomes, keyboard navigation, zero-time insertion, referenced deletion, and relink recovery was explicitly deferred by the user because no browser backend is currently available; retain the scenarios in `quickstart.md` for later sign-off
- [X] T045 Update executed commands, observed results, failure-mode evidence, and any environment limitation in `specs/005-media-library/quickstart.md`
- [X] T046 Run a focused code review for requirement coverage, silent failure paths, and unintended cross-feature changes across the media-library diff

---

## Dependencies and Execution Order

### Phase Dependencies

- **Setup**: starts immediately.
- **Foundational**: depends on setup and blocks all mutation/result changes.
- **US1, US2, US3**: start after foundational; US2 test work is independent, while its final UI integration follows US1 result-state changes in `AssetsPanel.tsx`.
- **US4**: starts after foundational; final `AssetsPanel.tsx` integration follows US1.
- **US5**: starts after foundational; independent store tests can run alongside US3/US4.
- **Polish**: depends on all selected user stories.

### User Story Dependencies

- **US1**: no story dependency; MVP.
- **US2**: existing behavior is independently testable; final panel edits integrate after US1.
- **US3**: typed foundation only; caller edit in `AssetsPanel.tsx` follows US1.
- **US4**: verification tests are independent; relink UI summary follows US1 batch-result patterns.
- **US5**: typed foundation only; no dependency on US2-US4.

### Parallel Opportunities

- T004, T007-T010 can be written in separate files in parallel.
- T017-T019 cover separate UI units in parallel.
- T023-T024 cover helper and drag/drop callers in parallel.
- T028-T030 cover verification, panel lifecycle, and storage matching in parallel.
- T034-T036 cover store deletion, replacement, and metadata UI in parallel.
- After foundational types, US3 and US5 can proceed independently of US2 and the service portion of US4.

## Parallel Examples

### User Story 1

```text
T007: preflight policy tests
T008: core service preflight ordering tests
T009: project-store durability tests
T010: AssetsPanel batch feedback tests
```

### User Story 4

```text
T028: verification classification tests
T029: missing-only UI lifecycle tests
T030: relink candidate-resolution tests
```

### User Story 5

```text
T034: deletion safety tests
T035: replacement preservation tests
T036: metadata/action UI tests
```

## Implementation Strategy

### MVP First

1. Complete T001-T006.
2. Complete T007-T016 using red-green-refactor.
3. Validate mixed-batch import and reload durability independently.

### Incremental Delivery

1. Deliver explicit durable import outcomes.
2. Lock existing library discovery/accessibility behavior with US2.
3. Replace silent insertion failures with typed outcomes.
4. Harden relinking while preserving current verification guarantees.
5. Block destructive deletion and complete metadata management evidence.
6. Run full focused verification and browser scenarios.

## Notes

- Keep all tests deterministic, local, non-flaky, and preferably under two seconds.
- Expected domain failures return typed outcomes; cancellation stays distinct from failure.
- Do not weaken existing stale-result, stable-ID, or undo/redo guarantees to satisfy new tests.
- Commit coherent verified groups and never stage unrelated worktree changes.
