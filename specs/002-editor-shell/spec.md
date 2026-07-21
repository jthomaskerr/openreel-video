# Feature Specification: Editor Shell and Shared UI

**Feature Branch**: `feature/time-machine-editor-shell`  
**Created**: 2026-07-21  
**Status**: Draft  
**Input**: User description: "Feature: Editor Shell and Shared UI. Users navigate the editor workspace, inspector, settings, tours, and reusable accessible controls. Relevant files: apps/web/src/components/editor/EditorInterface.tsx, apps/web/src/components/editor/InspectorPanel.tsx, apps/web/src/components/editor/settings, apps/web/src/components/editor/tour, packages/ui/src. Focus on this feature only; do not modify other features."

## Scope and Installed Baseline

The existing editor already provides the primary workspace regions, isolated panel failure handling, pointer-based panel resizing, inspector and settings tabs, keyboard shortcuts, onboarding tours, and a reusable control library. This feature preserves that installed behavior and corrects only demonstrated critical errors or concrete usability defects.

Current scope is limited to:

- ending the startup state with actionable recovery when editor initialization fails;
- making workspace resize controls and tab sets operable and understandable without a pointer;
- adding deterministic regressions for each corrected failure mode.

## Clarifications

### Session 2026-07-21

- Q: What step should each arrow-key press use for workspace boundaries? → A: Side panels change by 10 pixels; the timeline changes by 2 percentage points of viewport height.
- Q: Where should keyboard focus move when the onboarding tour opens or changes step? → A: Defer all tour changes; prioritize only demonstrated critical errors or concrete usability defects outside the tour.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Enter or Recover the Editor Workspace (Priority: P1)

An editor can open the workspace and see initialization progress. If startup fails, the editor sees a stable error state with a clear retry action instead of an indefinitely animated loading state.

**Why this priority**: The workspace is the entry point for all editing. A failure that cannot be recovered or clearly diagnosed blocks every other feature.

**Independent Test**: Simulate successful and failed initialization. Verify that success reveals the workspace and failure replaces loading progress with an actionable error whose retry can start initialization again.

**Acceptance Scenarios**:

1. **Given** editor initialization is still running, **When** the workspace opens, **Then** progress and the current initialization stage are visibly communicated.
2. **Given** initialization completes, **When** the editor becomes ready, **Then** the toolbar, media area, stage, inspector, and timeline become available.
3. **Given** initialization fails, **When** the failure is reported, **Then** animation stops, the failure is announced, and a Retry action is available.
4. **Given** initialization previously failed, **When** the editor activates Retry, **Then** a new initialization attempt begins and the progress state is restored.

---

### User Story 2 - Navigate and Resize the Workspace Without a Pointer (Priority: P1)

A keyboard user can move among inspector and settings tabs and can resize the main workspace regions without needing a mouse.

**Why this priority**: The installed shell exposes essential editing controls through custom tab and resize interactions. Those controls must remain usable for keyboard-only operation.

**Independent Test**: Use only keyboard input to select every tab and change each supported panel boundary, verifying the active selection and resulting size after every action.

**Acceptance Scenarios**:

1. **Given** focus is on a tab in the inspector or settings, **When** the editor uses Arrow, Home, or End keys, **Then** focus and selection move according to the tab order without leaving the tab set.
2. **Given** focus is on a panel boundary, **When** the editor uses a directional key, **Then** a side panel changes by 10 pixels or the timeline changes by 2 percentage points of viewport height and exposes its current value.
3. **Given** a panel reaches its minimum or maximum size, **When** the editor attempts to resize beyond the boundary, **Then** the size remains within the supported range.
4. **Given** a panel or inspector section fails to render, **When** the rest of the workspace remains healthy, **Then** the failure is identified within that region and other regions remain usable.

---

### User Story 3 - Preserve Installed Onboarding (Priority: P2)

A new editor can advance, revisit, complete, or dismiss the installed onboarding tour without this feature changing its interaction or content.

**Why this priority**: The tour is part of the installed shell and must not regress, but changes to it are explicitly deferred.

**Independent Test**: Run the existing onboarding regressions and verify current start, navigation, completion, dismissal, and project-link suppression behavior remain unchanged.

**Acceptance Scenarios**:

1. **Given** onboarding has not been completed and no project link was requested, **When** the shell opens, **Then** the installed tour starts after its existing delay.
2. **Given** the tour is active, **When** the editor uses the installed next, previous, direct-step, skip, completion, or keyboard actions, **Then** the current tour behavior is preserved.
3. **Given** a project link was requested, **When** the shell opens, **Then** the tour does not interrupt project loading.

---

### User Story 4 - Use Existing Settings and Shared Controls Consistently (Priority: P2)

An editor can open settings, switch between installed settings categories, and use shared controls with consistent names, states, disabled behavior, and focus indication.

**Why this priority**: These capabilities are already installed. Preserving their shared interaction contract prevents shell fixes from introducing inconsistent controls.

