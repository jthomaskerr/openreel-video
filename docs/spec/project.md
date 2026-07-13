# Project Lifecycle and Persistence — Operational Spec

**Status:** Canonical operational specification
**Owner:** Project and persistence subsystem
**Supersedes:** [Project Lifecycle](./project-lifecycle.md), [Backend, Persistence & Versioning](./backend-persistence-versioning.md), and the normative outcome of [Backend Save Worktree Race Fix](./2026-07-08-backend-save-worktree-race-fix.md)

## Scope

This specification owns project creation, backend identity, listing, rename, deletion, autosave, snapshot validation, Git-backed versioning, restore, recovery, persistence receipts, and project-level media storage.

Media presentation and runtime availability are owned by [Media Assets](./media-assets.md). Timeline structure is owned by [Timeline](./timeline.md).

## 1. Project Identity and Creation

Projects MUST NOT be created automatically on editor load. Creation requires an explicit New Project action and a non-empty trimmed name.

When the orchestrator is reachable:

1. The client calls `POST /api/projects` with `{ name, settings? }`.
2. The orchestrator validates the request and allocates the canonical project ID.
3. The orchestrator creates the project repository and initial snapshot atomically.
4. It returns the canonical `Project` and a `201` response.
5. Only then may the client mark the project `explicitlyCreated` and enter the backend save queue.

The client MUST NOT mint an ID that is treated as a backend project ID. An offline project is a local draft without backend identity. It can be edited and saved locally, but backend persistence remains disabled until explicit creation succeeds. A recovered legacy client UUID requires explicit identity reconciliation and MUST NOT be sent to `PUT /api/projects/:id` directly.

Project-name-derived slugs MAY be used by the orchestrator when collision handling is deterministic. The returned backend ID, not the derivation algorithm, is authoritative.

## 2. Project Picker and Lifecycle Actions

The project picker lists backend projects with stable ID, name, modified time, and status. It supports single and multiple selection without conflating selection with opening a project.

- Rename uses `PATCH /api/projects/:id` and preserves identity and history.
- Delete requires explicit confirmation and operates on the selected canonical IDs.
- Bulk deletion reports per-project success or failure.
- Duplicate and archive remain undefined until their storage and identity semantics are specified.

Deleting a project removes its complete project directory, repository/worktree metadata, project JSON, media, Git metadata, and project-scoped configuration. `DELETE /api/projects/:id` returns `200` on success and `404` when absent. Production deletion still requires the application's explicit destructive-action confirmation.

## 3. Storage Layout and Git History

Each project owns an independent Git-backed directory containing:

```text
<projectsDir>/<projectId>/
  project.json
  media/
  .git or worktree metadata
  .gitattributes
```

Every successful semantic save produces one immutable commit. Commits are never amended, rebased, or force-pushed. Media and metadata referenced by the snapshot are versioned together.

Git operations MUST be serialized per project. Worktree creation is race-safe and idempotent: concurrent creation observes the winning worktree, validates it, and continues or returns a typed conflict. It MUST NOT surface an avoidable HTTP 500 caused only by `git worktree add` racing another request.

Commits stage only the files intentionally changed by the transaction. Unrelated untracked files, deletions, or worktree residue MUST NOT be silently included. A successful response reports the created commit and the semantic changes it represents.

## 4. Media Storage

File-backed media is stored immutably under a safe real project filename. The
persisted basename and `MediaItem.name` are one invariant and MUST agree.

- A stored binary is never overwritten in place.
- Unsafe path characters and traversal components are removed without replacing
  the semantic filename with a media UUID.
- A filename collision allocates `<stem> <n>.<ext>` and records that same name in
  project JSON.
- A new asset version receives a new media ID and file.
- Upload is `POST /api/projects/:id/media/:mediaId` using multipart data.
- Upload validates project ID, media ID, content limits, extension/MIME consistency, and destination containment.
- Repeated upload of identical bytes MAY return the existing result; conflicting bytes for an existing immutable ID MUST fail.
- Project JSON stores relative/durable identity, never browser object URLs, file handles, or machine-specific absolute paths.

Asset-group and active-version semantics are defined by [Media Assets](./media-assets.md); project snapshots persist those selections.

## 5. Save Transaction

### 5.1 Client Gate

Backend autosave runs only when the project has canonical backend identity and `explicitlyCreated === true`. Draft, identity-reconciliation, queued, persisting, and failed states MUST NOT be presented as successfully persisted.

Before transmission the client removes transient values including `Blob`, `File`, file handles, `blob:` URLs, temporary signed URLs, and UI-only runtime availability state.

### 5.2 Media Completeness

Before writing `project.json`, the backend audits every file-backed `MediaItem` referenced by the incoming snapshot against project-scoped stored media by media ID.

