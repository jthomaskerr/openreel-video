# Problems, Errors & Logging — Operational Spec

> Derived from user directives and existing implementation patterns.
> Sources: [Operational Spec Update Summary](./OPERATIONAL-SPEC-UPDATE-SUMMARY.md) §15, [OpenReel Spec Implications report](../superpowers/plans/spec-update/openreel-spec-implications-report.json) (Problems / Errors / Logging category, 68 messages), `problem-store.ts`, `log-store.ts`, `ProblemsPanel.tsx`, `LogPanel.tsx`, [Inspector Shell spec](./inspector-shell.md) §4–5.

---

## 1. Architecture: Two-Tier Error Surface

OpenReel MUST maintain two distinct surfaces for errors and diagnostics:

| Surface | Purpose | Mutability | Scope |
|---|---|---|---|
| **Problems tab** | Fixable project-state issues with resolve actions | Mutable — entries removed when resolved | Current project state |
| **Log pane** | Complete, immutable record of all errors and events | Immutable — append-only | Cross-session, cross-project |

These surfaces MUST NOT be conflated. The Problems tab is a *task list* of actionable issues; the Log pane is an *audit trail*.

### 1.1 Requirements

- Errors MUST NEVER be console-only. Every error that originates from application logic (import failures, generation failures, missing files, runtime exceptions in user-initiated processes) MUST be surfaced in at least one of the two surfaces.
- Console-only error logging (e.g., `console.error` without store dispatch) is PROHIBITED for application-level errors.
- Infrastructure/development-only diagnostics (e.g., React render warnings, HMR messages) MAY remain console-only.

---

## 2. Problems Tab

The Problems tab is surfaced in the right sidebar when `sidebarTab === "problems"`. It is rendered by `ProblemsPanel`.

### 2.1 Problem Model

A Problem is a fixable, project-scoped issue. Each Problem MUST conform to the `Problem` interface:

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique identifier (UUID). |
| `kind` | `ProblemKind` | Categorization of the problem. |
| `message` | `string` | Human-readable description. |
| `timestamp` | `number` | Unix-ms when the problem was detected. |
| `resolved` | `boolean` | Whether the problem has been resolved. |
| `projectId` | `string?` | Optional project scope. |
| `mediaId` | `string?` | Optional media item reference. |
| `clipId` | `string?` | Optional timeline clip reference. |
| `details` | `unknown?` | Optional structured payload for resolve actions. |

### 2.2 Problem Kinds

The Problems tab MUST recognize the following `ProblemKind` values. Each kind MUST have a distinct icon, label, and color:

| Kind | Label | Icon | Color | Description |
|---|---|---|---|---|
| `missing_media` | Missing file | `FileQuestion` | Yellow | A media file referenced by the project cannot be found on disk. |
| `block_failed` | Import failed | `AlertTriangle` | Red | A block/segment of an import operation failed. |
| `image_failed` | Image failed | `ImageOff` | Orange | An image asset failed to load or generate. |
| `import_error` | Import error | `AlertTriangle` | Red | A general import error occurred. |
| `generation_failed` | Generation failed | `Sparkles` | Purple | An AI generation job failed. |

Additional kinds MAY be added as new error categories emerge. Each new kind MUST have a corresponding entry in `KIND_META` and `RESOLVE_ACTIONS_BY_KIND`.

### 2.3 Resolve Actions

Every problem kind MUST define at least one resolve action. Resolve actions are the mechanism by which the user fixes the problem. Each action conforms to the `ResolveAction` interface:

| Field | Type | Description |
|---|---|---|
| `id` | `ResolveActionId` | Action identifier. |
| `label` | `string` | Button label shown to the user. |
| `resolves` | `boolean` | If `true`, executing this action marks the problem as resolved. |

#### 2.3.1 Action Definitions

| Action ID | Label | Resolves | Behavior |
|---|---|---|---|
| `link_file` | Link File | `true` | Opens a file picker to relink a missing media file. |
| `remove_media` | Remove | `true` | Removes the problematic media item from the project. |
| `retry_generation` | Retry | `false` | Retries a failed AI generation job. Does NOT auto-resolve — the problem resolves only when the retry succeeds. |
| `dismiss` | Dismiss | `true` | Dismisses the problem without any fix action. |

