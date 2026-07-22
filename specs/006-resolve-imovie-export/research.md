# Phase 0 Research: DaVinci Resolve and iMovie Export

**Feature**: `006-resolve-imovie-export`
**Date**: 2026-07-22
**Status**: Complete; no unresolved clarifications

## Decision 1: Extend the Existing Export Path

**Decision**: Keep the feature inside the existing browser-side export architecture. Add deterministic handoff planning and serialization under `packages/core/src/export/handoff/`, then orchestrate media access and local writes from `apps/web/src/services/export-handoff.ts`. Reuse `ExportEngine.exportVideo()`, `resolveExportRange()`, the current toolbar export state, notification reporting, and File System Access helpers.

**Rationale**: The current implementation already renders MP4, WebM, and MOV with range selection, mixed audio, progress, streaming writes, cancellation, and diagnostics. The missing capability is editor-specific assessment, FCPXML serialization, media collection, and target-aware UI. A new server or second rendering engine would duplicate proven behavior and create inconsistent failure handling.

**Alternatives considered**:

- A new orchestrator/backend export service: rejected because all required project media and rendering state are already local to the editor, and uploading multi-gigabyte source media would expand scope materially.
- A standalone export application: rejected because it would duplicate project loading, media permissions, and render behavior.
- Adding all behavior directly to `Toolbar.tsx`: rejected because compatibility analysis and packaging need deterministic unit tests and would make the existing large component harder to maintain.

## Decision 2: Separate Pure Handoff Logic from Browser I/O

**Decision**: Core owns target profiles, timebase conversion, range projection, compatibility assessment, deterministic media mapping, FCPXML generation, report generation, and iMovie settings. Web owns user prompts, directory/file handles, blob recovery, streaming copies, progress presentation, cancellation wiring, downloads, and analytics.

**Rationale**: Core tests run in a Node environment and are fast and deterministic. Browser file handles, permission prompts, and download behavior belong at the application boundary. A typed `HandoffPlan` lets the web layer execute a reviewed plan without reaching into core internals.

**Alternatives considered**:

- Put File System Access objects into core contracts: rejected because it would make deterministic logic depend on browser-only types and complicate Node tests.
- Put FCPXML generation in the web app: rejected because it would weaken reuse and make timing/media mapping harder to test independently.

## Decision 3: Use FCPXML 1.10 as the Resolve Contract

**Decision**: Emit FCPXML 1.10 with a project event containing one sequence. Use a versioned mapping contract, relative media URLs under `Media/`, and a compatibility report beside the XML. Treat successful import into the Resolve versions recorded in the compatibility matrix as the authoritative release gate.

**Rationale**: FCPXML is the requested editable interchange path and DaVinci Resolve imports it. Version 1.10 covers the required rough-cut structures without relying on newer Final Cut-specific features. Relative media references allow a browser-selected export folder to remain portable because browsers do not reveal an absolute native path. Documentation alone does not prove Resolve behavior, so checked-in deterministic fixtures plus manual import evidence are both required.

**Alternatives considered**:

- EDL: rejected because it cannot faithfully carry multiple video/audio tracks, source trims, still images, or the required media mapping.
- OTIO: rejected because Resolve/iMovie users would need an extra conversion step, violating the import-without-conversion outcome.
- AAF: rejected because browser-side generation is substantially more complex and offers no iMovie benefit.
- Newer FCPXML versions: deferred until the compatibility matrix proves a user-visible need. The version is isolated in the target profile for later migration.

## Decision 4: Use Rational Frame Times and End-Derived Durations

**Decision**: Convert the project frame rate into a rational timebase. Recognize `24000/1001`, `30000/1001`, and `60000/1001` for the common 23.976, 29.97, and 59.94 rates; use `fps/1` for positive integer rates. Round starts and ends independently to the nearest frame, then calculate duration as `roundedEnd - roundedStart`. Represent FCPXML times as reduced rational seconds.

**Rationale**: Frame-index arithmetic prevents cumulative floating-point drift and makes selected-range clipping deterministic. Deriving duration from the two rounded boundaries keeps adjacent clips aligned and limits each represented boundary to the one-frame tolerance.

**Alternatives considered**:

- Decimal seconds: rejected because long timelines accumulate drift and FCPXML is designed for rational time values.
- Round each duration independently: rejected because adjacent boundaries can diverge and create gaps or overlaps.
- Always use a fixed high timescale: rejected because it obscures the project timebase and complicates fixture inspection.

## Decision 5: Block Unsupported Editable Features Instead of Silently Dropping Them