- Required media includes direct library items and media referenced by clips or other persisted domain records.
- Missing required binaries produce `409 MEDIA_INCOMPLETE` with sorted missing media IDs.
- The backend performs no temporary write, final write, index mutation, staging, or commit for a rejected snapshot.
- The client uploads recoverable missing binaries and retries the same logical save once bounded prerequisites complete.
- If bytes cannot be recovered, save fails visibly and preserves the previous backend snapshot.
- The client MUST NOT delete clips or assets merely to make an incomplete save pass.

### 5.3 Atomic Snapshot and Commit

After validation, the backend writes a temporary file, fsyncs where supported, atomically renames it to `project.json`, stages the intentional transaction files, and creates the Git commit. Failure before commit completion returns failure and MUST NOT claim persistence success.

If the filesystem write succeeds but Git commit fails, the operation is failed and requires deterministic recovery or retry. Logs and receipts distinguish snapshot write from confirmed commit.

### 5.4 Persistence Receipt

A successful save returns a receipt containing at least:

```ts
interface PersistenceReceipt {
  projectId: string;
  sourceModifiedAt: string;
  persistedAt: string;
  commitId: string;
  uploadedMediaIds: string[];
}
```

The persistence indicator is successful only when the receipt project ID matches the active project, `sourceModifiedAt` matches the current frontend state, and the commit is confirmed. Late receipts from an older state or project are ignored.

## 6. Autosave Scheduling

Autosave is debounced and serialized per project. At most one write transaction is active for a project; changes arriving during a save schedule a subsequent save using the newest snapshot.

- React remounts, Strict Mode, multiple triggers, or retries MUST NOT create competing project-creation flows.
- Autosave timeout is bounded and produces visible retryable failure.
- Closing or switching projects flushes or explicitly abandons queued work according to a deterministic policy.
- Multiple browser tabs require conflict detection; last-writer-wins MUST NOT be assumed silently.

## 7. Restore and Recovery

Restore uses this priority:

1. Load the canonical project from the backend.
2. Attach durable media URLs returned by the backend and hydrate cached blobs by matching media ID.
3. If the backend is unreachable, use the latest matching local snapshot as a temporary fallback without declaring backend media missing.
4. If neither source contains the requested project, present recovery choices rather than silently creating a replacement.

Backend `404` and transport failure are distinct. Runtime media verification follows [Media Assets](./media-assets.md). Loading a snapshot with missing referenced media remains allowed for recovery, but saving it is still subject to the media-completeness gate.

Legacy local projects with client UUIDs reconcile only through an explicit flow. A unique exact match MAY migrate local identity to an existing backend project after confirmation; zero or multiple matches require user resolution.

## 8. API Contract

| Method | Endpoint | Contract |
|---|---|---|
| `GET` | `/api/projects` | List canonical projects |
| `POST` | `/api/projects` | Explicitly create project and backend identity |
| `GET` | `/api/projects/:id` | Load project snapshot and media manifest |
| `PUT` | `/api/projects/:id` | Validate completeness, atomically save, commit, and return receipt |
| `PATCH` | `/api/projects/:id` | Rename project |
| `DELETE` | `/api/projects/:id` | Remove complete project directory |
| `POST` | `/api/projects/:id/media/:mediaId` | Upload immutable media bytes |
| `GET` | `/api/projects/:id/media/:filename` | Serve stored media with correct range/cache semantics |

All routes validate project containment and reject traversal, malformed IDs, oversized input, and unauthorized access.

## 9. Logging and Problems

Structured logs cover validation, media audit, atomic write, commit start, commit success, receipt, and failure. Logs include project ID and bounded counts/timestamps but exclude binary data, secrets, signed URLs, file handles, and absolute user paths.

Persistence errors are reported through [Problems, Errors & Logging](./problems-errors-logging.md). Transport failures, incomplete media, identity conflicts, and commit failures use distinct codes and recovery actions.

## 10. Required Tests

Deterministic tests MUST cover:

- explicit creation and local-draft gating;
- canonical ID use and legacy UUID reconciliation;
- concurrent worktree creation;
- per-project save serialization;
- media-completeness rejection with zero mutation;
- upload-and-retry success and unrecoverable-byte failure;
- intentional staging without unrelated additions or deletions;
- atomic write and commit failure boundaries;
- truthful receipt and stale-receipt rejection;
- backend-first restore and transport fallback;
- complete project deletion and traversal rejection;
- transient media unavailability never becoming durable missing state.

Browser verification MUST cover explicit creation, visible save progress/success/failure, reload restoration, backend outage recovery, and missing-media repair without data loss.

## 11. Failure Modes

- A local UUID is treated as a backend ID.
- Concurrent creation races worktree setup.
- `project.json` changes before completeness is known.
- Broad Git staging commits unrelated or destructive changes.
- The UI turns green before the matching commit is confirmed.
- A late save receipt updates another project.
- A transport outage is interpreted as project or media absence.
- Restore silently creates a replacement project.
- Project deletion leaves media or repository state behind.