#### 2.3.2 Kind-to-Action Mapping

| Kind | Available Actions |
|---|---|
| `missing_media` | `link_file`, `remove_media` |
| `block_failed` | `remove_media` |
| `image_failed` | `link_file`, `remove_media` |
| `import_error` | `remove_media` |
| `generation_failed` | `retry_generation`, `remove_media` |

### 2.4 Problem Lifecycle

1. **Detection**: A problem is detected by application code (e.g., import adapter, generation job poller, media loader). The code MUST call `problemBus.report(problemInput)` or `useProblemStore.getState().addProblem(input)`.
2. **Display**: The problem appears in the Problems tab with its kind icon, message, and available resolve actions.
3. **Resolution**: The user clicks a resolve action. The action handler (`executeResolveAction`) dispatches to the registered handler, which performs the fix and calls `resolveProblem(id)`.
4. **Removal**: Once `resolved` is `true`, the problem is removed from the active problems list. It is NOT displayed in the Problems tab.
5. **Auto-resolution**: Problems SHOULD be auto-resolved when the underlying condition is no longer present. For example, if a missing file is relinked through another mechanism, the corresponding `missing_media` problem MUST be auto-resolved.

### 2.5 Problem Row Rendering

Each problem row in the Problems tab MUST display:

- Kind icon and label (color-coded).
- Problem message text.
- Available resolve actions as buttons, each with its action icon and label.
- A dismiss button (×) to clear the problem.

### 2.6 Problem Bus

A `problemBus` singleton MUST be available for non-React code (import adapters, service workers, generation pollers) to report problems without direct store access. The bus MUST:

- Accept `ProblemInput` objects (all fields except `id`, `timestamp`, `resolved`).
- Forward each input to the Zustand store's `addProblem` method.
- Support listener registration for extensibility.

### 2.7 Requirements

- The Problems tab MUST display only unresolved problems (`resolved === false`).
- The problem count badge on the primary tab bar MUST reflect the live count of unresolved problems.
- Problems MUST be scoped to the current project where applicable. Problems without a `projectId` MUST be shown regardless of the active project.
- The Problems tab MUST show an empty state ("No problems detected") when there are no unresolved problems.
- Problems MUST NOT be persisted across sessions — they are derived from the current project state and re-detected on load.

---

## 3. Log Pane

The Log pane is surfaced in the right sidebar when `sidebarTab === "log"`. It is rendered by `LogPanel`.

### 3.1 Log Entry Model

A Log entry is an immutable record of an event or error. Each entry MUST conform to the `LogEntry` interface:

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique identifier (UUID). |
| `kind` | `LogKind` (`string`) | Categorization of the log entry. |
| `message` | `string` | Human-readable message. |
| `label` | `string` | Short label for the entry kind. |
| `timestamp` | `number` | Unix-ms when the entry was created. |
| `projectId` | `string?` | Optional project scope. |
| `projectName` | `string?` | Optional human-readable project name. |
| `clipId` | `string?` | Optional timeline clip reference. |
| `trackName` | `string?` | Optional track name reference. |
| `source` | `string?` | Optional source identifier (e.g., `"orchestrator"`, `"generation"`, `"import"`). |

### 3.2 Log Kinds

The Log pane MUST support a broad set of log kinds, broader than `ProblemKind`. Known kinds include:

| Kind | Label | Icon | Source |
|---|---|---|---|
| `error` | Error | `Bug` | General application errors. |
| `warning` | Warning | `AlertTriangle` | Non-fatal warnings. |
| `import` | Import | `FileWarning` | Import operations. |
| `generation` | Generation | `Sparkles` | AI generation events. |
| `render` | Render | `MonitorX` | Rendering/playback errors. |
| `audio` | Audio | `AudioLines` | Audio processing events. |
| `image` | Image | `ImageOff` | Image processing events. |
| `text` | Text | `Type` | Text/subtitle events. |
| `shape` | Shape | `Shapes` | Shape rendering events. |
| `camera` | Camera | `Camera` | Camera/viewport events. |
| `video` | Video | `Film` | Video processing events. |
| `system` | System | `Cpu` | System/infrastructure events. |
| `network` | Network | `Zap` | Network request events. |

