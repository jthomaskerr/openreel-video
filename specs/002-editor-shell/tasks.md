# Tasks: Editor Shell and Shared UI

**Input**: Design documents from `specs/002-editor-shell/`  
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Tests**: Every correction uses strict regression-first TDD. Existing behavior is marked complete only where repository analysis and installed tests prove it.

**Organization**: Tasks are grouped by user story. Checked tasks describe installed behavior that must be preserved; unchecked tasks are the minimal demonstrated critical-error or usability work.

## Phase 1: Setup and Implementation Review

**Purpose**: Establish the implementation-aligned scope before production changes

- [x] T001 Record implementation-first specification, clarification, research, data model, contracts, and validation guide in `specs/002-editor-shell/`
- [x] T002 Confirm the installed workspace composition and panel isolation in `apps/web/src/components/editor/EditorInterface.tsx` and `apps/web/src/components/ErrorBoundary.tsx`
- [x] T003 Confirm installed inspector/settings/tab/shared-control behavior in `apps/web/src/components/editor/InspectorPanel.tsx`, `apps/web/src/components/editor/settings/`, and `packages/ui/src/`
- [x] T004 Confirm installed onboarding behavior and explicitly defer all tour changes in `apps/web/src/components/editor/tour/` and `specs/002-editor-shell/spec.md`

---

## Phase 2: Foundational Scope Guard

**Purpose**: Prevent broad UI work from entering the current feature

- [x] T005 Preserve existing engine/UI stores, panel bounds, settings categories, keyboard shortcuts, tour behavior, and `@openreel/ui` exports per `specs/002-editor-shell/contracts/editor-shell-contracts.md`
- [x] T006 Limit production scope to the demonstrated terminal-startup error and custom resize/tab keyboard usability defects in `specs/002-editor-shell/plan.md`

**Checkpoint**: Installed baseline is documented and Future Scope is excluded.

---

## Phase 3: User Story 1 - Enter or Recover the Editor Workspace (Priority: P1) 🎯 MVP

**Goal**: Replace terminal initialization failure with a stable announced error and in-place Retry while preserving successful startup.

**Independent Test**: Simulate startup progress, success, engine failure, bridge failure, and Retry; verify failed attempts stop progress presentation and a new attempt can reach ready state.

### Tests for User Story 1

- [ ] T007 [US1] Add a failing terminal-error and retry regression in `apps/web/src/components/editor/EditorInterface.initialization.test.tsx`

### Implementation for User Story 1

- [ ] T008 [US1] Expose an attempt-safe retry operation and terminal failed state from the installed initialization flow in `apps/web/src/components/editor/EditorInterface.tsx`
- [ ] T009 [US1] Render an announced diagnostic error and Retry action without indefinite progress animation in `apps/web/src/components/editor/EditorInterface.tsx`
- [ ] T010 [US1] Run the focused startup regression and verify error/retry behavior in a real browser using `specs/002-editor-shell/quickstart.md`

**Checkpoint**: Successful startup remains unchanged; every terminal startup failure is actionable without reload.

---

## Phase 4: User Story 2 - Navigate and Resize Without a Pointer (Priority: P1)

**Goal**: Make the four installed boundaries and three custom tab sets keyboard operable without changing pointer behavior or layout.

**Independent Test**: Use only Arrow, Home, and End keys to resize each boundary within bounds and select/focus every available custom tab.

### Tests for User Story 2

- [ ] T011 [P] [US2] Add failing separator semantics, direction, step, and clamping regressions in `apps/web/src/components/editor/PanelResizeHandle.test.tsx`
- [ ] T012 [P] [US2] Add failing primary-inspector Arrow/Home/End regressions in `apps/web/src/components/editor/InspectorPanel.tabs.test.tsx`
- [ ] T013 [P] [US2] Add failing clip-edit Arrow/Home/End regressions in `apps/web/src/components/editor/inspector/shell/InspectorTabs.test.tsx`
- [ ] T014 [P] [US2] Add failing settings Arrow/Home/End regressions in `apps/web/src/components/editor/settings/SettingsDialog.test.tsx`

### Implementation for User Story 2

