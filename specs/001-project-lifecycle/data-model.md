# Project Lifecycle Data Model

## Project

Existing `@openreel/core` aggregate. Required durable fields:

- `id: string`: non-empty stable identity; canonical projects use orchestrator slugs.
- `name: string`: trimmed, non-empty display name.
- `createdAt: number`: finite epoch milliseconds.
- `modifiedAt: number`: finite epoch milliseconds, not earlier than creation.
- `settings: ProjectSettings`: valid dimensions, frame rate, aspect and editing settings.
- `timeline`: tracks, clips, markers, subtitles, duration.
- `mediaLibrary.items`: explicit media references, including missing references.
- `generatedImageDefinitions`: project-owned generated definitions.
- optional text/shape/SVG/sticker overlays and all other supported project fields.

Validation is non-mutating. Candidate projects are installed only after validation succeeds.

## Project File Envelope

- `version: "1.0.0"`: current strict file format.
- `project: Project`: complete supported project data with runtime-only blobs/handles stripped for portable export.
- optional metadata remains supported by `ProjectSerializer`.

Legacy state: a raw `Project` object is treated as version `0` and migrated in memory into the current envelope. Unknown future versions are rejected. The original source bytes/file remain unchanged.

## Persistence Status

- `projectId: string | null`
- `phase: idle | pending | saving | deferred | committing | retry-wait | persisted | incomplete | conflict | failed`
- `persistedModifiedAt: number | null`
- `baseRevision: ProjectBaseRevision | null`
- `confirmedReceipt: ProjectSaveReceipt | null`
- `conflictingProject: Project | null`
- `error: string | null`

Clean invariant: the status belongs to the active project, represents confirmed durable state, and `persistedModifiedAt === project.modifiedAt`.

## Save Intent

- `projectId: string`: immutable origin identity.
- `baseRevision: ProjectBaseRevision`: last confirmed canonical base.
- `project: Project`: complete snapshot captured at scheduling time.
- `saveIntent: autosave | user | recovery | retry` as already defined by the shared request contract; `user` is the explicit-save intent.
- `requiredMediaManifest`: verified media identities for the captured snapshot.

Queued/retry state is keyed by `projectId`; it is never reconstructed from whichever project is active at completion time.

## Recovery Record

- `id: string`: `${projectId}-slot-${slot}`.
- `projectId: string`: stable origin identity.
- `projectName: string`.
- `timestamp: number`.
- `slot: number`.
- `data: string`: serialized project data.

Offer invariant: only the newest valid record for the requested project whose timestamp is later than the durable project's `modifiedAt` is offered.

Restore transition:

```text
candidate record
  -> parse/version/shape validation
  -> projectId equality check
  -> load authoritative base revision
  -> install recovered snapshot locally
  -> active dirty/recovered state
  -> explicit save
  -> new durable automatic version
```

Any failure before installation leaves both active and durable state unchanged.

## Project Transition Request

- `sourceProjectId: string`.
- `sourceProjectName: string`.
- `targetLabel: string`.
- `choice: save | discard | cancel`.
- `state: awaiting-choice | saving | failed | completed | cancelled`.

Only one transition request is active in the editor UI. Save proceeds only after `forceSave()` resolves with canonical confirmation. Discard affects only the active in-memory session. Cancel performs no replacement.

## Conflict Recovery

- `localProject: Project`: preserved in-memory edit.
- `durableProject: Project | null`: newer server state returned by the conflict or a subsequent read.
- `projectId: string`: must match both states.
- `actions`: export local copy; reload newer durable state; cancel and keep editing.

No automatic merge, semantic difference tree, or per-field resolution is part of this feature.