**Independent Test**: Open each installed settings category and exercise representative buttons, fields, dialogs, tabs, and toggles with pointer and keyboard input.

**Acceptance Scenarios**:

1. **Given** settings are open, **When** the editor changes category, **Then** the selected category and its associated content are unambiguous.
2. **Given** a shared control is focused, disabled, selected, checked, expanded, or invalid, **When** its state changes, **Then** that state is visually and programmatically available.
3. **Given** a modal shared control is dismissed, **When** it closes, **Then** focus returns to its invoker where possible.

### Edge Cases

- Initialization fails before any individual engine reports a detailed stage.
- Retry fails repeatedly or initialization reports failure after partial startup.
- A resize key is held down, a boundary is already at its limit, or the viewport is smaller than the combined preferred panel sizes.
- A tab becomes unavailable while it or its panel has focus.
- Existing onboarding state or a tour target is unavailable; behavior remains unchanged because tour changes are deferred.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST distinguish editor initialization progress, success, and failure as separate visible states.
- **FR-002**: An initialization failure MUST stop indefinite loading animation, identify the failure, announce it as an error, and offer Retry.
- **FR-003**: Retry MUST begin a fresh initialization attempt without requiring a page reload.
- **FR-004**: The workspace MUST retain its installed toolbar, media, stage, inspector, optional chat, timeline, audio-mixer, and keyframe-editor composition.
- **FR-005**: A failure within an isolated workspace region MUST remain contained to that region and MUST identify the failed region.
- **FR-006**: Every adjustable workspace boundary MUST be focusable, identify the regions it separates, expose its orientation and current value, and support directional keyboard resizing in 10-pixel side-panel steps and 2-percentage-point timeline-height steps.
- **FR-007**: Workspace sizes MUST remain within the installed minimum and maximum bounds for pointer and keyboard resizing.
- **FR-008**: Inspector and settings tab sets MUST expose selected state and tab-to-panel relationships and MUST support Arrow, Home, and End key navigation.
- **FR-009**: The onboarding tour MUST retain its installed next, previous, direct-step, skip, completion, and keyboard actions without behavior changes in this feature.
- **FR-010**: The onboarding tour MUST retain its installed completion state and automatic-start suppression when a project link is requested.
- **FR-011**: Changes to tour semantics, focus, labels, content, and interaction MUST remain outside current implementation scope.
- **FR-012**: Existing tour tests MUST remain green; no new tour regression is required by this feature.
- **FR-013**: Existing settings categories, onboarding completion behavior, keyboard shortcuts, panel visibility behavior, and shared control exports MUST remain compatible.
- **FR-014**: Every corrected failure mode MUST have a local deterministic regression test.
- **FR-015**: User-visible startup, panel, and settings failures MUST not be silently ignored.

### Key Entities

- **Workspace Region**: A visible editing area with an identity, visibility state, size constraints, and isolated failure state.
- **Panel Boundary**: An adjustable separator with orientation, current value, bounds, and the two regions it separates.
- **Tab Set**: An ordered group of tabs, one selected tab, and associated content panels.
- **Initialization State**: The editor's current startup phase, progress description, failure information, and retry availability.
- **Tour Session**: Whether onboarding is active, the current step, available navigation actions, target location, and completion state.
- **Shared Control**: A reusable interactive element with consistent name, state, focus, disabled, and validation behavior.

## Assumptions

- The installed desktop-oriented workspace composition remains authoritative.
- Existing panel size defaults and bounds remain unchanged unless a failing regression proves them invalid.
- Existing settings categories and all tour behavior remain authoritative; this feature does not change the tour.
- Existing reusable controls remain in scope only for regressions caused by shell work or a demonstrated missing state required by the scenarios above.
- Initialization retry may reuse the installed initialization operation; no new background service is required.

## Future Scope

- New workspace regions, dockable-panel architecture, saved layout presets, or cross-session layout synchronization.
- Mobile or small-screen redesign beyond preserving bounded behavior in the current layout.
- New settings categories, account management, or provider configuration capabilities.
- All tour changes, including semantics, focus management, labels, content, analytics, personalization, and remote delivery.
- A redesign or replacement of the shared control library.
- Broad visual restyling, theme expansion, or animation changes unrelated to the corrected interaction failures.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In deterministic failure tests, 100% of editor initialization failures replace the loading state with an announced error and usable Retry action within one rendered update.
- **SC-002**: A keyboard-only user can select every installed inspector and settings tab and resize every adjustable workspace boundary without pointer input.
- **SC-003**: Every adjustable boundary remains within its documented minimum and maximum during 100 consecutive keyboard or pointer resize inputs.
- **SC-004**: Existing onboarding tests remain green with no production tour changes.
- **SC-005**: All current-scope deterministic shell regressions pass locally in under two seconds each.
- **SC-006**: Existing focused inspector, tour, settings, and shared-control tests continue to pass without new skipped assertions.
