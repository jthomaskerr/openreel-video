# Implementation Plan: DaVinci Resolve and iMovie Export

**Branch**: `feature/time-machine-media-library` | **Date**: 2026-07-22 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/006-resolve-imovie-export/spec.md`

## Summary

Extend OpenReel's existing browser-side exporter with two explicit editor handoffs:

1. A deterministic DaVinci Resolve package containing FCPXML 1.10, collected source media, and a compatibility report.
2. An iMovie-compatible flattened MOV that reuses the current MediaBunny render, audio mix, range, streaming, progress, and cancellation path.

The design adds pure compatibility and serialization modules under the existing core export package, plus a thin web coordinator and dedicated handoff dialog. It does not add a backend service, database state, ZIP package, or independent rendering pipeline. Resolve exports block on missing media or material features that cannot be represented; users can choose the flattened MOV path instead.

## Technical Context

**Language/Version**: TypeScript 5.x; repository supports Node.js 18+
**Primary Dependencies**: Existing `@openreel/core` export/video/audio engines, MediaBunny 1.25.3, new `@xmldom/xmldom` 0.9.x, React 18, File System Access API
**Storage**: Existing in-memory blobs, IndexedDB media records, retained file/directory handles, verified remote media URLs, and user-selected output files/directories; no new database
**Testing**: Vitest 1.6, Testing Library, Playwright 1.61, deterministic FCPXML/report fixtures, manual Resolve/iMovie compatibility matrix
**Target Platform**: OpenReel web editor; Chromium-class browser required for Resolve directory export, current supported browsers for single-file iMovie export
**Project Type**: pnpm web monorepo with reusable core package and React web application
**Performance Goals**: Compatibility assessment for 1,000 clips in under 5 seconds; frame-boundary error no greater than one destination frame; no cumulative audio drift across a 60-minute fixture
**Constraints**: Preserve current export behavior; never silently omit material edits or media; stream multi-gigabyte media without whole-package buffering; cancellation must not produce an import-ready success state; private native paths must not enter reports or diagnostics
**Scale/Scope**: One project timeline, up to 1,000 clips and multiple tracks, 60-minute validation fixture, multi-gigabyte media collection, two target profiles, one editable interchange version

## Constitution Check

*GATE: Must pass before Phase 0 research and after Phase 1 design.*

The repository constitution file is an unratified placeholder and contains no enforceable project-specific principles. The active repository instructions therefore provide the effective gates.

| Gate | Pre-Research | Post-Design Evidence |
|------|--------------|----------------------|
| Reuse existing architecture and avoid unnecessary greenfield services | PASS | Core extension plus thin web coordinator; no server, database, or new renderer |
| Deterministic behavior has local, non-flaky tests | PASS | Timebase, assessment, naming, XML, reports, state transitions, and UI contracts have explicit fixture tests |
| Probabilistic behavior includes evals | PASS | No LLM or probabilistic behavior is introduced; no eval is required |
| User-visible failures are explicit and actionable | PASS | Typed blocking/warning/info issues, staged failures, identifiers, retryability, and visible report |
| UI changes receive browser verification | PASS | Quickstart requires exact target/range/preflight/cancel/download browser scenarios |
| External compatibility has traceable evidence | PASS | Versioned compatibility matrix records artifact hashes, destination versions, timing comparisons, screenshots, and recordings |
| Existing exports remain regression protected | PASS | Existing export tests remain required and handoff code uses separate types and entry points |
| Dependencies are researched before adoption | PASS | `@xmldom/xmldom` selected after compatibility, maintenance, adoption, and fit comparison in [research.md](./research.md) |

**Gate result**: PASS before research and PASS after design. No justified violations.

## Project Structure

### Documentation (this feature)

```text
specs/006-resolve-imovie-export/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── handoff-service.md
│   ├── fcpxml-1.10.md
│   └── compatibility-report.schema.json
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
packages/core/
├── package.json                                  # add @xmldom/xmldom
└── src/export/
    ├── index.ts                                 # export handoff public contract
    ├── export-engine.ts                         # existing MOV render reused
    ├── export-range.ts                          # existing range resolver reused
    └── handoff/
        ├── index.ts
        ├── types.ts                             # typed target, plan, issue, result, progress
        ├── target-profiles.ts                   # Resolve/iMovie compatibility baseline
        ├── timebase.ts                          # seconds/frame/rational conversion
        ├── project-range.ts                     # selected-range projection and boundary trim
        ├── compatibility.ts                     # representability and media assessment
        ├── media-map.ts                         # deterministic names and relative references
        ├── fcpxml.ts                            # FCPXML 1.10 DOM serializer
        ├── report.ts                            # Markdown compatibility report
        ├── imovie-profile.ts                    # immutable MOV/H.264/AAC settings
        ├── *.test.ts
        └── __fixtures__/
            ├── projects.ts                      # source fixtures, no binaries
            └── expected/
                ├── basic-multitrack.fcpxml
                └── compatibility-report.md

