# Data Model: Media Library and Import

## Media Asset

Existing stable project entity. The implementation preserves `id` across re-import, replace, and relink.

| Field group | Contents | Rules |
|---|---|---|
| Identity | `id`, source filename, size, last-modified, optional folder hint | `id` is stable; source filename is not editable; exact identity is filename + size + last-modified for re-import |
| User metadata | title, description, tags, group | Tags trim and deduplicate case-insensitively; mutations are atomic |
| Technical metadata | type, duration, dimensions, frame rate, codec, sample rate, channels, file size | Non-finite/negative source values are normalized or rejected with diagnostics |
| Preview | thumbnail, filmstrip, waveform | Derivative failure is visible but does not necessarily invalidate source media |
| Provenance | version relationship, generation metadata | Preserved on replace/relink |
| Availability | available, missing, unrealized/pending, error | Transient/offline/cancelled verification is not confirmed missing |

## Import Policy

| Field | Type | Validation |
|---|---|---|
| `maxSourceBytes` | positive integer | Defaults to 2 GiB; configuration must be finite and greater than zero |
| `knownAvailableBytes` | non-negative integer or unknown | Derived from quota minus usage when both are reliable |
| `runtimeLimitBytes` | positive integer or unknown | Optional lower platform-specific bound |

The effective known limit is the minimum of configured maximum, known runtime limit, and known available capacity. Unknown evidence cannot be labeled as a capacity rejection.

## Import Result

One result exists per submitted file.

| Field | Type | Notes |
|---|---|---|
| `file` | source identity | Filename and byte size always present |
| `status` | `durable-success \| degraded-success \| rejected \| failed` | Discriminant |
| `stage` | `preflight \| decode \| derivative \| local-persistence \| backend-upload \| recovery-handle` | Furthest relevant stage |
| `mediaId` | stable ID or absent | Present after project record creation |
| `reason` | typed code or absent | Cap, capacity, capability, format, decode, persistence, upload, handle, or unknown |
| `message` | string | User-actionable summary |
| `warnings` | string array | Non-fatal derivative or recovery degradation |
| `recoveryAction` | retry/relink/open-settings/none | Must match available UI action |

State transitions:

```text
submitted -> preflight
preflight -> rejected
preflight -> decoding -> failed
decoding -> persisting -> durable-success
decoding -> persisting -> degraded-success
durable-success -> upload-warning (local success remains valid)
```

## Media Dependency Summary

| Field | Type | Rules |
|---|---|---|
| `mediaId` | string | Asset under consideration |
| `timelineClipIds` | string[] | Every clip whose `mediaId` matches |
| `protectedWorkflowRefs` | typed reference[] | Existing workflow records that protect the asset |
| `total` | integer | Sum of dependency counts |

Deletion is allowed only when `total === 0`. No dependent entity is deleted implicitly.

## Media Mutation Result

Used for deletion and insertion orchestration.

- Success includes the changed stable identifiers.
- Blocked includes dependency counts and types.
- Failure includes operation, project ID, media ID, target ID when applicable, stage, and actionable message.
- Cleanup failure is distinct from model failure because the undoable project change may already have succeeded.

## Verification Outcome

Retain the existing versioned outcome model and guards:

- `available`
- `missing` only with confirmed absence evidence
- `transient`, `offline`, or `cancelled`
- invalid response, wrong type, truncated data, timeout, or decode error

An outcome applies only if project ID, media ID, URL, and verification generation still match the active state.

