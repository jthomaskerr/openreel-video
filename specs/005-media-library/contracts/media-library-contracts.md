# Media Library Contracts

These are internal typed boundaries. They document behavior to preserve while concrete names may be aligned with existing project types.

## Import preflight

**Input**: source filename, byte size, configured maximum, optional known available bytes, optional runtime limit.

**Output**:

- accepted, including the effective limit evidence; or
- rejected with exactly one primary reason: `configured-cap`, `available-capacity`, or `runtime-capability`.

Preflight must not read or allocate the complete source file.

## Per-file import

**Input**: one browser `File` and current project context.

**Output**: exactly one `Import Result` from [data-model.md](../data-model.md). Expected rejection and decode failure are returned, not thrown. Unexpected infrastructure exceptions are caught at the batch boundary and converted to a failed result. Later files continue.

Stable-identity contract:

- Exact re-import updates the existing `mediaId`.
- User metadata, version/generation provenance, and references remain unchanged.
- Source bytes, source identity, technical metadata, and derivatives may change.

## Import batch

**Input**: ordered files.

**Progress event**: filename, one-based index, total, and stage.

**Completion**: ordered per-file results and counts for durable, degraded, rejected, and failed. The UI exposes itemized messages and available retry/relink actions in an accessible status surface.

## Delete media

**Input**: project ID and media ID.

**Output**:

- `blocked`: dependency summary, no state change;
- `deleted`: undoable model removal completed and blob cleanup completed; or
- `cleanup-failed`: model removal completed, cleanup error visible and retryable.

The operation never cascades to timeline clips or protected workflow records.

## Insert media

**Input**: media ID plus a captured insertion context.

**Placement order**:

1. active compatible unlocked track;
2. first compatible unlocked track;
3. newly created compatible track.

**Success**: media ID, clip ID, track ID, and captured start time; only the new clip is selected and its track activated.

**Failure**: typed stage (`resolve-media`, `resolve-track`, `create-track`, `create-clip`), relevant identifiers, and actionable message. Selection and active-track state do not claim success.

## Structured diagnostics

Every non-cancellation failure records operation, project ID, media ID when known, source filename when applicable, stage/reason, and underlying error details safe for local diagnostics. User-facing messages avoid raw stack traces.