**Decision**: The initial Resolve representability matrix supports basic video, audio, and still-image clips; track order; gaps; trims; normal-speed playback; enabled-state filtering; and source/media mapping. Material transforms, effects, keyframes, non-unit speed, reverse, stabilization, blend modes, transitions, titles/graphics, generated compound behavior, and other unsupported semantics produce blocking issues. The UI directs the user to the flattened iMovie/MOV handoff. No per-clip baking service is added in this feature.

**Rationale**: OpenReel can already render the complete visual result, but it does not have an independent, reusable per-clip bake pipeline. Adding one would be a separate rendering feature. Blocking is honest, deterministic, and satisfies the requirement that unsupported material edits are never omitted.

**Alternatives considered**:

- Ignore unsupported values: rejected because it would create misleading imports.
- Approximate effects in FCPXML: rejected because destination behavior would be difficult to verify and could change the picture.
- Bake every unsupported clip: deferred because it requires new subrange rendering, alpha/audio handling, caching, and replacement-media lifecycle.

## Decision 6: Stream a Resolve Folder; Do Not Add ZIP Packaging

**Decision**: Resolve export requires `showDirectoryPicker()`. Create a deterministic folder containing `<project>.fcpxml`, `compatibility-report.md`, and a `Media/` subdirectory. Copy each required asset as a stream, preserve one copy per media ID, and suffix collision-prone names with a stable media-ID fragment. If directory access is unavailable or denied, block with an actionable message.

**Rationale**: Collected media can be many gigabytes. Streaming to a chosen directory avoids holding the package in memory and lets FCPXML use stable relative references. A ZIP fallback would add a dependency, still require large streaming support, and force Resolve users to extract before import.

**Alternatives considered**:

- ZIP download: rejected for initial scope because it adds memory/streaming complexity and an extra extraction step.
- FCPXML-only download with original paths: rejected because browser privacy prevents reliable absolute paths and cross-machine handoff would break.
- Duplicate media for each clip: rejected because it wastes storage and complicates relinking.

## Decision 7: Reuse MediaBunny for the iMovie MOV Profile

**Decision**: Define an immutable iMovie target profile that calls the existing `ExportEngine.exportVideo()` with `MovOutputFormat`, H.264/AVC video, AAC audio at 48 kHz, project dimensions/frame rate, and the selected range. Run MediaBunny container-aware video/audio codec support checks before rendering and surface an actionable blocker if the browser cannot encode the profile.

**Rationale**: MediaBunny 1.25.3 is already installed and the current exporter already selects `MovOutputFormat`, streams through `StreamTarget`, chooses an encodable container codec, and finalizes the output. Reuse preserves the existing renderer, audio mixer, range semantics, progress, and cancellation.

**Alternatives considered**:

- ProRes MOV: rejected as the default because browser encode support is less widely available and output size is much larger. It can be considered later as an optional Resolve master.
- MP4: rejected for the named iMovie handoff because the specification requires MOV, though the current generic MP4 export remains available.
- FFmpeg-only transcoding: rejected because it duplicates the current accelerated MediaBunny path and increases resource use.

## Decision 8: Use `@xmldom/xmldom` for XML Construction and Serialization

**Decision**: Add `@xmldom/xmldom` to `@openreel/core` and build the FCPXML document with `DOMImplementation` and `XMLSerializer`. Keep the mapping in explicit helper functions and validate serialized output with parser round trips and golden fixtures.

**Rationale**: Core tests use a Node environment, so browser DOM globals are unavailable. `@xmldom/xmldom` 0.9.10 supports standards-based DOM construction/serialization, has TypeScript support, is actively maintained (repository activity on 2026-07-21), and recorded about 153 million npm downloads in the prior month. The serializer owns attribute/text escaping and avoids a custom XML utility.

**Alternatives considered**:

- `xmlbuilder2`: strong fluent API and about 84 million monthly downloads, but current 4.x requires Node 20 while the repository contract remains Node 18+.
- `fast-xml-parser`: highest adoption (about 329 million monthly downloads) and active maintenance, but its builder's ordered object representation is less direct for interleaved FCPXML nodes and current documentation marks the `XMLBuilder` class deprecated.
- Hand-written XML strings: rejected because correct escaping, document structure, and future schema growth should not rely on custom string concatenation.

## Decision 9: Use the Existing Media Recovery Order

**Decision**: Resolve each required media item through the current available object in this order: live `MediaItem.blob`, persisted media blob, retained file handle with permission, then an already verified remote/original URL fetched through the existing media verification path. Record the resolution source in diagnostics but not in the user-facing report. Missing required media blocks before any import-ready status.

