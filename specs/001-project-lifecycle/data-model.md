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

Canonical backend candidates are installed only after loading succeeds. Strict portable/recovery validation is Future Scope.

## Project File Envelope (existing export; strict validation Future Scope)

- `version: "1.0.0"`: current strict file format.
- `project: Project`: complete supported project data with runtime-only blobs/handles stripped for portable export.
- optional metadata remains supported by `ProjectSerializer`.

The installed serializer normalizes legacy project data. Strict unknown-future-version rejection and non-mutating migration guarantees are deferred.

## Persistence Status

- `projectId: string | null`
- `phase: idle | pending | saving | deferred | committing | retry-wait | persisted | incomplete | conflict | failed`
- `persistedModifiedAt: number | null`
- `baseRevision: ProjectBaseRevision | null`
- `confirmedReceipt: ProjectSaveReceipt | null`
- `conflictingProject: Project | null`
- `error: string | null`

Clean invariant: `confirmedReceipt.projectId === project.id` and `confirmedReceipt.sourceModifiedAt === project.modifiedAt`. Phase may remain `idle` immediately after canonical load.

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

Current invariant: rotating records retain origin identity, name, time, and slot. Newer-only validated offering is Future Scope.

Future Scope restore transition:

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

## Project Transition Request (Future Scope)

- `sourceProjectId: string`.
- `sourceProjectName: string`.
- `targetLabel: string`.
- `choice: save | discard | cancel`.
- `state: awaiting-choice | saving | failed | completed | cancelled`.

Only one transition request is active in the editor UI. Save proceeds only after `forceSave()` resolves with canonical confirmation. Discard affects only the active in-memory session. Cancel performs no replacement.

## Conflict Recovery UI (Future Scope)

- `localProject: Project`: preserved in-memory edit.
- `durableProject: Project | null`: newer server state returned by the conflict or a subsequent read.
- `projectId: string`: must match both states.
- `actions`: export local copy; reload newer durable state; cancel and keep editing.

No automatic merge, semantic difference tree, or per-field resolution is part of this feature.
