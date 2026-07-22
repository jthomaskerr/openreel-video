# Research: Media Library and Import

## Decision 1: Extend the existing media pipeline

**Decision**: Keep `MediaImportService`, the web project store, `media-storage`, and `AssetsPanel` as the decoding, mutation, durability, and presentation layers respectively.

**Rationale**: The current implementation already handles metadata extraction, thumbnail generation, stable project records, IndexedDB blobs, optional backend upload, re-import replacement, and timeline insertion. The feature gaps are explicit outcomes and safety checks, not missing infrastructure.

**Alternatives considered**:

- A new asset service or state store: rejected because it would duplicate ownership and risk divergent media identity.
- Moving browser persistence into `@openreel/core`: rejected because StorageManager, IndexedDB, and file handles are web-runtime concerns.

## Decision 2: Use preflight policy plus browser-native capacity evidence

**Decision**: Apply a configurable byte cap with a 2 GiB default, then consult `navigator.storage.estimate()` when available. Model configuration, known capacity, and capability failures separately.

**Rationale**: `File.size` permits deterministic boundary validation without reading file bytes. StorageManager is the established browser mechanism for quota/usage estimates and avoids another dependency. Estimates are advisory, so unavailable or incomplete values must not be presented as certain capacity failures.

**Alternatives considered**:

- Allocate/read the file to test feasibility: rejected because it defeats early rejection and can exhaust memory.
- Infer capacity from device memory alone: rejected because it does not measure storage quota and is inconsistently available.
- Add a quota-management library: rejected because browser-native primitives cover the required evidence and a wrapper would not make estimates authoritative.

## Decision 3: Represent batch completion as data

**Decision**: Use a discriminated per-file outcome and derive a batch summary from those outcomes.

**Rationale**: The current UI discards unsuccessful return values. A typed outcome makes continuation, itemized feedback, structured diagnostics, accessibility announcements, and deterministic tests share one source of truth.

**Alternatives considered**:

- Throw on any failed file: rejected because it aborts batch continuation and conflates expected rejection with exceptional failure.
- Log-only failures: rejected because users cannot recover and tests cannot assert the operational result.

## Decision 4: Local durability defines imported success

**Decision**: A result is `durable` only after the local blob save completes. Decode success with failed local persistence is a `degraded` retryable result. Backend upload remains optional and asynchronous but its eventual failure is observable.

**Rationale**: Project metadata without recoverable bytes does not survive a reload reliably. Local persistence is the immediate source of truth; backend upload adds recovery but should not stall local editing.

**Alternatives considered**:

- Roll back every project record when persistence fails: rejected because decoded data may remain usable and can be retried/relinked.
- Treat record creation as complete success: rejected because it produces broken assets after reload.

## Decision 5: Block referenced deletion before mutation

**Decision**: Scan typed project references and return a dependency summary before dispatching the undoable removal action. Do not cascade.

**Rationale**: Stable media IDs are referenced by timeline clips and workflow data. Blocking preserves edits and matches the clarified product policy. Cleanup after model mutation keeps undo ownership in the project action while making blob-cleanup failure separately visible.

**Alternatives considered**:

- Cascade-delete clips: rejected as destructive and explicitly out of scope.
- Leave orphaned clip references: rejected because preview and export would fail later.

## Decision 6: Return insertion results instead of silent exits

**Decision**: `insertMediaAtCurrentTime` returns a typed success/error result, with UI notification at the caller boundary.

**Rationale**: The helper already owns track compatibility and time capture. Returning structured failure preserves testability without coupling the helper directly to toast UI.

**Alternatives considered**:

- Throw for expected missing/locked state: rejected because these are actionable domain outcomes.
- Toast inside the helper: rejected because it couples deterministic placement logic to presentation state.

