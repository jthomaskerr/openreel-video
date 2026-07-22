# Data Model: DaVinci Resolve and iMovie Export

**Feature**: `006-resolve-imovie-export`
**Scope**: Transient handoff state and generated artifacts. No new persisted project entities or database schema.

## Existing Source Entities

### Project

Source: `packages/core/src/types/project.ts`

Relevant fields:

- `id`, `name`
- `settings.width`, `settings.height`, `settings.frameRate`
- `timeline`
- `mediaLibrary.items`
- project-level text, shape, SVG, and sticker clips used by compatibility assessment

### Timeline

Source: `packages/core/src/types/timeline.ts`

Relevant fields:

- `tracks[]`
- `duration`
- `subtitles[]`
- `markers[]`

### Track

Relevant fields:

- `id`, `name`, `type`
- ordered `clips[]` and `transitions[]`
- `hidden`, `muted`, `solo`, `locked`

### Clip

Relevant fields:

- identity: `id`, `type`, `mediaId`, `trackId`
- timing: `startTime`, `duration`, `inPoint`, `outPoint`
- material behavior: effects, audio effects, transform, blend, volume, mute, fade, automation, keyframes, speed, reverse, stabilization, emphasis animation, audio-track selection, metadata

### MediaItem

Relevant fields:

- identity: `id`, immutable source `name`, `type`
- local sources: `blob`, `fileHandle`, persisted media record
- external sources: `remoteUrl`, `originalUrl`
- matching hint: `sourceFile`
- technical `metadata`

## New Core Entities

### HandoffTargetProfile

Defines a versioned destination contract.

| Field | Type | Rules |
|-------|------|-------|
| `id` | `"resolve" | "imovie"` | Stable identifier |
| `label` | string | User-visible destination name |
| `mode` | `"editable" | "flattened"` | Must match target behavior |
| `contractVersion` | string | `fcpxml-1.10` or maintained MOV profile |
| `applicationVersions` | string[] | Versions with completed compatibility evidence |
| `requiredCapabilities` | string[] | Directory write for Resolve; MOV/AVC/AAC encode for iMovie |
| `issueMatrixVersion` | string | Changes whenever representability rules change |

Validation:

- Target IDs are unique and immutable.
- A profile is not advertised as supported until `applicationVersions` is non-empty.
- Editable targets must define an interchange contract.
- Flattened targets must define a render profile.

### HandoffSelection

Captures the requested target and timeline range.

| Field | Type | Rules |
|-------|------|-------|
| `target` | target ID | Required |
| `range` | `ExportRange` | Resolved by existing range rules |
| `projectId` | string | Must match the project snapshot |
| `projectModifiedAt` | number | Detects stale assessment before execution |

Validation:

- `endTime > startTime`.
- Range must be within the effective timeline duration.
- A plan cannot execute if the project modification timestamp changed after assessment.

### Timebase

Represents frame-accurate rational time.

| Field | Type | Rules |
|-------|------|-------|
| `framesPerSecondNumerator` | positive integer | For example 30000 |
| `framesPerSecondDenominator` | positive integer | For example 1001 |
| `frameDurationNumerator` | positive integer | Reciprocal numerator |
| `frameDurationDenominator` | positive integer | Reciprocal denominator |
| `sourceFrameRate` | number | Original project setting |

Derived operations:

- seconds → nearest frame index;
- frame index → reduced rational seconds;
- start/end seconds → `FrameRange`;
- source-range offset → rational source time.

Validation:

- Reject non-finite, zero, or negative frame rates.
- Recognize canonical fractional rates within a documented epsilon.
- All serialized numerators and denominators are safe integers.

### FrameRange

| Field | Type | Rules |
|-------|------|-------|
| `startFrame` | non-negative integer | Inclusive |
| `endFrame` | positive integer | Exclusive and greater than start |
| `durationFrames` | positive integer | Exactly `endFrame - startFrame` |

### HandoffEntityRef

Identifies the subject of an issue without retaining an object reference.

