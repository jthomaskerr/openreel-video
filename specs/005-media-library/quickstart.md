# Quickstart: Validate Media Library and Import

## Prerequisites

- Node.js 18+ and pnpm 8+
- Dependencies installed
- A Chromium browser for File System Access coverage
- Small deterministic fixtures for supported image/audio/video/SRT and invalid input; boundary-size tests use mocked `File.size` and do not allocate GiB payloads

## Automated validation

Run focused tests first:

```bash
pnpm --filter @openreel/web exec vitest run \
  src/components/editor/AssetsPanel.test.tsx \
  src/components/editor/media-timeline-insertion.test.ts \
  src/services/media-storage.test.ts \
  src/services/media-verification.test.ts \
  src/stores/replace-media-asset.test.ts
```

Then run the web typecheck:

```bash
pnpm --dir apps/web exec tsc --noEmit
```

Expected outcomes:

- one byte below and exactly at the configured cap are accepted; one byte above is rejected before decode;
- known insufficient capacity and runtime limits return their specific reason;
- mixed batches continue and produce one ordered result per file;
- failed local persistence is degraded/retryable, not reported as durable;
- handle capture failure is visible and non-blocking;
- zero and non-zero insertion times survive asynchronous track creation;
- referenced deletion is blocked and unreferenced deletion remains undoable;
- verification classification and stale-result tests remain green.

## Browser validation

Start the application:

```bash
pnpm dev
```

Open `http://localhost:5173`, load or create a project, and verify:

1. Import a mixed batch. Confirm filename/index/stage is announced promptly and the final result lists every file.
2. Simulate or trigger an invalid file and confirm later valid files still import.
3. Reload and confirm durable assets retain IDs, metadata, previews, and availability.
4. Drag a file where handle persistence is unavailable/fails. Confirm import continues with a recovery warning.
5. Search, group, change density, select, and inspect assets using keyboard only.
6. Insert at time zero and at a non-zero scrub position with compatible, locked, and absent tracks.
7. Try deleting an asset used by a timeline clip. Confirm the dependency count is shown and nothing is deleted.
8. Delete an unused asset. Confirm the library record is removed through project history and cleanup failure, if injected, is visible.
9. Relink a missing source and verify its stable ID and timeline reference remain unchanged.

Record browser evidence for the exact changed behaviors, not only page load. No restart beyond the normal dev-server reload is required for frontend-only changes.

## Verification evidence (2026-07-22)

- Baseline focused suites: 5 files, 50 tests passed before implementation.
- New deterministic red-green coverage: import policy (8), batch outcomes (4), media dependencies (2), diagnostics (1), metadata normalization (1), relink ambiguity (2), SRT importability (2), and timeline insertion (7 total, 3 new failure cases).
- Focused feature matrix: 13 files, 75 tests passed.
- Affected web matrix: 20 files, 189 tests passed and 4 existing skips; direct project-store rerun after deletion regressions: 74 passed and 4 existing skips.
- Typecheck: media-library changes are clean. The repository command remains non-zero because `src/features/generation/context/scene-generation.test.ts:676` has a pre-existing unrelated `GenerationTiming.source` mismatch (`"shot"` is not accepted by the local expected type).
- Browser gate: deferred by explicit user direction on 2026-07-22 after a fresh retry again returned zero available browser backends. The nine scenarios above remain required for later manual sign-off; this deferral is an accepted verification gap, not evidence that the browser behavior passed.
- Focused rerun after correcting the stale quickstart target: 5 files, 49 tests passed in one-shot mode. The removed core target never existed; preflight ordering is owned by `project-store.importMedia` and `media-import-batch`, with the batch regression proving rejected files never reach the importer and later files continue.
- Known non-blocking test noise: existing Zustand deprecation, React `act(...)`, localStorage experimental, stale baseline-browser-mapping, and pnpm settings warnings.

Configuration: set `VITE_MAX_MEDIA_IMPORT_BYTES` to a positive integer byte count to override the 2 GiB source-file limit, then restart the web dev server. Invalid, zero, or negative values use the 2 GiB default.
