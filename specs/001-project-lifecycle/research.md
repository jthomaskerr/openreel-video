# Project Lifecycle Research

## Decision 1: Preserve the canonical save architecture

**Decision**: Keep browser `BackendSaveService` → orchestrator `executeSaveTransaction` → `ProjectStore`/`GitStore` as the only canonical durable path.

**Rationale**: Focused baseline suites already prove locking, base-revision rejection, journaling, verified media, rollback, crash recovery, semantic Git commits, newest-first history, and read-only historical retrieval. The defects are at browser lifecycle boundaries, not in the durable transaction.

**Alternatives considered**:

- Independent project worker: rejected for current scope because it is unimplemented and explicitly Future Scope.
- Browser-local canonical state: rejected because it would weaken the proven revision and Git transaction guarantees.
- New persistence framework: rejected because it duplicates established working behavior.

## Future Decision 2: Reuse and tighten the existing core project serializer

**Decision**: Deferred. A future feature may extract a pure versioned project-file decoder beside `ProjectSerializer`, then make portable import/export and recovery use it.

**Rationale**: `ProjectSerializer` already defines a `1.0.0` envelope, validation results, normalization, missing-media placeholders, and tests. The current unsafe paths bypass it. A pure decoder gives every path one deterministic shape/version/identity gate without requiring an IndexedDB storage engine.

**Alternatives considered**:

- Add another schema library: rejected because no new dependency is needed for the existing fixed envelope and required top-level invariants.
- Keep per-call-site `JSON.parse` casts: rejected because those casts caused the demonstrated import and recovery defects.
- Reject all raw project JSON: rejected because raw `.oreel` files are the shipped legacy format and must migrate safely.

## Future Decision 3: Treat raw project JSON as the single supported legacy format

**Decision**: Deferred. The installed serializer continues its current envelope and legacy normalization behavior; strict future-version rejection and non-mutating migration remain Future Scope.

**Rationale**: This provides an ordered, deterministic migration for the actual installed format while failing closed for unknown future data. File APIs already leave original bytes unchanged unless the user later saves explicitly.

**Alternatives considered**:

- Best-effort load of any version: rejected because it can partially install unsupported state.
- Full semver package: rejected because current files use one strict numeric version and prerelease/range semantics are unnecessary.
- Mutate the imported file during migration: rejected because it violates source preservation and makes failed migration destructive.

## Decision 4: Use confirmed persistence metadata as the authoritative dirty state

**Decision**: A project is clean only when `confirmedReceipt.projectId` equals the active project ID and `confirmedReceipt.sourceModifiedAt` equals the active project's `modifiedAt`. The phase is not authoritative because canonical load confirms a receipt while leaving the phase `idle`.

**Rationale**: `ProjectManager.hasUnsavedChanges` relies on an unused ad hoc `lastSavedAt`; the persistence store already owns the confirmed revision and timestamp used by the toolbar. One pure helper prevents dialog, unload, and save behavior from disagreeing.

**Alternatives considered**:

- Timeline/action-history length: rejected because project-owned data spans multiple stores and engines.
- File-handle presence: rejected because managed workspace storage is canonical and a file handle only identifies an export copy.
- A second dirty boolean: rejected because it can drift from confirmed durable state.

## Decision 5: Keep work project-bound without introducing a worker

**Decision**: Key scheduled snapshots, retries, and recovery-save events by stable project ID; an old completion may update only its own queue/receipt and never schedule the currently active project.

**Rationale**: The current singleton `scheduledProject` and identity-blind autosave callback are concrete cross-project hazards. A per-project queue/map is a local correction that preserves the service architecture.

**Alternatives considered**:

- Cancel all old work on switch: rejected because it can silently discard required persistence.
- Durable background worker and listener bus: rejected because it is explicitly Future Scope.
- Continue using the active project at callback time: rejected because it is the demonstrated identity-rebinding bug.

## Future Decision 6: Make user recovery choices explicit and accessible

**Decision**: Deferred. Current scope retains automatic project-bound persistence and native dirty-unload protection. Dedicated Save / Discard / Cancel and conflict-recovery dialogs remain Future Scope.

**Rationale**: These dialogs would add explicit user control and richer accessible feedback, but are not required for correctness once automatic work remains project-bound and dirty unload is protected.

**Alternatives considered**:

- Project-bound automatic save: retained for current scope because it preserves existing product behavior.
- Chained `window.confirm` prompts: rejected because the choices and consequences are ambiguous.
- Semantic field-level difference resolver: rejected because it is explicitly Future Scope.

## Future Decision 7: Restore recovery copies as unsaved active state

**Decision**: Deferred. A future recovery-hardening feature may validate identity/version first and install a recovered snapshot locally without an immediate backend save.

**Rationale**: This would provide a safer preview-style recovery contract, but changes installed recovery semantics and is not required for minimal canonical create/open/save operation.

**Alternatives considered**:

- Treat clicking Restore as an immediate durable save: retained for current scope to match the installed behavior.
- Create a separate backend project automatically: rejected because it changes identity without user intent.