| Field | Type | Rules |
|-------|------|-------|
| `kind` | `project | track | clip | media | export` | Required |
| `id` | string | Stable source identifier |
| `label` | string | Sanitized display label; no native path or signed URL |
| `trackIndex` | integer or null | Used for deterministic ordering |
| `timelineFrame` | integer or null | Used for deterministic ordering |

### CompatibilityIssue

| Field | Type | Rules |
|-------|------|-------|
| `code` | stable string union | Namespaced, for example `resolve.unsupported-speed` |
| `severity` | `blocking | flattening | info` | Required |
| `entity` | `HandoffEntityRef` | Required |
| `message` | string | User-facing and actionable |
| `action` | string | Relink, change edit, choose MOV, grant permission, or retry |
| `retryable` | boolean | True only when retry can succeed without project edits |
| `details` | redacted record | No native paths, media bytes, credentials, or signed URLs |

Validation:

- Issue codes are unique per entity and condition.
- Blocking issues prevent plan execution.
- Material unsupported edits cannot be `info`.
- Output order is severity, track index, frame, entity ID, then code.

### CompatibilityAssessment

| Field | Type | Rules |
|-------|------|-------|
| `assessmentId` | deterministic digest | Derived from project ID/version, target, range, and matrix version |
| `target` | target ID | Required |
| `selection` | `HandoffSelection` | Required |
| `timebase` | `Timebase` | Required |
| `status` | `ready | blocked` | Derived from issues |
| `issues` | `CompatibilityIssue[]` | Deterministically sorted |
| `includedTrackIds` | string[] | Project order |
| `includedClipIds` | string[] | Track order, then frame, then ID |
| `requiredMediaIds` | string[] | Unique and sorted |
| `createdAt` | number | Diagnostic only; excluded from deterministic document comparison |

Validation:

- `status = blocked` if any issue is blocking.
- Every included media-backed clip has a required media ID.
- Assessment must be recomputed if the project changes.

### MediaReference

| Field | Type | Rules |
|-------|------|-------|
| `mediaId` | string | Unique in a plan |
| `sourceName` | string | Immutable media name |
| `outputName` | string | Sanitized and collision-safe |
| `relativeUrl` | string | Percent-encoded `Media/<outputName>` |
| `type` | media type | Video, audio, or image for Resolve contract |
| `duration` | rational time or null | From validated metadata when available |
| `hasVideo` | boolean | Derived |
| `hasAudio` | boolean | Derived |
| `resolutionSource` | transient enum | Blob, persisted blob, file handle, verified URL |

Validation:

- One reference per required media ID.
- Output names are unique under case-insensitive comparison.
- Relative URLs cannot escape the `Media/` directory.
- `resolutionSource` never appears in the compatibility report.

### ProjectedClip

The export-range-relative, frame-aligned clip representation.

| Field | Type | Rules |
|-------|------|-------|
| `clipId`, `trackId`, `mediaId` | string | Source identities |
| `trackIndex`, `lane` | integer | Deterministic destination placement |
| `timelineRange` | `FrameRange` | Rebased to export frame zero |
| `sourceStartFrame` | non-negative integer | Includes boundary trim |
| `sourceDurationFrames` | positive integer | Matches projected duration for normal speed |
| `enabled` | boolean | Hidden/muted policy already applied |
| `kind` | `video | audio | image` | Supported editable kinds |
| `mediaReferenceId` | string | Resolves to one `MediaReference` |

Validation:

- Timeline range intersects the selected export range.
- Source range stays within known source duration when metadata is available.
- Nonzero source content cannot collapse to zero frames.

### TimelineHandoffPlan

| Field | Type | Rules |
|-------|------|-------|
| `planId` | deterministic digest | Stable for unchanged source and selection |
| `assessmentId` | string | Must refer to a ready assessment |
| `project` | name, width, height | Sanitized snapshot |
| `targetProfile` | profile snapshot | Versioned |
| `selection` | `HandoffSelection` | Required |
| `timebase` | `Timebase` | Required |
| `durationFrames` | positive integer | Selected range duration |
| `tracks` | projected track summaries | Source order |
| `clips` | `ProjectedClip[]` | Deterministic order |
| `media` | `MediaReference[]` | Unique deterministic mapping |
| `issues` | non-blocking issues | Copied from assessment |
| `artifacts` | artifact descriptors | Target-specific |

