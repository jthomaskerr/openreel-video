# Feature Specification: Project Lifecycle and Persistence

**Feature Branch**: `feature/time-machine-project-lifecycle`
**Created**: 2026-07-21
**Status**: Implemented (minimal critical scope; deferred enhancements listed below)
**Input**: User description: "Users can create, open, save, recover, version, and switch durable editing projects."

## Clarifications

### Session 2026-07-21

- Q: Which durable destinations are first-class in this feature? → A: Managed workspace storage is canonical; portable project files are explicit import/export copies.
- Q: What constitutes project version history? → A: Every semantic durable save creates an automatic version; user-facing named snapshots and restoration are future scope.
- Q: How should a stale save recover when durable project state changed after opening? → A: Current scope preserves the newer durable state and offers an explicit recovery path; automatic merge is future scope.
- Q: What happens to project-scoped background work when users switch projects? → A: Current scope keeps work bound to its originating project; an independent worker with cross-session notifications is future scope.
- Q: Which worker updates should create durable project versions? → A: Deferred with the independent project worker to future scope.
- Q: What should a portable project export contain? → A: Current scope exports complete project data; optional packaged media and integrity checksums are future scope.
- Q: At what granularity should stale-save conflicts be displayed and resolved? → A: Semantic entity and field-level conflict review is future scope.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create and Save a Durable Project (Priority: P1)

An editor creates a project, gives it a recognizable name and editing format, makes changes, and saves it so that the same project can be reopened after the application or device session ends.

**Why this priority**: Durable creation and saving are prerequisites for every longer editing workflow. Without them, users cannot trust the editor with meaningful work.

**Independent Test**: Create a project, add representative timeline and media-library changes, save it, close the editing session, reopen the project, and verify that its identity, settings, timeline, and media references match the saved state.

**Acceptance Scenarios**:

1. **Given** no project is open, **When** the user creates a project with valid settings, **Then** the editor opens a distinct project with a stable identity, creation time, modification time, and the chosen settings.
2. **Given** a project contains unsaved changes, **When** the user saves successfully, **Then** all project-owned editing data is durably recorded and the editor indicates that no changes remain unsaved.
3. **Given** a save cannot complete, **When** the failure occurs, **Then** the prior durable version remains usable, the project remains marked as unsaved, and the user receives an actionable error without losing the in-memory edit.

---

### User Story 2 - Reopen and Switch Projects Safely (Priority: P1)

An editor finds an existing project, opens it, and switches between projects without accidentally discarding work or mixing state from different projects.

**Why this priority**: Project isolation and safe switching are central to managing more than one piece of work.

**Independent Test**: Create two projects with visibly different settings and timelines, queue persistence for project A, switch to project B, and verify that A is saved with A's base revision while B retains only its own content and persistence status.

**Acceptance Scenarios**:

1. **Given** saved projects are available, **When** the user opens the project chooser, **Then** each project is identifiable by at least name and last-modified time.
2. **Given** the current project has changes awaiting persistence, **When** the user opens, creates, or switches to another project, **Then** the pending snapshot remains bound to the originating project and is not cancelled or rebound; closing or refreshing a dirty project requests browser confirmation.
3. **Given** a project is opened successfully, **When** installation completes, **Then** project-scoped history, autosave state, media state, and pending persistence work belong only to the opened project.
4. **Given** opening a project fails validation or loading, **When** the error is reported, **Then** the current project remains active and unchanged.

---

### User Story 3 - Recover Interrupted Work (Existing Baseline; hardening deferred)

An editor whose session ended unexpectedly can discover and restore a newer recoverable copy of the project instead of losing recent work.

**Why this priority**: Recovery materially improves trust by limiting loss from crashes, refreshes, device interruptions, or transient save failures.

**Independent Test**: Save a project, make additional changes, and verify that rotating project-identified IndexedDB recovery records can be discovered and selected. Strict candidate validation and local-unsaved restoration semantics are Future Scope.

**Acceptance Scenarios**:

1. **Given** local recovery records exist, **When** the project chooser checks recovery storage, **Then** records remain identified by stable project identity, project name, recovery time, and rotation slot.
2. **Given** a selected recovery record contains invalid JSON or cannot be reconciled with a managed project, **When** recovery fails, **Then** the active project is not replaced and the failure is surfaced by the existing recovery path.

---

### Edge Cases

