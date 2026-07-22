# Data Model: Unified Runtime Logs

**Contract version**: 1  
**Wire contract**: [contracts/openapi.yaml](./contracts/openapi.yaml)

## RuntimeLogIngressEntryV1

One frontend-produced event accepted by `POST /api/logs`. The backend never trusts producer-provided persistence fields.

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `schemaVersion` | literal `1` | Yes | Other versions return `unsupported_schema_version`. |
| `id` | UUID string | Yes | Maximum 64 characters; stable across retries. |
| `source` | `frontend` or `interaction` | Yes | Backend events do not enter through HTTP. |
| `eventType` | `console` or `interaction` | Yes | Must match `source`. |
| `level` | `debug`, `log`, `info`, `warn`, or `error` | Yes | Interaction entries use `info`. |
| `occurredAt` | ISO-8601 UTC string | Yes | Valid date; retained even when producer clock differs. |
| `sessionId` | string | Yes | 1-128 safe characters; generated per browser tab/session. |
| `correlationId` | string | No | 1-128 safe characters; request/job/project operation identifier, never a credential. |
| `arguments` | `RuntimeLogArgumentMap` | Yes | Keys must be contiguous `arg0` through `argN`; total encoded entry stays within configured bytes. |
| `metadata` | `RuntimeLogMetadataV1` | Yes | Bounded public diagnostic context only. |

Producer attempts to send `receivedAt`, `sequence`, file paths, authentication data, or unknown top-level properties are rejected rather than silently retained.

## RuntimeLogRecordV1

The only record persisted in active and archived files.

| Field | Type | Origin | Validation |
|-------|------|--------|------------|
| `schemaVersion` | literal `1` | Shared contract | Immutable. |
| `id` | UUID string | Producer | Unique across the retained file set; retries return the existing sequence. |
| `source` | `frontend`, `backend`, or `interaction` | Producer/service | Backend capture sets `backend`. |
| `eventType` | `console`, `backend`, or `interaction` | Producer/service | Must match source. |
| `level` | supported level | Producer/service | Immutable after acceptance. |
| `occurredAt` | ISO-8601 UTC string | Producer | May precede/follow receipt time because of clock skew. |
| `receivedAt` | ISO-8601 UTC string | Backend clock | Assigned exactly once on first acceptance. |
| `sequence` | non-negative safe integer | Backend service | Strictly increases across all accepted records and restarts. |
| `sessionId` | bounded string | Producer/service | Backend uses one process-session ID. |
| `correlationId` | bounded string | Optional producer/service context | Redacted and omitted if unsafe. |
| `arguments` | argument map | Normalizer/redactor | JSON-safe, bounded, recursively redacted. |
| `metadata` | metadata object | Producer/service | JSON-safe public context only. |
| `diagnostics` | `RuntimeLogDiagnosticsV1` | Normalizer/redactor | Explicit counts/flags for redaction, truncation, unsupported values, or repaired delivery. |

## RuntimeLogArgumentMap

A JSON object whose keys are stable positional names.

```text
arg0 -> first console argument
arg1 -> second console argument
argN -> Nth console argument
```

Rules:

- Keys are contiguous and zero-based; empty console calls produce an empty map.
- Nested object keys and array order are preserved within size and depth limits.
- Getters are not invoked deliberately. Own enumerable property read failures become typed placeholders.
- Redacted properties retain their key with a redaction placeholder.
- Oversized values become truncation placeholders before the complete entry exceeds its configured byte limit.

## RuntimeLogValue

Recursive JSON-safe union:

- `null`, boolean, finite number, or string
- `RuntimeLogValue[]`
- `{ [key: string]: RuntimeLogValue }`
- `RuntimeLogPlaceholderV1`

`NaN`, positive/negative infinity, `undefined`, bigint, symbol, function, binary data, throwing getters, circular references, excessive depth, and excessive size are never silently discarded. They become placeholders.

## RuntimeLogPlaceholderV1

| Field | Type | Meaning |
|-------|------|---------|
| `$type` | `redacted`, `truncated`, `circular`, `unsupported`, `unreadable`, `error`, or `html` | Discriminator. |
| `reason` | bounded string | Stable machine-readable reason; required except for `error`/`html` when not applicable. |
| `originalType` | bounded string | Optional source type such as `bigint`, `Blob`, or `Function`. |
| `preview` | bounded string | Optional safe preview; never used for redacted values. |
| `name` | bounded string | Error name when `$type` is `error`. |
| `message` | bounded redacted string | Error message when `$type` is `error`. |
| `stack` | bounded redacted string | Error stack when `$type` is `error`. |
| `cause` | `RuntimeLogValue` | Normalized error cause when available. |
| `html` | bounded string | Sanitized inert markup when `$type` is `html`. |

Only fields valid for the selected discriminator are emitted.

## RuntimeLogMetadataV1