Additional kinds MAY be added. Each new kind MUST have a corresponding entry in `KIND_ICON` and `KIND_LABEL`.

### 3.3 Immutability

Log entries are **immutable**:

- Entries are append-only. Once added, an entry MUST NEVER be modified or deleted.
- The log MUST persist across browser sessions (via the log store's persistence mechanism).
- There is NO mechanism to clear or truncate the log from the UI.

### 3.4 Filtering

The Log pane MUST support filtering via the `LogFilter` interface:

| Filter | Type | Description |
|---|---|---|
| `kinds` | `LogKind[]?` | Show only entries of the specified kinds. |
| `projectIds` | `string[]?` | Show only entries for the specified projects. |
| `clipIds` | `string[]?` | Show only entries for the specified clips. |
| `since` | `number?` | Show only entries after this Unix-ms timestamp. |
| `until` | `number?` | Show only entries before this Unix-ms timestamp. |
| `search` | `string?` | Free-text search across `message` and `label`. |

#### 3.4.1 Filter UI

The Log pane MUST provide:

- **Text search**: A search input for free-text filtering.
- **Kind filter**: Checkbox toggles for each log kind, grouped in a filter bar or dropdown.
- **Scope filter**: Filter by project, clip, or track scope.

#### 3.4.2 Auto-Filter Prohibition

Selecting a clip on the timeline MUST NOT automatically filter the Log pane. The Log pane's filter state is independent of timeline selection. The user MAY manually apply a clip filter, but the system MUST NOT do so automatically.

### 3.5 Log Entry Rendering

Each log entry row MUST display:

- Timestamp (formatted as relative time for recent entries, absolute date for older entries).
- Kind icon and label.
- Message text.
- Optional scope tags (project name, clip ID, track name) as small badges.

### 3.6 Log Bus

A `logBus` singleton MUST be available for any code to write log entries without direct store access. The bus MUST:

- Accept `LogEntryInput` objects.
- Generate a UUID `id` and set `timestamp` to `Date.now()`.
- Forward the complete `LogEntry` to the Zustand store's `addEntry` method.

### 3.7 Requirements

- The Log pane MUST display entries in reverse chronological order (newest first).
- The Log pane MUST show an empty state ("No log entries") when there are no entries matching the current filter.
- Log entries MUST be tagged with project/clip/scope metadata whenever the context is known at the time of logging.
- The log MUST be filterable by all dimensions defined in `LogFilter`.
- The log MUST persist across browser sessions.

---

## 4. Separation of Concerns

### 4.1 Problems vs. Log

| Aspect | Problems | Log |
|---|---|---|
| **Purpose** | Actionable task list | Complete audit trail |
| **Content** | Fixable project-state issues only | All errors, warnings, and events |
| **Mutability** | Mutable — entries removed on resolution | Immutable — append-only |
| **Persistence** | Session-scoped (re-detected on load) | Cross-session persistent |
| **User action** | Resolve, dismiss, fix | Filter, search, inspect |
| **Auto-filter** | N/A | MUST NOT auto-filter on clip select |

### 4.2 When to Log vs. When to Create a Problem

- **Create a Problem** when: the issue is fixable by the user through a specific action (relink file, remove media, retry generation) AND the issue represents a broken project state that needs attention.
- **Log an entry** when: any error, warning, or significant event occurs, regardless of whether it is fixable. This includes transient errors, network failures, render warnings, and infrastructure events.
- **Both**: A fixable problem SHOULD also be logged as a log entry (so the audit trail is complete), but the primary user-facing surface for fixable issues is the Problems tab.

### 4.3 Console Errors

- Application-level errors that originate from user-initiated processes (import, generation, export, media loading) MUST be surfaced in the Log pane and, if fixable, in the Problems tab.
- Errors that are surfaced in the Problems tab or Log pane MAY also appear in the browser console for development convenience, but the console MUST NOT be the *only* surface.
- Purely infrastructural errors (React render warnings, HMR messages, service worker lifecycle events) MAY remain console-only.

---

## 5. Integration Points

### 5.1 Primary Tab Bar

The Problems and Log tabs are part of the primary right-sidebar tab bar alongside Inspector and Edit. See `inspector-shell.md` §1 for the full tab bar specification.

### 5.2 Problem Count Badge

The Problems tab MUST display a badge count when `problemCount > 0`. The count MUST be derived from `useProblemCount()` which filters to unresolved problems only.

### 5.3 Inspector Panel Routing

The `InspectorPanel` component MUST route to `ProblemsPanel` when `sidebarTab === "problems"` and to `LogPanel` when `sidebarTab === "log"`.

### 5.4 Resolve Action Handler

The resolve action handler (`setResolveActionHandler`) MUST be registered by the UI layer (typically in `InspectorPanel` or a parent component) to wire resolve actions to their implementations:

- `link_file`: Opens a file picker dialog, updates the media item's file path, and resolves the problem.
- `remove_media`: Removes the media item from the project store and resolves the problem.
- `retry_generation`: Re-enqueues the generation job and does NOT auto-resolve — the problem resolves when the generation succeeds.

---

## 6. Open Questions

- TODO: Should the Log pane support export (e.g., download as JSON/CSV)?
- TODO: Should there be a maximum log size or automatic pruning of very old entries?
- TODO: Should Problems be auto-detected on project load by scanning all media items for missing files, or only reported when an operation fails?
- TODO: Should the Problems tab support grouping by kind (e.g., all missing files together)?
- TODO: Should log entries from the orchestrator backend be forwarded to the web client's log store?

## 7. Media availability problems and actions

Media availability follows the canonical [Media Assets runtime availability contract](./media-assets.md#6-runtime-availability). Problems and logs use its structured codes and MUST distinguish durable absence from operational failure:

| Code | Problem/log treatment | Primary action |
|---|---|---|
| `MEDIA_VERIFYING` | Non-destructive runtime status; log only if prolonged | `verify_media` / cancel |
| `MEDIA_TEMPORARILY_UNAVAILABLE` | Recoverable network/system problem; never `missing_media` | `retry_connection` |
| `MEDIA_UNAUTHORIZED` | Authentication problem; never `missing_media` | `reauthenticate` |
| `MEDIA_DECODE_ERROR` | Bytes exist but are corrupt/unsupported; never `missing_media` | inspect/replace |
| `MEDIA_CONFIRMED_MISSING` | Durable missing-media problem | `link_file`, then confirmed removal if chosen |

Timeout, refusal, DNS, CORS-like rejection, abort, offline/HMR interruption, and `5xx` SHALL log structured transport context without incrementing missing counts or creating `missing_media`. Problems and actions are deduplicated per project/media ID. Verify/Retry may target one item or all unresolved items, are bounded and cancellable, and resolve atomically across every UI surface after backend recovery. `401`/`403` require re-authentication. Relink/removal MUST NOT be primary or automatic until authoritative absence and applicable local recovery checks establish `MEDIA_CONFIRMED_MISSING`.

## 8. Project-save integrity failures

Save failures preserve the last confirmed receipt and remain actionable. They MUST
NOT report `Persisted` merely because a request was queued, an upload completed, or
bytes were written to a worktree.

| Code or failure | Required treatment | Recovery path |
|---|---|---|
| `PROJECT_CONFLICT` | Show submitted/current bases; do not mutate | Reload/merge, then retry from the authoritative receipt |
| `DESTRUCTIVE_CHANGE_REQUIRES_INTENT` | Show structural deltas; do not mutate | Review and explicitly confirm, then retry with current base/intent |
| `MEDIA_INCOMPLETE` | List semantic filenames/media IDs; retain last-good JSON/HEAD | Prove/upload or relink originals, then reconcile once |
| Receipt/object/digest mismatch | Fail persistence; retain prior receipt | Reload authoritative receipt; verify Git/LFS before retry |
| Cached diff/unexpected staged path | Never broaden the allowlist automatically | Preserve evidence, repair only identified residue, then retry |
| LFS local/remote failure | Never claim unproved durability | Restore exact OID/size or connectivity/upload, then re-verify |

Logs include project ID, code, receipt identities, expected/actual path lists, and
affected media IDs, but omit binaries, data URLs, secrets, and absolute paths. See
the [project-save regression](./regressions/project-save-regression.md),
[implementation plan](../superpowers/plans/2026-07-13-project-save-archive-integrity-and-dangling-clips.md),
and [operator runbook](../runbooks/project-save-integrity-verification.md).