apps/web/src/
├── components/editor/
│   ├── Toolbar.tsx                              # add explicit handoff entry points
│   ├── Toolbar.test.tsx
│   ├── HandoffExportDialog.tsx                  # target/range/preflight/progress UI
│   └── HandoffExportDialog.test.tsx
├── services/
│   ├── export-handoff.ts                        # operation coordinator/state machine
│   ├── export-handoff.test.ts
│   ├── media-storage.ts                         # existing blob/handle access reused
│   └── media-verification.ts                    # existing URL verification reused
└── test/
    └── export-handoff.integration.test.ts

apps/web/e2e/
└── export-handoff.spec.ts                       # browser behavior and download/folder mocks

docs/
└── export-compatibility.md                      # maintained target/version evidence matrix
```

**Structure decision**: Keep target-independent, deterministic logic in `@openreel/core`. Keep permission prompts, file handles, media recovery, streaming writes, notifications, analytics, and UI in `apps/web`. The existing `ExportEngine` remains the single flattened-render implementation.

## Design

### 1. Public Handoff Boundary

`@openreel/core` exposes pure functions and serializable types:

- `assessHandoff(project, selection, target)`
- `createHandoffPlan(project, assessment)`
- `serializeResolveFcpxml(plan)`
- `renderCompatibilityReport(plan, result)`
- `getImovieVideoSettings(project, selection)`

The web coordinator accepts a project snapshot, target, range, destination adapter, media resolver, existing export engine, progress callback, and `AbortSignal`. This keeps browser I/O injectable and permits deterministic failure tests.

### 2. Compatibility Assessment

Assessment runs before any destination prompt or artifact write:

1. Resolve and validate the selected range through the existing range resolver.
2. Determine included tracks/clips and boundary-trim each intersecting clip.
3. Exclude hidden video and muted audio using the same visibility rules used by render.
4. Inspect each material clip property against the versioned target matrix.
5. Resolve whether required media is present or recoverable without fetching/copying it yet.
6. Produce sorted issues with stable codes, severity, affected entity, message, action, and retryability.
7. Mark the assessment `blocked` when any blocking issue exists.

Issue order is deterministic: severity, track order, clip start, clip ID, then issue code.

### 3. Timebase and Range Projection

All editable timing converts to frame indices first:

- Canonical fractional rates: 23.976 → `24000/1001`, 29.97 → `30000/1001`, 59.94 → `60000/1001`.
- Positive integer frame rates use `fps/1`.
- Starts and ends round independently to nearest frame.
- Duration equals rounded end minus rounded start.
- A positive source segment that collapses to zero frames is blocking rather than silently dropped.
- Selected ranges rebase the exported sequence to frame zero while source trim positions remain tied to source time.
- FCPXML time values use reduced rational seconds.

### 4. Resolve Package

After a passing assessment:

1. Prompt for a destination directory.
2. Create a sanitized deterministic project subdirectory and `Media/`.
3. Resolve and stream each unique required media asset to its collision-safe output name.
4. Build an FCPXML plan referencing `Media/<name>` with percent-encoded relative URLs.
5. Serialize and parse-round-trip the FCPXML before writing it.
6. Write `<project>.fcpxml` and `compatibility-report.md`.
7. Close every writable and only then mark the handoff complete.

Media assets are sorted by stable media ID. A failure or cancellation leaves any already-written files as an explicitly incomplete folder and never reports it as import-ready. The error names the failing stage and safe retry behavior.

### 5. iMovie MOV Handoff

After a passing assessment:

1. Verify that the browser can encode a MOV container with H.264/AVC and AAC for the project dimensions.
2. Prompt for a `.mov` destination using the current save-picker/fallback behavior.
3. Call the existing video exporter with project dimensions, project frame rate, selected range, H.264 video, AAC audio at 48 kHz, and the maintained quality profile.
4. Map existing render progress into handoff phases.
5. Save the final movie and provide the compatibility report through the dialog's completed-details view and an adjacent Markdown download.

The existing exporter remains responsible for picture composition, audio mixing, range rendering, hardware policy, stream writes, diagnostics, and cancellation.

### 6. Unsupported Feature Policy

The first Resolve contract supports only edits that map deterministically without a new bake pipeline. Material unsupported features are blocking and offer the flattened MOV target. Informational metadata that does not affect picture, sound, or timing may be omitted only when named in the report.

No per-clip proxy/substitute render is introduced. This is the important scope boundary that keeps the feature aligned with the existing implementation.

### 7. Progress, Cancellation, and Diagnostics

The web coordinator owns one operation state machine:

```text
idle
  → assessing
  → blocked | awaiting-destination
  → resolving-media (Resolve only)
  → rendering (iMovie only)
  → packaging
  → saving
  → completed