- Two projects have the same display name but different stable identities.
- A project is renamed while open, including names with leading or trailing whitespace or unsupported characters.
- A save is requested while an earlier save for the same project is still pending.
- The durable project changed elsewhere after the user opened it.
- The project references media that is missing, inaccessible, still uploading, or cannot be verified.
- A project is created or opened while background autosave or persistence confirmation from another project is pending.
- Storage becomes unavailable, exceeds capacity, or denies permission during save or recovery.
- A project comes from an older supported format or a format newer than this editor supports.
- The user closes or refreshes the editor while a save is in progress.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST let users create a project with a unique stable identity, a non-empty display name, creation and modification times, and valid editing settings.
- **FR-002**: The system MUST keep each project's timeline, settings, media library, generated definitions, overlays, and other project-owned editing data isolated from every other project.
- **FR-003**: The system MUST use managed workspace storage as the canonical durable project destination and MUST support portable project-data files as explicit import and export copies.
- **FR-004**: The system MUST let users discover and open existing projects using recognizable metadata, including name and last-modified time.
- **FR-005**: The system MUST leave the current project unchanged when canonical loading or basic recovery reconciliation fails. Strict portable/recovery schema validation is Future Scope.
- **FR-006**: The system MUST track whether the active project differs from its most recently confirmed durable version.
- **FR-007**: Pending automatic persistence MUST survive project replacement under the originating project identity, and the browser MUST request confirmation before unloading an explicitly created dirty project.
- **FR-008**: A save MUST be atomic from the user's perspective: either the complete new project state becomes durable or the prior durable state remains current.
- **FR-009**: Concurrent or stale saves MUST NOT silently overwrite a newer durable project state; the user MUST receive an explicit recovery path such as reloading the newer state, reviewing the conflict, or saving the submitted state as a separate project.
- **FR-010**: Save failures MUST preserve the in-memory edit, retain the unsaved indicator, and identify the affected project and a useful corrective action.
- **FR-011**: The system MUST create recoverable copies of changed projects without requiring the user to initiate every recovery save.
- **FR-015**: The system MUST create an automatic version for every successful durable save that contains semantic project changes.
- **FR-016**: Canonical storage MUST expose automatic versions newest first with enough revision, time, and change metadata to identify each version.
- **FR-017**: Canonical storage MUST support read-only retrieval of an earlier automatic version without changing the current durable project.
- **FR-018**: Project-scoped background work MUST remain bound to its originating stable project identity so that saves, recovery records, uploads, and confirmations cannot be applied to another project.
- **FR-019**: Missing or inaccessible media MUST be surfaced with affected media identifiers and available recovery actions; it MUST NOT be silently removed from the project.
- **FR-020**: Canonical managed-workspace save and reopen MUST preserve all currently supported project data.
- **FR-021**: Existing legacy project-data normalization MUST remain available; strict portable/recovery version migration is Future Scope.

### Key Entities

- **Project**: A durable editing workspace with a stable identity, display name, timestamps, editing settings, timeline, media library, generated definitions, overlays, and format version.
- **Project Summary**: The identifying metadata shown before opening a project, including stable identity, name, creation time, and last-modified time.
- **Durable Project Version**: A complete confirmed project state identified by its revision and creation time, with a parent/current relationship and distinguishing change information.
- **Recovery Copy**: A complete or safely restorable project state created after the last durable version, tied to one stable project identity and recovery time.
- **Save Intent**: A user or automatic request to persist a specific project revision, including enough identity and revision information to prevent cross-project or stale writes.
- **Media Reference**: A project-owned reference to source media and its availability or verification state; unavailable media remains explicit rather than disappearing.

### Assumptions

- One user actively edits a project in one editor session at a time, but stale or externally changed durable state can still occur and must be detected.
- Authentication, authorization, collaborative editing, sharing, export, and media-editing behavior are outside this feature except where they affect safe project persistence.
- Project deletion and permanent retention policy are outside the initial scope.
- Autosave recovery limits data loss to recent work but does not replace an explicit durable save.
- Existing supported project data is preserved losslessly through save and reopen.
- The project constitution is currently an unfilled template and adds no feature-specific governance requirements.

### Future Scope

- Automatic three-way merging for stale saves, including semantic entity and field-level difference review with independent conflict resolution.
- Save / Discard / Cancel project-transition dialogs and a generalized transition-request store.
- Strict portable/recovery envelope validation, future-version rejection, newer-only same-project recovery offers, and restoration as local unsaved state before explicit durable save.
- Independent chooser-source error panels and retry controls.
- Exhaustive 100-element portable round-trip coverage, open/save percentile instrumentation, and formal saved-state usability studies.
- A durable project-scoped worker that continues operations regardless of active editor sessions, persists progress separately from project versions, updates the originating project, and notifies registered listeners.
- Portable project packages that optionally include referenced media with integrity checksums.
- User-facing durable history with named snapshots, read-only preview, and restoration of an earlier version as a new current version while preserving existing history.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Deterministic canonical persistence regressions preserve complete representative project snapshots or the prior complete durable revision; no partial durable revision is accepted.
- **SC-002**: Users can create and reach a durably saved empty project in under 60 seconds during a first-use usability test.
- **SC-003**: Every explicit Save promise resolves only after durable backend confirmation or rejects with the affected project preserved in memory.
- **SC-004**: An interrupted session loses no more than 30 seconds of edits after the most recent successful recovery write under normal operating conditions.
- **SC-005**: Across automated fault-injection cases for failed, stale, concurrent, interrupted, and invalid saves, 100% preserve either the prior durable version or the complete new version; no partial durable version is accepted.
- **SC-006**: Across project-switching tests with queued saves and late autosave completions, 100% remain bound to their originating project and never replace another project's visible status.
- **SC-007**: A dirty explicitly created project triggers browser unload confirmation; a project matching its confirmed durable receipt does not.
