# Tasks: DaVinci Resolve and iMovie Export

**Input**: Design documents from `/specs/006-resolve-imovie-export/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Tests**: Required by the feature specification and repository quality gates. Each deterministic, integration, and browser test task is placed before the implementation it constrains and MUST be run and observed failing for the intended reason.

**Organization**: Tasks are grouped by user story so each target workflow can be implemented and validated as an independent increment after the shared foundation.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel with other tasks after its phase prerequisites because it changes different files and does not depend on incomplete work in the same phase
- **[Story]**: User story served by the task (`US1`, `US2`, or `US3`)
- Every task names the exact file or directory it changes or verifies

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Add the one researched dependency without changing existing export behavior.

- [ ] T001 Add `@xmldom/xmldom` 0.9.x to `packages/core/package.json` and update `pnpm-lock.yaml`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Build the deterministic contracts, planning primitives, cancel-safe coordinator shell, and target-selection UI required by every user story.

**Critical**: Complete this phase before starting a user-story phase.

- [ ] T002 Define and export typed targets, selections, timebases, plans, assessments, issues, artifacts, progress, results, and errors from `packages/core/src/export/handoff/types.ts`, `packages/core/src/export/handoff/index.ts`, and `packages/core/src/export/index.ts`
- [ ] T003 Create reusable project, range, media-availability, and expected-issue fixtures without binary assets in `packages/core/src/export/handoff/__fixtures__/projects.ts`
- [ ] T004 [P] Add and run failing integer, 23.976/29.97/59.94, boundary-tie, invalid-rate, rational-reduction, and 60-minute drift tests in `packages/core/src/export/handoff/timebase.test.ts` (covers FR-006, SC-002)
- [ ] T005 Implement canonical frame-rate normalization and rational frame/second conversion in `packages/core/src/export/handoff/timebase.ts`
- [ ] T006 [P] Add and run failing full/ranged projection, boundary trim, gap, empty intersection, hidden-video, muted-audio, and source-offset tests in `packages/core/src/export/handoff/project-range.test.ts` (covers FR-004, FR-005, FR-012)
- [ ] T007 Implement selected-range projection with end-derived positive durations in `packages/core/src/export/handoff/project-range.ts`
- [ ] T008 [P] Add and run failing target-profile and stable issue-order tests covering every supported, warning, flattened-only, and blocking feature code in `packages/core/src/export/handoff/compatibility.test.ts` (covers FR-008, FR-009, FR-010, FR-011, SC-004)
- [ ] T009 Implement pure compatibility assessment, stale-project detection, media availability hints, and deterministic issue sorting in `packages/core/src/export/handoff/compatibility.ts`
- [ ] T010 [P] Add and run failing deterministic naming, case-insensitive collision, URL-encoding, and raw/encoded traversal rejection tests in `packages/core/src/export/handoff/media-map.test.ts` (covers FR-014)
- [ ] T011 Implement collision-safe media names and `Media/`-contained relative references in `packages/core/src/export/handoff/media-map.ts`
- [ ] T012 [P] Add and run failing exact-build candidate, empty advertised-support set, evidence-gated promotion, target-mode, contract-version, and immutable iMovie setting tests in `packages/core/src/export/handoff/target-profiles.test.ts` (covers FR-001, FR-003, FR-020)
- [ ] T013 Define Resolve and iMovie contract baselines, exact-build candidate metadata, and empty advertised-support sets that cannot be promoted without a passing matrix row in `packages/core/src/export/handoff/target-profiles.ts`
- [ ] T014 [P] Add and run failing typed-boundary, phase-transition, monotonic-progress, stale-assessment, cancellation, and terminal-state tests in `apps/web/src/services/export-handoff.test.ts` (covers FR-016, FR-017, FR-018, SC-007)
- [ ] T015 Implement the `HandoffOperation` state machine, `AbortController` checks, media-resolution ports, destination ports, progress callbacks, and typed failures in `apps/web/src/services/export-handoff.ts`
- [ ] T016 [P] Add and run failing target-label, editable-versus-flattened explanation, full/range selection, exact three-primary-activation start path, preflight, progress, cancel, and completion-state tests in `apps/web/src/components/editor/HandoffExportDialog.test.tsx` (covers FR-001, FR-004, FR-008, FR-017, SC-005)
- [ ] T017 Create the accessible target/range/preflight/progress shell in `apps/web/src/components/editor/HandoffExportDialog.tsx`
- [ ] T018 [P] Add and run failing toolbar entry-point and existing-export-regression assertions in `apps/web/src/components/editor/Toolbar.test.tsx` (covers FR-019, SC-008)
- [ ] T019 Wire the handoff dialog into the existing export controls without changing generic exports in `apps/web/src/components/editor/Toolbar.tsx`

**Checkpoint**: Core planning is deterministic, the shared coordinator cannot report cancelled or partial work as complete, and both handoff modes are visible and accurately labeled.

---

## Phase 3: User Story 1 - Continue Editing in DaVinci Resolve (Priority: P1) 🎯 MVP

**Goal**: Produce an editable FCPXML 1.10 sequence plus collected media and a compatibility report that imports into a supported Resolve version with timing accurate to one frame.

**Independent Test**: Export a representative multi-video/multi-audio project containing trims, gaps, repeated media, hidden video, and muted audio; import the folder into a Resolve 20.3.2 build 20.3.20009 candidate; compare resolution, frame rate, lanes, clip order, range trims, source offsets, and audio synchronization to OpenReel within one frame.

### Tests for User Story 1

- [ ] T020 [P] [US1] Add deterministic multitrack source data and the reviewed FCPXML/report golden outputs in `packages/core/src/export/handoff/__fixtures__/projects.ts` and `packages/core/src/export/handoff/__fixtures__/expected/basic-multitrack.fcpxml` and `packages/core/src/export/handoff/__fixtures__/expected/compatibility-report.md`
- [ ] T021 [P] [US1] Add and run failing XML parse, FCPXML version, resource-ID/ref, rational-time, lane, positive-duration, contained-URL, selected-range, repeated-export equivalence, and golden-fixture tests in `packages/core/src/export/handoff/fcpxml.test.ts` (covers FR-002, FR-005, FR-006, FR-015, SC-001, SC-002)
- [ ] T022 [P] [US1] Add and run failing deterministic Markdown report tests for project, target, range, artifacts, warnings, blocking or flattened-only items, and result in `packages/core/src/export/handoff/report.test.ts` (covers FR-013)
- [ ] T023 [US1] Implement deterministic FCPXML 1.10 DOM construction and serialization in `packages/core/src/export/handoff/fcpxml.ts`
- [ ] T024 [US1] Implement the human-readable compatibility report serializer in `packages/core/src/export/handoff/report.ts`
- [ ] T025 [P] [US1] Add and run failing Resolve tests for recovery-order media resolution, one streamed copy per media ID, directory collision confirmation, write ordering, permission denial, copy failure, and close-before-complete in `apps/web/src/services/export-handoff.test.ts`
- [ ] T026 [US1] Implement Resolve directory selection, sanitized nested writes, streamed media collection, FCPXML/report commits, and structured redacted events in `apps/web/src/services/export-handoff.ts`
- [ ] T027 [P] [US1] Add and run failing Resolve-ready, Resolve-blocked, selected-range, progress, cancel, retry, artifact, and report-download UI tests in `apps/web/src/components/editor/HandoffExportDialog.test.tsx`
- [ ] T028 [US1] Implement Resolve assessment, folder-choice, progress, result, retry, and report presentation in `apps/web/src/components/editor/HandoffExportDialog.tsx`
- [ ] T029 [US1] Add a deterministic end-to-end coordinator integration test for complete and selected-range Resolve folders plus two unchanged exports with equivalent structure, media mapping, artifact names, and report ordering in `apps/web/src/test/export-handoff.integration.test.ts`
- [ ] T030 [US1] Add Playwright coverage for ready Resolve handoff, selected-range boundary trims, directory adapter behavior, cancellation, and completed artifacts in `apps/web/e2e/export-handoff.spec.ts`
- [ ] T031 [US1] Verify the Resolve 20.3.2 build 20.3.20009 candidate and record its exact build, OS, fixture hashes, import result, one-frame timing comparison, screenshots, recordings, verifier, date, and known limitations in `docs/export-compatibility.md`

**Checkpoint**: User Story 1 is independently usable and is the suggested MVP.

---

## Phase 4: User Story 2 - Continue Editing in iMovie (Priority: P2)

**Goal**: Produce a clearly labeled flattened MOV with the rendered picture and mixed audio that imports directly into supported iMovie versions while preserving project dimensions, orientation, rate, range, and duration.

**Independent Test**: Export horizontal, vertical, and square projects with picture and mixed audio; import each MOV into a exact iMovie candidate build on macOS; verify import, playback, dimensions, orientation, frame rate, duration, and synchronized audible audio.

### Tests for User Story 2

- [ ] T032 [P] [US2] Add and run failing immutable MOV/H.264/AAC, `video/quicktime`, frame-rate, dimension, audio-mix, and selected-range profile tests in `packages/core/src/export/handoff/imovie-profile.test.ts` (covers FR-003, FR-007, SC-003)
- [ ] T033 [US2] Implement the iMovie target profile adapter without changing generic MOV/MP4 behavior in `packages/core/src/export/handoff/imovie-profile.ts`
- [ ] T034 [P] [US2] Add and run failing iMovie-profile and existing-generic-export regression cases in `packages/core/src/export/export-engine.test.ts`
- [ ] T035 [P] [US2] Add and run failing coordinator tests for immutable profile forwarding, full/range render, save cancellation, write failure, writable close, safe filename, and report availability in `apps/web/src/services/export-handoff.test.ts`
- [ ] T036 [US2] Route iMovie operations through the existing `ExportEngine.exportVideo()` render and single-file save path in `apps/web/src/services/export-handoff.ts`
- [ ] T037 [P] [US2] Add and run failing flattened-mode explanation, dimensions/orientation, progress, cancellation, completion, and report-download tests in `apps/web/src/components/editor/HandoffExportDialog.test.tsx`
- [ ] T038 [US2] Implement the iMovie flattened-handoff states and completion details in `apps/web/src/components/editor/HandoffExportDialog.tsx`
- [ ] T039 [US2] Add deterministic horizontal, vertical, square, mixed-audio, and selected-range integration coverage in `apps/web/src/test/export-handoff.integration.test.ts`
- [ ] T040 [US2] Add Playwright coverage for iMovie target selection, flattened explanation, file-save adapter, cancellation, visible failure, and completion in `apps/web/e2e/export-handoff.spec.ts`
- [ ] T041 [US2] Verify an exact installed iMovie candidate and record its exact build, OS, MOV hashes, import/playback results, media properties, screenshots, recordings, verifier, date, and known limitations in `docs/export-compatibility.md`

**Checkpoint**: User Stories 1 and 2 both work independently from the shared foundation.

---

## Phase 5: User Story 3 - Resolve Compatibility Problems Before Export (Priority: P3)

**Goal**: Show every material compatibility problem before writing, block unsafe handoffs, identify affected entities, explain flattened-only outcomes, and make failures actionable without leaking private paths or URLs.

**Independent Test**: Assess projects containing missing blobs/handles/URLs, permission denial, invalid timing, transitions, transforms, non-unit speed, and mixed supported/unsupported edits; verify stable complete issue coverage, no destination prompt or write when blocked, actionable entity-specific guidance, safe retryability, and no secret-bearing diagnostics.

### Tests for User Story 3

- [ ] T042 [P] [US3] Add contract tests that validate ready, blocked, cancelled, and failed compatibility report objects against `specs/006-resolve-imovie-export/contracts/compatibility-report.schema.json` in `packages/core/src/export/handoff/report.test.ts`
- [ ] T043 [P] [US3] Add failure-injection tests for missing media, denied handle permission, failed URL verification, invalid timing, unsupported edits, stale project, copy/render/save failures, retryability, and abort boundaries in `apps/web/src/services/export-handoff.test.ts` (covers FR-008, FR-010, FR-011, FR-016, FR-018, SC-004, SC-007)
- [ ] T044 [P] [US3] Add structured-event tests for every required `handoff.*` event and assert redaction of native paths, signed URLs, credentials, blobs, and handles in `apps/web/src/services/export-handoff.test.ts`
- [ ] T045 [US3] Implement complete stage-specific failure mapping, retry policy, and structured redacted diagnostics in `apps/web/src/services/export-handoff.ts`
- [ ] T046 [P] [US3] Add accessible UI tests for issue severity, stable ordering, clip/track/media identifiers, corrective actions, flattened-only disclosure, blocked writes, retryability, and safe error text in `apps/web/src/components/editor/HandoffExportDialog.test.tsx`
- [ ] T047 [US3] Implement the compatibility issue list, affected-entity details, actions, blocked state, flattened-only disclosure, and failure recovery UI in `apps/web/src/components/editor/HandoffExportDialog.tsx`
- [ ] T048 [US3] Add integration coverage proving blocked assessments never prompt or write and recoverable failures can retry safely in `apps/web/src/test/export-handoff.integration.test.ts`
- [ ] T049 [US3] Add Playwright coverage for blocked Resolve handoff, missing-media guidance, unsupported edits, stale reassessment, cancellation, retry, and visible stage-specific failure in `apps/web/e2e/export-handoff.spec.ts`

**Checkpoint**: All three user stories are independently functional and unsafe exports fail before artifact creation.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Prove scale, compatibility, regression safety, and exact browser behavior before shipping.

- [ ] T050 [P] Add a deterministic five-run 1,000-clip assessment gate on Apple M4, 16 GiB RAM, macOS, and Node.js 26.5.0 with median under five seconds and no run above six seconds, plus a 60-minute zero-drift fixture in `packages/core/src/export/handoff/compatibility.test.ts` and `packages/core/src/export/handoff/timebase.test.ts` (covers SC-006)
- [ ] T051 [P] Run the core handoff and export regression commands from `specs/006-resolve-imovie-export/quickstart.md` against `packages/core/src/export/handoff/`, `packages/core/src/export/export-range.test.ts`, `packages/core/src/export/export-engine.test.ts`, and `packages/core/src/export/export-diagnostics.test.ts`
- [ ] T052 [P] Run the web component, integration, generic export, and Playwright regression commands from `specs/006-resolve-imovie-export/quickstart.md` against `apps/web/src/` and `apps/web/e2e/export-handoff.spec.ts`
- [ ] T053 Run repository typecheck and lint gates for `packages/core/src/export/handoff/` and `apps/web/src/components/editor/` and `apps/web/src/services/export-handoff.ts`
- [ ] T054 Reproduce browser scenarios A-E and record target/range/preflight/progress/cancel/failure/download evidence in `specs/006-resolve-imovie-export/quickstart.md`
- [ ] T055 Audit final artifacts and promote support only when each target has at least one passing exact-build matrix row with OS, artifact hashes, one-frame timing, dimensions, orientation, audio sync, screenshots or recordings, verifier, and date in `docs/export-compatibility.md` (covers FR-020)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1: Setup** has no dependencies.
- **Phase 2: Foundational** depends on Phase 1 and blocks all user stories.
- **Phase 3: User Story 1**, **Phase 4: User Story 2**, and **Phase 5: User Story 3** depend on Phase 2. Their core behavior is independently testable, but tasks touching shared web files must be coordinated or applied sequentially to avoid merge conflicts.
- **Phase 6: Polish** depends on all user stories selected for the release.

### User Story Dependency Graph

```text
Phase 1 Setup
    |
    v