- [ ] T015 [US2] Implement the editor-local semantic keyboard boundary in `apps/web/src/components/editor/PanelResizeHandle.tsx`
- [ ] T016 [US2] Replace the four mouse-only boundaries while preserving pointer geometry and installed bounds in `apps/web/src/components/editor/EditorInterface.tsx`
- [ ] T017 [US2] Implement automatic primary-inspector tab focus/selection in `apps/web/src/components/editor/InspectorPanel.tsx`
- [ ] T018 [US2] Implement automatic clip-edit tab focus/selection in `apps/web/src/components/editor/inspector/shell/InspectorTabs.tsx`
- [ ] T019 [US2] Implement automatic settings tab focus/selection in `apps/web/src/components/editor/settings/SettingsDialog.tsx`
- [ ] T020 [US2] Run focused keyboard regressions and verify all boundaries/tab sets in a real browser using `specs/002-editor-shell/quickstart.md`

**Checkpoint**: Keyboard and pointer users can operate the installed workspace controls with synchronized state.

---

## Phase 5: User Story 3 - Preserve Installed Onboarding (Priority: P2)

**Goal**: Keep onboarding behavior unchanged while production tour changes remain deferred.

**Independent Test**: Run installed onboarding regressions and confirm project-linked loading still suppresses automatic tour startup.

- [x] T021 [US3] Preserve existing onboarding production code in `apps/web/src/components/editor/tour/`
- [ ] T022 [US3] Run the unchanged onboarding regression in `apps/web/src/components/editor/tour/useTour.test.ts`

---

## Phase 6: User Story 4 - Preserve Settings and Shared Controls (Priority: P2)

**Goal**: Keep installed settings categories and reusable controls compatible while correcting settings tab keyboard usability only.

**Independent Test**: Open installed settings categories and exercise representative shared controls after keyboard changes.

- [x] T023 [US4] Preserve installed settings categories and public shared-control exports in `apps/web/src/components/editor/settings/` and `packages/ui/src/`
- [ ] T024 [US4] Verify representative settings and shared-control regressions remain green using `specs/002-editor-shell/quickstart.md`

---

## Phase 7: Polish and Cross-Cutting Verification

**Purpose**: Produce traceable completion evidence without expanding scope

- [ ] T025 Run focused shell tests and TypeScript commands from `specs/002-editor-shell/quickstart.md`
- [ ] T026 Run Serena diagnostics for every changed TypeScript file and `rtk git diff --check`
- [ ] T027 Confirm `rtk git diff --name-only -- apps/web/src/components/editor/tour` reports no tour production change
- [ ] T028 Record exact RED/GREEN counts, browser observations, failure modes, and final scope audit in `specs/002-editor-shell/quickstart.md`

---

## Dependencies and Execution Order

### Phase Dependencies

- **Setup and Foundational (Phases 1–2)**: Complete and implementation-aligned.
- **User Story 1 (Phase 3)**: Can begin immediately and is the critical-error MVP.
- **User Story 2 (Phase 4)**: Independent in behavior, but its editor-interface integration follows US1 to avoid overlapping edits.
- **User Stories 3–4 (Phases 5–6)**: Preservation/verification only; no production tour or shared-package change.
- **Polish (Phase 7)**: Runs after current-scope implementation and focused verification.

### Within Each User Story

- Write each regression first and observe the expected RED failure.
- Implement the smallest change that makes that regression GREEN.
- Run the focused story suite before the next production change.
- Complete real-browser verification before checking the story checkpoint.

### Parallel Opportunities

- T011–T014 target independent test files and can be prepared in parallel after US1.
- T017–T019 target independent tab components after their regressions are red.
- T022 and T024 are independent preservation gates after current-scope implementation.

## Parallel Example: User Story 2

```text
Task: "Add failing PanelResizeHandle regressions in apps/web/src/components/editor/PanelResizeHandle.test.tsx"
Task: "Add failing InspectorPanel tab regressions in apps/web/src/components/editor/InspectorPanel.tabs.test.tsx"
Task: "Add failing InspectorTabs regressions in apps/web/src/components/editor/inspector/shell/InspectorTabs.test.tsx"
Task: "Add failing SettingsDialog regressions in apps/web/src/components/editor/settings/SettingsDialog.test.tsx"
```

## Implementation Strategy

### MVP First

1. Complete T007–T010 for actionable startup failure and Retry.
2. Validate the story independently in deterministic tests and the browser.
3. Commit the verified critical-error correction.

### Incremental Delivery

1. Add and verify keyboard boundary behavior.
2. Add and verify each independent tab set.
3. Run preservation gates for tour, settings, and shared controls.
4. Complete final diagnostics, diff checks, browser evidence, commit, and push gate.

## Notes

- Checked tasks are installed behavior proven during implementation-first analysis.
- No tour production task is permitted in current scope.
- No shared-package change is planned; add one only if a current-scope failing regression proves it necessary.
- Existing unrelated worktree files must remain unstaged and untouched.