Validation:

- Cannot be created from a blocked or stale assessment.
- All clip references resolve.
- Artifact paths are unique, relative, and traversal-safe.

### HandoffArtifact

| Field | Type | Rules |
|-------|------|-------|
| `kind` | `fcpxml | movie | media | report` | Required |
| `relativePath` | string | Deterministic and traversal-safe |
| `mediaType` | string | Required |
| `required` | boolean | Required artifacts gate completion |
| `byteLength` | number or null | Set after write |
| `sha256` | string or null | Set after write when available |
| `status` | `planned | writing | written | failed | cancelled` | State transition controlled |

### CompatibilityReport

Structured source for the Markdown report.

| Field | Type | Rules |
|-------|------|-------|
| `schemaVersion` | `"1.0"` | Required |
| `project` | ID and display name | Required |
| `target` | ID, label, mode, application versions, contract version | Required |
| `range` | start/end/duration frames and display times | Required |
| `artifacts` | safe relative paths, hashes, sizes, status | Required |
| `issues` | non-sensitive issue projection | Required |
| `substitutions` | list | Empty in initial Resolve contract |
| `unsupportedItems` | list | Required when present |
| `result` | completed, failed, or cancelled summary | Required |
| `generatedAt` | ISO timestamp | Required but excluded from equivalence tests |

## New Web Entities

### HandoffOperation

Transient state owned by the web coordinator.

| Field | Type | Rules |
|-------|------|-------|
| `operationId` | unique string | One active operation per toolbar |
| `target` | target ID | Required |
| `phase` | `HandoffPhase` | State-machine controlled |
| `progress` | 0..1 | Monotonic within a phase |
| `assessment` | assessment or null | Set after assessment |
| `plan` | plan or null | Set only when ready |
| `currentEntity` | safe entity ref or null | Progress detail |
| `artifacts` | artifact states | Updated after successful writes |
| `error` | typed failure or null | Visible and diagnostic-safe |
| `abortController` | runtime object | Never serialized |

### HandoffFailure

| Field | Type | Rules |
|-------|------|-------|
| `code` | stable failure code | Required |
| `stage` | handoff phase | Required |
| `message` | string | User-visible |
| `entity` | safe entity ref or null | When applicable |
| `retryable` | boolean | Required |
| `cause` | unknown, diagnostics only | Redacted before logging |

## Relationships

```text
Project
  └── HandoffSelection
        └── CompatibilityAssessment
              ├── CompatibilityIssue*
              └── TimelineHandoffPlan (ready assessments only)
                    ├── ProjectedClip*
                    │     └── MediaReference
                    ├── HandoffArtifact*
                    └── CompatibilityReport

HandoffOperation
  ├── CompatibilityAssessment
  ├── TimelineHandoffPlan
  ├── HandoffArtifact state*
  └── HandoffFailure?
```

## State Transitions

### Handoff Operation

```text
idle
  → assessing
      → blocked
      → awaiting-destination
          → resolving-media      # Resolve
              → packaging
          → rendering            # iMovie
              → packaging
          → saving
              → completed

assessing | awaiting-destination | resolving-media | rendering | packaging | saving
  → cancelled
  → failed
```

Rules:

- `blocked`, `completed`, `cancelled`, and `failed` are terminal.
- Only `ready` assessments can enter `awaiting-destination`.
- Resolve never enters `rendering` in the initial contract.
- iMovie never enters `resolving-media`.
- `completed` requires every required artifact to be `written`.
- Cancellation checks occur before and after each external await and media chunk boundary.

### Artifact

```text
planned → writing → written
                 ↘ failed
                 ↘ cancelled
```

An artifact never transitions out of a terminal state. Existing partial files are not promoted or named as import-ready by OpenReel.

## Determinism Boundary

These values participate in plan equivalence:

- project ID and modification timestamp;
- target and contract versions;
- selected range;
- timebase;
- track/clip/media mappings;
- issue codes and affected identities;
- artifact relative paths and contents.

These values do not participate:

- assessment/report timestamps;
- operation ID;
- progress;
- local native destination path;
- media resolution source;
- diagnostic elapsed times.
