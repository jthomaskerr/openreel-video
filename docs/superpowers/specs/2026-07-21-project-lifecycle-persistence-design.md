# Project Lifecycle and Persistence Design

## Outcome

Users can create, open, save, recover, and switch durable editing projects without cross-project writes, partial durable state, silent data loss, or ambiguous persistence status. The implementation preserves the existing browser-to-orchestrator architecture and closes only demonstrable lifecycle safety gaps.

## Scope

This feature specifies and hardens the existing implementation. It does not introduce a new persistence framework.

Current scope includes:

- Canonical managed project storage in the orchestrator.
- Browser project creation, discovery, open, save, recovery, and switching flows.
- Confirmed base revisions and conflict-safe saves.
- Atomic project snapshots with verified media and automatic Git-backed versions.
- IndexedDB recovery copies.
- Plain project-data import and export copies.
- Safe compatibility validation and migrations for supported formats.
- Project identity isolation for queued and in-flight persistence work.

Future scope includes:

- Automatic three-way merge and semantic conflict review.
- An independent project worker with cross-session notifications.
- Worker progress persistence separated from project versions.
- Self-contained exports with packaged media and checksums.
- User-facing durable named snapshots, previews, and restoration.

## Existing Architecture

### Web project session

`useProjectStore` owns the active editor session and composes project data from the timeline, title, graphics, media, and generation domains. `BackendSaveService` is its typed persistence boundary. `AutoSaveManager` owns local recovery copies. `ProjectManager` owns recent-file metadata and plain project-data import/export.

The active web store remains a session cache. It does not become the canonical durable store.

### Canonical orchestrator storage

The orchestrator project routes expose create, list, load, save, media staging, media verification, history, and historical reads. `ProjectStore` owns filesystem layout and snapshot access. `GitStore` owns per-project worktrees, locking, verified commits, and history.

`executeSaveTransaction` remains the atomic save boundary. It verifies the submitted base revision, audits media, journals changes, stages pending media, writes the proposed snapshot, commits the allowed paths, and restores prior state on failure.

### Recovery storage

`AutoSaveManager` keeps local rotating recovery slots. Recovery records are not canonical project versions. Recovery discovery compares stable project identity and modification time before offering a replacement for a requested backend project.

## Required Corrections

### Project switching

Opening, creating, closing, or switching projects must check one authoritative dirty state. When unsaved changes exist, the user chooses save, discard, or cancel before the active project changes.

Queued and in-flight work remains bound to the originating project ID. Switching must not clear another project's required persistence work or let an autosave completion schedule the newly active project by mistake.

### Save completion

Explicit save assembles the same complete project snapshot for local recovery and backend persistence. It waits for canonical confirmation before reporting success. A backend failure leaves the active in-memory state dirty and actionable.

### Conflict handling

The existing base-revision check remains authoritative. A stale submission never overwrites the newer server project. Current scope surfaces the conflict and offers explicit reload, review, or save-as-separate recovery actions. Automatic merge and field-level difference resolution remain future work.

### Recovery safety

Recovery discovery and restoration must surface storage and validation failures. Recovery data is validated for supported shape, format version, and stable project identity before it can replace active state or create a durable save.

The recovery confirmation is the user's explicit restore action. The implementation may persist the restored state as a new automatic version, provided the previous durable version remains available in history and the UI states this behavior clearly.

### Import, export, and migration

Current portable copies contain complete supported project data but do not embed media. Imports pass through a typed versioned validator before installation. Supported older versions migrate through ordered, deterministic transformations. The unmodified imported bytes remain available until migration and validation succeed. Unsupported future versions fail closed with an actionable message.

### Automatic versions

Semantic canonical saves create verified Git-backed versions. Modified-time-only writes do not create meaningless versions. Canonical storage exposes newest-first revision metadata and read-only historical snapshots. User-facing named snapshots and restoration remain future work.

## Data Flow

### Create or open

1. The web client requests or loads a candidate project.
2. The candidate passes identity, shape, and format validation.
3. The backend response includes a confirmed base revision.
4. The editor installs the project only after validation and confirmation.
5. Project-scoped queues and recovery state bind to the installed stable project ID.

### Save

1. The web client assembles one complete snapshot.
2. Media is normalized and staged without mutating canonical project state.
3. The save request includes project ID, base revision, save intent, and required media manifest.
4. The orchestrator locks the project and rejects a stale base.
5. The transaction audits, journals, writes, commits, and verifies the receipt.
6. The client advances its base revision and clears dirty state only after confirmation.

### Switch

1. The client checks dirty state.
2. Save waits for confirmation, discard abandons only the active session changes, and cancel leaves the current project active.
3. The candidate project validates before installation.
4. Pending work continues or terminates according to its existing project-bound contract; no result is rebound to the new project.

## Error Handling

- Storage, listing, recovery, validation, migration, and save failures must not be swallowed.
- User-visible failures identify the affected project and a corrective action.
- Failed saves preserve both the prior durable state and the active in-memory edit.
- Failed opens and migrations leave the current project unchanged.
- Corrupt, mismatched, incomplete, and unsupported data fails closed.
- Duplicate notifications and retries reconcile by project ID and revision.

## Verification

Deterministic tests cover:

- Confirmed create and open behavior.
- Complete snapshot assembly for explicit save.
- Atomic save rollback and crash recovery.
- Stale revision rejection and visible recovery actions.
- Save, discard, and cancel switching outcomes.
- Pending autosave/backend completion after a project switch.
- Recovery identity, recency, corruption, and error surfacing.
- Versioned import validation, supported migrations, and future-version rejection.
- Automatic version creation only for semantic changes.
- Missing-media visibility and project isolation.

Browser verification reproduces create, save, reopen, dirty switching, recovery prompt, conflict recovery, invalid import, and persistence-status behavior against the running orchestrator.

## Evidence Baseline

Before planning, the focused existing suites passed:

- Orchestrator project persistence: 41 passed, 0 failed.
- Web project lifecycle: 131 passed, 0 failed, 4 skipped.

These suites establish the current persistence core but do not cover the project manager dialog, raw project import/export, dirty switching, or cross-project queue isolation. New work must add regression tests for each corrected behavior before implementation.