**Rationale**: This matches the editor's persistence and media-library direction and avoids creating another cache. It also supports page reload and imported project cases while keeping private native paths out of reports.

**Alternatives considered**:

- Fetch URLs first: rejected because it ignores local authoritative media and can introduce network failures.
- Continue with placeholders: rejected because the resulting Resolve sequence would be incomplete.

## Decision 10: Model Handoff as a Cancel-Safe State Machine

**Decision**: Use one `AbortController` per operation and the phases `assessing → awaiting-destination → resolving-media → rendering → packaging → saving → completed`, with terminal `blocked`, `cancelled`, and `failed` states. Resolve skips `rendering`; iMovie skips media collection and XML packaging. Do not present artifacts as ready until every required write closes successfully.

**Rationale**: Explicit phases satisfy progress and failure requirements and allow deterministic failure injection. Abort checks between media copies and before each artifact commit prevent a cancelled partial folder from being mistaken for a valid handoff.

**Alternatives considered**:

- Reuse the existing five render phases for the entire workflow: rejected because they cannot identify assessment, media resolution, package, or save failures.
- Fire-and-forget copies: rejected because cancellation and completion would be unverifiable.

## Decision 11: Keep a Two-Layer Compatibility Test Matrix

**Decision**: Gate deterministic behavior with unit/component/browser tests, then gate destination compatibility with a documented manual matrix. Automated tests cover frame math, range projection, issue classification, name collisions, XML structure, report output, cancellation, write failures, existing export regressions, and browser UI behavior. Release evidence records the exact Resolve and iMovie versions, fixture, artifact hash, import result, timing comparison, and screenshot/recording.

**Rationale**: Local tests prove OpenReel's contract, but only the destination applications can prove import compatibility. Separating the two keeps gate tests fast and deterministic while making external evidence explicit.

**Alternatives considered**:

- Snapshot-only testing: rejected because valid-looking XML can still import incorrectly.
- Destination-app testing only: rejected because it is slow, manual, and poor at isolating deterministic regressions.
- Paid or probabilistic evals: not applicable; no LLM-dependent behavior is introduced.

## Decision 12: Advertise Only Exact Builds with Passing Evidence

**Decision**: Keep the advertised compatibility set empty for each target until the release matrix contains at least one passing row with the exact application build, operating system, fixture identity, artifact SHA-256, result, comparisons, evidence, verifier, and date. Resolve 20.3.2 build 20.3.20009 is the locally installed candidate. Do not infer iMovie support from a version family; record the exact installed candidate only when destination verification runs.

**Rationale**: Family labels such as Resolve 20.x and iMovie 10.4.x overclaim compatibility and cannot be reproduced. Implementation does not require inventing an iMovie build, while release remains blocked until both targets have passing exact-build evidence.

**Alternatives considered**:

- Advertise version families before verification: rejected because a passing build does not establish every patch release.
- Hard-code an uninstalled iMovie version: rejected because it would create an unsupported compatibility claim.

## Decision 13: Make Interaction and Performance Gates Reproducible

**Decision**: Count the valid start path from visible export controls as three primary activations: open the handoff dialog, select the target, and activate Start after automatic assessment. Benchmark the deterministic 1,000-clip fixture across five warm-process runs on Apple M4, 16 GiB RAM, macOS, and Node.js 26.5.0; require a median under five seconds and no run above six seconds.

**Rationale**: Explicit start and end states make the UX outcome testable, while a recorded runtime and hardware baseline makes performance results comparable instead of machine-dependent assertions.

**Alternatives considered**:

- Count scrolling and focus movement: rejected because they do not submit or change workflow state.
- Use one unrecorded timing run: rejected because warm-up and machine variance would make the gate non-reproducible.

## Resolved Technical Context

- **Language**: TypeScript 5.x in the existing pnpm monorepo.
- **Core dependencies**: MediaBunny 1.25.3, `@xmldom/xmldom`, existing export/video/audio engines.
- **Web dependencies**: React 18, File System Access API, existing storage, notification, analytics, and UI packages.
- **Tests**: Vitest 1.6, Testing Library, Playwright 1.61, deterministic fixtures, repeated-export equivalence, a recorded performance harness, and an exact-build Resolve/iMovie import matrix.
- **Persistence**: No new database state. Output artifacts live in the user-selected file system; compatibility baseline is maintained in repository documentation.
- **Scale**: 1,000 clips, 60-minute timelines, and multi-gigabyte collected media without loading the full package into memory.
