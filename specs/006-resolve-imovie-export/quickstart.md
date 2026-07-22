# Quickstart Validation Guide: DaVinci Resolve and iMovie Export

This guide proves the implementation against the feature specification, contracts, and destination applications. It is a validation guide, not an implementation recipe.

## Prerequisites

- Node.js 18 or later and pnpm installed.
- Repository dependencies installed with `pnpm install`.
- A Chromium-class browser for Resolve directory export.
- A supported DaVinci Resolve 20.x build.
- A supported iMovie 10.4.x build on macOS.
- A representative OpenReel project with:
  - at least two video tracks and two audio tracks;
  - gaps and repeated uses of one media source;
  - trimmed video and audio clips;
  - one hidden video track and one muted audio track;
  - horizontal, vertical, and square variants;
  - a valid selected range that cuts through clip boundaries.
- A second project with missing media and unsupported edits such as a transition, transformed clip, and non-unit speed.

Read these contracts first:

- [Data model](./data-model.md)
- [Handoff service boundary](./contracts/handoff-service.md)
- [FCPXML mapping](./contracts/fcpxml-1.10.md)
- [Compatibility report schema](./contracts/compatibility-report.schema.json)

## 1. Install and Static Validation

```bash
pnpm install
pnpm --filter @openreel/core typecheck
pnpm --filter @openreel/web typecheck
pnpm --filter @openreel/web lint
```

Expected:

- All commands exit successfully.
- `@xmldom/xmldom` resolves from `@openreel/core`.
- No existing export type or toolbar regression is introduced.

## 2. Fast Deterministic Core Gates

```bash
pnpm --filter @openreel/core test:run -- src/export/handoff
pnpm --filter @openreel/core test:run -- src/export/export-range.test.ts src/export/export-engine.test.ts src/export/export-diagnostics.test.ts
```

Expected:

- Timebase tests cover integer and 23.976/29.97/59.94 rates, boundary ties, rational reduction, invalid rates, and 60-minute drift.
- Range projection tests cover complete/ranged exports, boundary trims, gaps, hidden/muted tracks, empty intersections, and source offsets.
- Compatibility tests cover every supported and blocking feature code plus stable issue ordering.
- Media naming tests prove case-insensitive collision safety and path traversal rejection.
- FCPXML parses successfully, all references resolve, all durations are positive, relative media URLs stay under `Media/`, and golden fixtures match.
- Existing range, engine, and diagnostic tests remain green.

## 3. Web Coordinator and UI Gates

```bash
pnpm --filter @openreel/web test:run -- src/services/export-handoff.test.ts src/components/editor/HandoffExportDialog.test.tsx src/components/editor/Toolbar.test.tsx
pnpm --filter @openreel/web test:run -- src/test/export-handoff.integration.test.ts src/test/export-integration.test.ts
```

Expected:

- Resolve assessment runs before the directory prompt.
- Missing media and unsupported material edits block writes and remain visible.
- Resolve writes one copy per media ID, then FCPXML and report, and completes only after every writable closes.
- Permission denial, write failure, cancellation, stale assessment, and retry paths name the stage and never show import-ready success.
- iMovie passes the immutable MOV/H.264/AAC profile and selected range to the existing exporter.
- The dialog clearly labels Resolve as editable and iMovie as flattened.
- General MP4, WebM, MOV, WAV, image, and project exports remain unchanged.

## 4. Browser Gate

Start the editor:

```bash
pnpm dev
```

Open `http://localhost:5173` in the browser tool and validate the exact scenarios below.

### Scenario A: Ready Resolve Handoff

1. Open the representative project.
2. Choose **Export → DaVinci Resolve**.
3. Select the complete timeline.
4. Review the compatibility assessment.
5. Start export and select an empty destination directory.

Expected:

- The dialog says the result remains editable.
- The ready assessment has no blocking issues.
- Progress visibly moves through assessment, destination, media resolution, packaging, and saving.
- The selected directory contains:

```text
<project>/
├── <project>.fcpxml
├── compatibility-report.md
└── Media/
    └── one file per required media ID
```

- Hidden video and muted audio sources are absent unless also used by included content elsewhere.
- No native path, signed URL, or credential appears in the report or browser logs.

Capture:

- screenshot of ready assessment;
- screenshot of completed folder layout;
- structured diagnostic event sample with sensitive values redacted.

### Scenario B: Selected Resolve Range

1. Choose a range that starts and ends inside clips.
2. Export the Resolve handoff.
3. Inspect the FCPXML and report.

Expected:

- Exported sequence starts at frame zero.
- Only intersecting content is present.
- Boundary clips are trimmed.
- Relative spacing inside the range is preserved.
- Duration equals the selected range after frame alignment.

### Scenario C: Blocked Resolve Handoff

1. Open the project with missing media and unsupported material edits.
2. Choose the Resolve target.

Expected:

- Every missing/unsupported item is listed with track, clip, or media identity.
- No destination prompt or artifact write occurs.
- The UI directs the user to relink/change the edit or choose the flattened MOV handoff.
- Nothing is silently omitted.

### Scenario D: iMovie Handoff

1. Open each horizontal, vertical, and square fixture.
2. Choose **Export → iMovie**.
3. Confirm the flattened explanation and export the complete timeline.

Expected:

- Output uses a `.mov` filename and `video/quicktime`.
- Existing renderer progress and cancellation integrate with handoff phases.
- Picture, mixed audible audio, dimensions, orientation, frame rate, and duration match OpenReel.
- The compatibility report is available after completion.

### Scenario E: Cancellation and Failure

1. Cancel once during Resolve media copying.
2. Cancel once during iMovie rendering.
3. Inject a media read failure and a destination write failure.

Expected:

- The exact stage is visible.
- Partial output is never presented as import-ready.
- Retryability is correct.
- Retrying does not duplicate media references or create conflicting output names.

## 5. Browser Automation

```bash
pnpm --filter @openreel/web test:e2e -- export-handoff.spec.ts
```

Expected:

- Playwright covers target selection, range selection, blocking assessment, directory/save adapter mocks, cancellation, completion, and visible failure feedback.
- The test verifies behavior, not only page load.

## 6. DaVinci Resolve Compatibility Gate

For every version to be marked supported:

1. SHA-256 hash the Resolve package artifacts.
2. Import `<project>.fcpxml` into a clean Resolve project.
3. Verify media relinks automatically from the collected `Media/` folder.
4. Compare project resolution, frame rate, track order, clip order, gaps, timeline boundaries, source trims, repeated source references, hidden/muted exclusion, and synchronized audio.
5. Repeat with the selected-range fixture.
6. Compare every boundary to OpenReel in frames.
7. Play the 60-minute fixture and measure audio drift.

Pass threshold:

- Every maintained fixture imports without manual structural repair.
- Every supported boundary differs by no more than one destination frame.
- No cumulative audio drift is observed across the 60-minute fixture.
- No media is missing or mapped to the wrong source.

Record the exact app version, OS, artifact hashes, result, timing comparison, screenshot/recording paths, verifier, and date in `docs/export-compatibility.md`.

## 7. iMovie Compatibility Gate

For every version to be marked supported:

1. Hash each horizontal, vertical, and square MOV artifact.
2. Import each file into a clean iMovie project without conversion.
3. Verify dimensions, orientation, frame rate, duration within one frame, visible picture, audible mixed audio, and synchronization.
4. Scrub and play the start, middle, and end of each file.

Pass threshold:

- Every fixture imports without conversion.
- Dimensions and orientation match OpenReel.
- Duration differs by no more than one frame.
- Picture and mixed audio are present and synchronized.

Record the same evidence fields in `docs/export-compatibility.md`.

## 8. Full Regression Gate

```bash
pnpm test
pnpm typecheck
pnpm lint
```

Expected:

- All workspace tests, typechecks, and lint checks pass.
- No existing export format or project workflow changes behavior.

## 9. Release Evidence Checklist

- [ ] Core deterministic tests pass.
- [ ] Web integration/component tests pass.
- [ ] Browser automation passes.
- [ ] Exact browser scenarios reproduced and captured.
- [ ] Resolve compatibility matrix passes for every advertised version.
- [ ] iMovie compatibility matrix passes for every advertised version.
- [ ] Artifact hashes and sanitized diagnostic samples recorded.
- [ ] Existing export regression suites pass.
- [ ] No unresolved blocking compatibility issue is advertised as supported.
