# Project Lifecycle Research

## Decision 1: Preserve the canonical save architecture

**Decision**: Keep browser `BackendSaveService` → orchestrator `executeSaveTransaction` → `ProjectStore`/`GitStore` as the only canonical durable path.

**Rationale**: Focused baseline suites already prove locking, base-revision rejection, journaling, verified media, rollback, crash recovery, semantic Git commits, newest-first history, and read-only historical retrieval. The defects are at browser lifecycle boundaries, not in the durable transaction.

**Alternatives considered**:

- Independent project worker: rejected for current scope because it is unimplemented and explicitly Future Scope.
- Browser-local canonical state: rejected because it would weaken the proven revision and Git transaction guarantees.
- New persistence framework: rejected because it duplicates established working behavior.

## Decision 2: Reuse and tighten the existing core project serializer

**Decision**: Extract a pure versioned project-file decoder beside `ProjectSerializer`, then make portable import/export and recovery use it.

**Rationale**: `ProjectSerializer` already defines a `1.0.0` envelope, validation results, normalization, missing-media placeholders, and tests. The current unsafe paths bypass it. A pure decoder gives every path one deterministic shape/version/identity gate without requiring an IndexedDB storage engine.

**Alternatives considered**:

- Add another schema library: rejected because no new dependency is needed for the existing fixed envelope and required top-level invariants.
- Keep per-call-site `JSON.parse` casts: rejected because those casts caused the demonstrated import and recovery defects.
- Reject all raw project JSON: rejected because raw `.oreel` files are the shipped legacy format and must migrate safely.

## Decision 3: Treat raw project JSON as the single supported legacy format

**Decision**: Accept either the current `{ version: "1.0.0", project }` envelope or a legacy raw project object. Migrate the raw object in memory, reject malformed versions and all future major/minor/patch versions, and never rewrite the source file during import.

**Rationale**: This provides an ordered, deterministic migration for the actual installed format while failing closed for unknown future data. File APIs already leave original bytes unchanged unless the user later saves explicitly.

**Alternatives considered**:

- Best-effort load of any version: rejected because it can partially install unsupported state.
- Full semver package: rejected because current files use one strict numeric version and prerelease/range semantics are unnecessary.
- Mutate the imported file during migration: rejected because it violates source preservation and makes failed migration destructive.

## Decision 4: Use confirmed persistence metadata as the authoritative dirty state

**Decision**: A project is clean only when the persistence status belongs to the same project, its phase is confirmed durable, and `persistedModifiedAt` equals the active project's `modifiedAt`.

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

## Decision 6: Make user recovery choices explicit and accessible

**Decision**: Use existing Radix-based dialogs and design tokens for Save / Discard / Cancel and conflict recovery. Disable actions while awaiting save/load, announce errors with `role="alert"`, keep Cancel/Escape available, and identify the affected project plus a corrective action.

**Rationale**: UI guidance requires visible async feedback, keyboard-safe escape routes, and errors that state what happened and what to do. Native two-state confirmation cannot represent the required three outcomes.

**Alternatives considered**:

- Silent automatic save: rejected because failure and conflict require a user decision.
- Chained `window.confirm` prompts: rejected because the choices and consequences are ambiguous.
- Semantic field-level difference resolver: rejected because it is explicitly Future Scope.

## Decision 7: Restore recovery copies as unsaved active state

**Decision**: Validate identity/version first, load the authoritative project only to establish its base revision, then install the recovered snapshot locally without an immediate backend save. Preserve the durable version and recovery media until a later explicit save succeeds.

**Rationale**: This directly satisfies FR-013 and avoids turning a recovery preview into an implicit canonical overwrite. The current immediate backend save is a genuine contract defect.

**Alternatives considered**:

- Treat clicking Restore as an immediate durable save: rejected because the approved specification explicitly requires an unsaved recovered state.
- Create a separate backend project automatically: rejected because it changes identity without user intent.