Phase 2 Foundational
    |---------------------|---------------------|
    v                     v                     v
US1 Resolve (P1)     US2 iMovie (P2)      US3 Compatibility (P3)
    |_____________________|_____________________|
                          v
                    Phase 6 Polish
```

### Within Each User Story

- Add and run deterministic or component tests before implementation; record that they fail for the intended reason.
- Complete pure core serialization/profile behavior before browser coordination.
- Complete coordinator behavior before dialog integration.
- Complete component and integration gates before Playwright and destination-application verification.
- Never mark an artifact complete before all required writable streams close.

### Parallel Opportunities

- In Phase 2, timebase, range, compatibility, media-map, target-profile, coordinator, dialog, and toolbar tests marked `[P]` can be authored in parallel after T002 and T003.
- After Phase 2, US1, US2, and US3 can proceed in parallel when owners coordinate changes to `export-handoff.ts`, `HandoffExportDialog.tsx`, and their shared test files.
- Within US1, FCPXML, report, coordinator, and UI tests marked `[P]` can be authored in parallel.
- Within US2, core profile, export-engine regression, coordinator, and UI tests marked `[P]` can be authored in parallel.
- Within US3, schema, failure-injection, diagnostics, and UI tests marked `[P]` can be authored in parallel.
- Performance, core regression, and web regression gates T050-T052 can run in parallel after implementation stabilizes.

## Parallel Example: User Story 1

```text
Developer A: T021 then T023 in packages/core/src/export/handoff/fcpxml.*
Developer B: T022 then T024 in packages/core/src/export/handoff/report.*
Developer C: T025 then T026 in apps/web/src/services/export-handoff.*
Developer D: T027 then T028 in apps/web/src/components/editor/HandoffExportDialog.*
Integrate: T029 -> T030 -> T031
```

## Parallel Example: User Story 2

```text
Developer A: T032 then T033 and T034 in packages/core/src/export/
Developer B: T035 then T036 in apps/web/src/services/export-handoff.*
Developer C: T037 then T038 in apps/web/src/components/editor/HandoffExportDialog.*
Integrate: T039 -> T040 -> T041
```

## Parallel Example: User Story 3

```text
Developer A: T042 in packages/core/src/export/handoff/report.test.ts
Developer B: T043 and T044 then T045 in apps/web/src/services/export-handoff.*
Developer C: T046 then T047 in apps/web/src/components/editor/HandoffExportDialog.*
Integrate: T048 -> T049
```

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1.
2. Complete Phase 2.
3. Complete Phase 3 for the Resolve editable handoff.
4. Run T051, T053, the Resolve portions of T054, and the Resolve compatibility evidence in T055.
5. Stop and validate the MVP independently before adding iMovie or expanded recovery UI.

### Incremental Delivery

1. Deliver the shared deterministic and cancel-safe foundation.
2. Deliver US1 as the editable Resolve MVP.
3. Deliver US2 as the independent flattened iMovie workflow.
4. Deliver US3 as the complete compatibility and recovery experience.
5. Complete scale, regression, browser, and destination compatibility gates.

### Parallel Team Strategy

1. Complete Setup and Foundational tasks together.
2. Assign separate owners to Resolve core serialization, iMovie profile integration, compatibility/recovery, and web UI.
3. Serialize edits to the shared coordinator/dialog files or use isolated worktrees with explicit integration order.
4. Merge each story only after its independent deterministic, browser, and destination compatibility criteria pass.

## Notes

- `[P]` means different-file or test-first work is parallelizable after its stated prerequisites; it does not waive coordination on shared files.
- The implementation remains browser-side and reuses `ExportEngine.exportVideo()`, `resolveExportRange()`, current media recovery, notifications, diagnostics, and File System Access helpers.
- No new backend, database, renderer, ZIP package, LLM call, or probabilistic eval is required.
- Resolve support is not advertised until the folder imports in every version recorded as supported in `docs/export-compatibility.md`.
- iMovie support is not advertised until the MOV imports and plays with verified properties in every version recorded as supported in `docs/export-compatibility.md`.
