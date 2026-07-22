# Implementation Plan: Media Library and Import

**Branch**: `feature/time-machine-media-library` | **Date**: 2026-07-22 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/005-media-library/spec.md`

## Summary

Harden the existing browser media-library pipeline so every import has a typed, visible outcome; file-size and storage capability are checked before expensive decode work; local persistence and recovery-handle degradation remain retryable; timeline insertion and deletion fail safely; and existing search, grouping, verification, relink, replace, and metadata behavior remains intact. The implementation extends the current `@openreel/core` media import service, Zustand project actions, IndexedDB media storage, and React library UI rather than introducing a parallel asset subsystem.

## Technical Context

**Language/Version**: TypeScript 5.4+, Node.js 18+  
**Primary Dependencies**: React 18, Zustand 4, `@openreel/core`, `@openreel/ui`, MediaBunny/FFmpeg media bridge, browser File System Access and StorageManager APIs  
**Storage**: Project JSON plus browser IndexedDB media/blob and file-handle stores; optional orchestrator media upload  
**Testing**: Vitest 1.6, Testing Library 16, jsdom 24, Playwright 1.61  
**Target Platform**: Modern desktop browsers; capability-specific fallback for browsers without File System Access or storage-estimate support  
**Project Type**: pnpm monorepo web application with reusable core media package  
**Performance Goals**: Operation status visible within 300 ms; ordinary browsing adds no more than 10 ms p95 interaction delay; verification retains bounded concurrency and retries  
**Constraints**: Configurable 2 GiB default import cap; preflight without reading the complete file; stable media IDs and timeline references; no silent user-visible failures; offline-capable local durability  
**Scale/Scope**: Mixed multi-file batches and project libraries large enough to require search/grouping; one active project per editor session; changes scoped to media import/library/insertion and their direct tests

## Constitution Check

*GATE: Passed before Phase 0 and re-checked after Phase 1 design.*

The repository constitution is an unratified placeholder and defines no enforceable project-specific gates. The design therefore applies the repository operating standard:

- **User-visible outcome named**: deterministic import/recovery results and safe insertion/deletion.
- **Test first**: add local deterministic regression tests for each missing guarantee before implementation.
- **No probabilistic behavior**: no LLM or paid eval is involved, so no probabilistic eval is required.
- **Traceability**: typed outcomes, structured diagnostics, unit/component tests, and browser scenarios provide evidence.
- **Architecture fit**: policy and result logic stays in independently testable services/types; React only orchestrates and presents state.
- **Failure handling**: cancellations remain non-errors, while decode, persistence, upload, recovery-handle, relink, insertion, and cleanup failures are surfaced with identifiers and recovery guidance.

Post-design re-check: PASS. The data model and contracts add no new service boundary, database, hosted API, or constitutional exception.

## Project Structure

### Documentation (this feature)

```text
specs/005-media-library/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── media-library-contracts.md
└── tasks.md
```

### Source Code (repository root)

```text
apps/web/src/
├── components/editor/
│   ├── AssetsPanel.tsx
│   ├── AssetsPanel.test.tsx
│   ├── AssetBuckets.tsx
│   ├── AssetBuckets.test.tsx
│   ├── asset-manager/AssetDetailShared.tsx
│   ├── media-timeline-insertion.ts
│   └── media-timeline-insertion.test.ts
├── services/
│   ├── media-storage.ts
│   ├── media-storage.test.ts
│   ├── media-verification.ts
│   └── media-verification.test.ts
└── stores/
    ├── project-store.ts
    ├── media-import.test.ts
    └── replace-media-asset.test.ts

packages/core/src/media/
├── media-import-service.ts
├── media-import-service.test.ts
├── types.ts
└── index.ts
```

**Structure Decision**: Keep decoding/format policy in `packages/core/src/media`; keep browser durability and capability checks in `apps/web/src/services`; keep project mutation and dependency validation in the project store; and keep progress/result presentation in `AssetsPanel`. Tests sit beside the behavior they prove. New filenames shown above are created only when no focused test module already owns the behavior.

## Implementation Design

### 1. Import preflight and typed outcomes

- Add a pure preflight policy that compares `File.size` with a configurable cap (default `2 * 1024 ** 3`) and an optional browser-capacity estimate.
- Treat unsupported storage estimation as a capability warning, not a false capacity claim; reject only when the configured cap, a known lower runtime bound, or known available capacity is exceeded.
- Run preflight before metadata extraction, thumbnailing, or blob persistence.
- Return one discriminated per-file result covering durable success, degraded success, rejected, and failed outcomes with stage, stable media ID, warnings, and recovery action.
- Aggregate the entire batch in `AssetsPanel`; one file failure never aborts later files.

### 2. Durability and recovery evidence

- Do not report an import as fully durable until `saveMediaBlob` succeeds.
- Preserve an imported project record when decoding succeeded but persistence failed, mark the result as retryable/degraded, and expose the recovery action rather than silently logging.
- Observe the optional backend upload result through the existing service contract where available and retain visible retryable upload state without blocking local success.
- Capture dropped-file/directory handles independently. A failure becomes a contextual warning and notification; picker cancellation remains quiet.

### 3. Safe model mutations

- Centralize media-reference discovery across timeline clips and existing protected workflow references.
- Make the project-store delete operation return a typed blocked/success/cleanup-failed result. Block deletion before project mutation when dependencies exist.
- Preserve undo/redo semantics for the project-model removal. Perform binary cleanup only after model success and surface cleanup failure without claiming the model deletion failed.
- Keep replace/relink updates keyed by media ID so user metadata and references survive.

### 4. Timeline insertion and UI feedback

- Change insertion from silent `void` exits to a typed result/error with media ID, intended time, target track ID when known, and a user-action hint.
- Capture the insertion time before asynchronous track creation; retain zero as a valid time.
- Mutate active-track/selection state only after clip creation succeeds.
- Present import summaries, degraded warnings, deletion blocks, cleanup failures, and insertion errors through the notification store and accessible live regions.

### 5. Verification and regression protection

- Retain the current verification coordinator, one-byte range fallback, stale-result guards, missing-only derivation, and relink identity rules.
- Add focused regressions only where orchestration currently drops failures or ambiguity.
- Run targeted Vitest suites, web typecheck, then browser verification for picker/drop status, failure recovery, zero-time insertion, and referenced deletion.