Any active phase → cancelled | failed
```

Every asynchronous boundary checks the operation's `AbortSignal`. Structured, redacted diagnostic events cover assessment result, media resolution source/result, artifact write start/result, render phase mapping, cancellation, failure stage, completion, artifact names, and duration. Native paths, signed URLs, and media contents are excluded.

### 8. Compatibility Matrix

`docs/export-compatibility.md` records:

- target application and exact version;
- operating system;
- FCPXML or MOV contract version;
- fixture/project identity;
- artifact SHA-256;
- import success/failure;
- one-frame timing comparison;
- audio drift result;
- screenshot/recording evidence path;
- verifier and verification date.

The initial supported version is the exact current Resolve 20.x and iMovie 10.4.x build used for release verification. A target is not marked supported until all maintained fixtures pass.

## Testing Strategy

### Deterministic Core Gates

- Timebase canonicalization, rational reduction, rounding boundaries, long-duration drift, and invalid rates.
- Full/range projection, boundary trims, gaps, multiple tracks, hidden/muted state, and empty ranges.
- Representability matrix for every supported and blocking property.
- Missing media and recovery classification with stable issue ordering.
- Filename sanitization, Unicode, reserved names, and collision suffixes.
- FCPXML parsing, required resources, relative URLs, lanes, source ranges, and golden fixtures.
- Report content, redaction, determinism, and target baseline.
- Property-based checks for frame conversions and collision-free names.

### Web Integration Gates

- Resolve directory structure, unique media copy, streamed writes, permission denial, quota/write failure, cancellation, and retry.
- iMovie settings passed to the existing exporter, MOV extension, progress mapping, cancellation, and save fallback.
- Dialog target descriptions, editable/flattened distinction, range validation, issue list, blocked state, progress phases, completion, and visible errors.
- Existing `ExportDialog`, `Toolbar`, export engine, range, diagnostics, and export integration regressions.

### Browser Verification

Use the running editor to reproduce both target workflows. Verify the exact target/range selection, preflight issue behavior, cancellation, failure feedback, Resolve folder layout, and iMovie MOV download. Browser verification is required even when component tests pass.

### Destination Compatibility Gate

Import maintained artifacts into the exact supported Resolve and iMovie builds. Compare sequence structure, clip timing, trims, track order, dimensions, frame rate, duration, picture, audio sync, and drift. Store the compatibility matrix row and evidence before shipping.

## Delivery Order

1. Add the XML dependency and core contracts.
2. Implement/test timebase, range projection, media mapping, and compatibility assessment.
3. Implement/test FCPXML and report serialization.
4. Implement/test iMovie settings against the existing exporter.
5. Implement/test the web coordinator and destination adapters.
6. Implement/test the handoff dialog and toolbar integration.
7. Add browser verification and destination compatibility evidence.
8. Run existing export regression suites, typecheck, lint, browser workflow, and supported-app import matrix.

## Complexity Tracking

No constitution or repository-standard violations require justification. The only new runtime dependency is the researched XML DOM implementation needed by Node-based core tests and browser serialization.