Bounded object for non-payload diagnostic context.

| Field | Type | Applies to | Rules |
|-------|------|------------|-------|
| `pagePath` | string | Frontend/interaction | Pathname only; query and hash removed. |
| `userAgentFamily` | string | Frontend | Coarse family only; no full fingerprint. |
| `interactionType` | allowlisted string | Interaction | `click`, `submit`, `navigate`, or configured shortcut identifier. |
| `target` | `InteractionTargetV1` | Interaction | Text-free safe descriptor. |
| `modifiers` | object of booleans | Interaction shortcut | `alt`, `ctrl`, `meta`, `shift`; no raw key sequence. |
| `backendComponent` | bounded string | Backend | Known component/service label. |
| `processSessionId` | UUID string | Backend | Correlates events from one orchestrator process. |

Unknown metadata fields fail validation at ingress. Backend-originated metadata is constructed locally.

## InteractionTargetV1

| Field | Type | Validation |
|-------|------|------------|
| `tag` | lowercase tag name | Required. |
| `role` | bounded allowlisted role | Optional. |
| `safeId` | bounded string | Optional and only from an explicit `data-log-id`; ordinary DOM IDs are not trusted. |
| `path` | array of `{tag, index}` | Bounded depth; no text, class names, names, values, URLs, or arbitrary attributes. |

## RuntimeLoggingPublicConfigV1

Returned by `GET /api/logs/config`; contains no file paths, tokens, or internal retention details.

| Field | Type | Default | Validation |
|-------|------|---------|------------|
| `schemaVersion` | literal `1` | `1` | Immutable. |
| `enabled` | boolean | `true` | Invalid environment value fails closed to `false` and produces startup fallback diagnostics. |
| `captureInteractions` | boolean | `false` | Invalid/absent is false. |
| `maxEntryBytes` | integer | `262144` | 4 KiB to 1 MiB. |
| `serializationDepth` | integer | `8` | 1 to 20. |
| `queueMaxEntries` | integer | `500` | 10 to 5000. |
| `queueMaxBytes` | integer | `1048576` | At least `maxEntryBytes`; maximum 16 MiB. |
| `allowedInteractionTypes` | string array | `click`, `submit`, `navigate`, configured shortcuts | Unique allowlisted values only. |

## RuntimeLoggingPrivateConfig

Backend-only validated settings:

- `logDir`: absolute directory, default `~/.openreel/logs`
- `activeFilename`: fixed `runtime.json`
- `maxFileBytes`: default 10 MiB; minimum 64 KiB; maximum 1 GiB
- `retainedFileCount`: default 5 including active; range 1-100
- `maxEntryBytes`, `serializationDepth`, queue limits, and interaction settings used to derive public config
- `sensitiveKeys`: built-in set plus configured additions

Secrets and bearer tokens are never part of this object except in the existing authentication configuration outside the runtime-log contract.

## RuntimeLogFileV1

Each active/archive file is one independently parseable JSON document:

```json
{
  "schemaVersion": 1,
  "fileId": "UUID",
  "createdAt": "2026-07-22T00:00:00.000Z",
  "entries": []
}
```

Records are stored one compact JSON object per physical line inside `entries`. Newlines inside values are escaped by JSON encoding. Archives are named `runtime.1.json` through `runtime.4.json` for the five-file default.

Validation rules:

- Every file parses as a complete JSON document during normal operation.
- Every record validates as `RuntimeLogRecordV1`.
- Sequences strictly increase within and across archive order.
- IDs are unique across retained files.
- The active file may exceed `maxFileBytes` by no more than one already-bounded encoded record; rotation occurs before the following append.
- Startup recovery may truncate an incomplete final physical record only. It emits a fallback diagnostic and rewrites a valid envelope atomically before new acceptance.

## State Transitions

### Ingress entry

```text
captured
  -> normalized
  -> redacted-in-browser
  -> queued
  -> delivering
      -> accepted -> persisted
      -> duplicate -> persisted-existing
      -> retryable-failure -> queued (bounded attempts)
      -> terminal-rejection -> dropped-with-fallback-diagnostic
```

Queue overflow transitions the oldest lowest-severity queued entry to `dropped-with-fallback-diagnostic`. Original console output is independent of every state.

### Backend service

```text
received/backend-captured
  -> validated
  -> authoritative-redaction
  -> duplicate-check
      -> duplicate-result
      -> sequence-assigned
          -> writer-queued
              -> persisted
              -> persistence-failed-with-stderr-fallback
```

### Active file

```text
absent -> initialized
invalid-tail -> repaired -> initialized
initialized -> appending -> initialized
initialized -> threshold-reached -> rotating -> archived + new initialized
rotation-failed -> unavailable-with-stderr-fallback -> recovery-attempt-on-next-write/startup
```

File operations are serialized; no two transitions mutate the same file concurrently.
