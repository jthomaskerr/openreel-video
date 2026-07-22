# Feature Specification: DaVinci Resolve and iMovie Export

**Feature Directory**: `006-resolve-imovie-export`  
**Created**: 2026-07-22  
**Status**: Draft  
**Input**: User description: "Export to one or more formats that DaVinci Resolve and iMovie can import"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Continue Editing in DaVinci Resolve (Priority: P1)

An editor finishes a rough cut in OpenReel and exports an editable handoff for DaVinci Resolve. After importing it into Resolve, the editor sees the sequence, source media references, track order, clip timing, trims, and synchronized audio in the expected positions.

**Why this priority**: An editable timeline handoff provides the largest workflow improvement because it avoids rebuilding the cut in another editor.

**Independent Test**: Create a representative project with multiple video and audio tracks, trimmed clips, gaps, and muted content; export the Resolve handoff; import it into a supported Resolve version; verify the sequence against the OpenReel timeline to within one frame.

**Acceptance Scenarios**:

1. **Given** a project whose media is available and whose edits are supported by the handoff format, **When** the user selects the DaVinci Resolve target and exports the complete timeline, **Then** the resulting handoff imports as an editable sequence with the same resolution, frame rate, track order, clip order, clip timing, source trims, and audio synchronization.
2. **Given** a valid selected timeline range, **When** the user exports that range for Resolve, **Then** only content intersecting the range is included, boundary clips are trimmed correctly, and relative timing within the exported sequence is preserved.
3. **Given** multiple uses of the same source asset, **When** the handoff is created, **Then** every clip references the correct source asset and source range without unnecessary duplicate media.

---

### User Story 2 - Continue Editing in iMovie (Priority: P2)

An editor exports a high-quality, self-contained movie that iMovie can import without conversion. The editor can place that movie in an iMovie project with the intended picture, mixed audio, dimensions, orientation, frame rate, and duration.

**Why this priority**: iMovie accepts rendered media handoffs but does not provide a dependable general-purpose editable timeline interchange path. A clearly labeled flattened handoff gives users a reliable workflow without implying that individual OpenReel edits remain editable.

**Independent Test**: Export horizontal, vertical, and square sample projects with picture and mixed audio; import each file into a supported iMovie version; verify successful import, playback, dimensions, duration, orientation, frame rate, and audible synchronized audio.

**Acceptance Scenarios**:

1. **Given** a valid project, **When** the user selects the iMovie target, **Then** OpenReel identifies the output as a flattened movie and creates a self-contained file that imports into iMovie without an intermediate conversion.
2. **Given** a project with multiple visible video layers and audible audio tracks, **When** the iMovie handoff completes, **Then** the imported movie matches OpenReel's rendered picture and mixed audio for the exported range.
3. **Given** a vertical or square project, **When** the user exports for iMovie, **Then** the file retains the project's dimensions and orientation rather than forcing a horizontal canvas.

---

### User Story 3 - Resolve Compatibility Problems Before Export (Priority: P3)

An editor reviews a compatibility assessment before creating a handoff. Missing media, unsupported editable features, and content that will be flattened are described with affected track or clip identifiers and a clear corrective action.

**Why this priority**: A successful file download is not useful if the target editor cannot relink media or if edits disappear silently.

**Independent Test**: Prepare projects with missing media, unavailable local files, unsupported effects, invalid timing, and mixed supported/unsupported edits; verify that the assessment lists every material issue, blocks unsafe exports, and offers only outcomes that preserve the visible result.

**Acceptance Scenarios**:

1. **Given** a clip whose required source media cannot be accessed, **When** the user assesses or starts an editable handoff, **Then** export is blocked and the user sees the asset and clip identifiers plus relink guidance.
2. **Given** an edit that cannot be represented in the editable handoff, **When** compatibility is assessed, **Then** the user is told whether it will be rendered into a substitute or requires a flattened export, and the edit is never silently omitted.
3. **Given** an export failure, **When** the operation stops, **Then** the user sees which target and stage failed, any affected artifact or media identifier, and whether retrying is safe.

### Edge Cases

- The timeline is empty, has zero duration, or the selected range contains no visible or audible content.
- A selected range beginning or ending inside a supported clip is boundary-trimmed; intersection with an unsupported transition, speed change, title, or audio fade blocks editable Resolve export and directs the user to the flattened MOV handoff.
- Source frame rates differing from the project rate are projected through the deterministic destination timebase; any represented boundary remains within one destination frame.
- Reversed, frozen, retimed, nested, generated, compound, transitioned, titled, or OpenReel-effect content blocks editable Resolve export in this release and remains available through the flattened MOV handoff.
- Hidden video and muted audio are excluded. Lock state does not change export inclusion. Empty tracks contribute no artifacts, while supported overlaps preserve track and timing order.
- Offline media, expired permissions, and unavailable verified URLs block before destination selection. Equal filenames receive deterministic collision-safe names without merging distinct media IDs.
- Invalid source or project-name characters are sanitized deterministically and reported; generated references remain contained inside the selected destination.
- Cancellation during any active stage produces a cancelled state, never an import-ready state, and reports any explicitly incomplete output that could not be removed safely.
- Existing destination collisions require an explicit replacement or alternate-name decision. Insufficient storage or write failure closes open writers, reports the failing artifact, and never reports success.
- Import into an editor build without a passing exact-version compatibility-matrix row is unsupported and is disclosed before export and in the compatibility report.
- A browser without Resolve directory-write capability blocks that target with supported-browser guidance; the single-file flattened MOV target remains available when its codec preflight passes.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The export experience MUST offer explicit "DaVinci Resolve" and "iMovie" handoff targets and explain, before export, whether each target produces an editable timeline or a flattened movie.
- **FR-002**: The DaVinci Resolve target MUST produce an FCPXML editable timeline document and the media references or collected media required to relink and import it.
- **FR-003**: The iMovie target MUST produce a self-contained MOV movie using a picture and audio combination verified against the supported iMovie compatibility matrix.
- **FR-004**: Users MUST be able to export either the complete timeline or a valid selected timeline range for both targets.
- **FR-005**: An editable Resolve handoff MUST preserve project resolution, frame rate, timeline start, track order, clip order, timeline start and duration, source in/out points, gaps, enabled state, and audio synchronization wherever the target format can represent them.
- **FR-006**: Timing in an editable handoff MUST be frame-aligned using a documented deterministic rounding rule, and represented clip boundaries MUST differ from OpenReel by no more than one destination frame.
- **FR-007**: The iMovie handoff MUST preserve the visible composite, mixed audible audio, aspect ratio, orientation, frame rate, and selected-range duration of the OpenReel render.
- **FR-008**: Before creating artifacts, the system MUST assess media availability, invalid timing, and edits that cannot be represented faithfully for the selected target.
- **FR-009**: The compatibility assessment MUST identify each material issue by project, track, clip, or media asset as applicable and MUST distinguish blocking errors, flattening notices, and informational differences.
- **FR-010**: A material feature that cannot be represented deterministically by the initial editable Resolve contract MUST block editable export and direct the user to the flattened MOV handoff. This release MUST NOT claim or generate per-clip substitutes.
- **FR-011**: Required missing or inaccessible media MUST block any handoff that would otherwise omit or misrepresent that content. The failure MUST include an actionable relink or permission-recovery step.
- **FR-012**: Hidden video tracks and muted audio tracks MUST remain excluded from the output unless the user explicitly changes their project state before export.
- **FR-013**: Each completed handoff MUST include a human-readable compatibility report naming the project, target, exported range, output artifacts, warnings, blocking or flattened-only items, and compatibility baseline.
- **FR-014**: Output names and internal media references MUST be deterministic, collision-safe, and valid for the user's local file system.
- **FR-015**: Repeated export of an unchanged project with the same target and range MUST produce equivalent timeline structure and media mapping.
- **FR-016**: Users MUST be able to cancel without receiving a misleading success state or a partially completed artifact presented as import-ready.
- **FR-017**: Export progress MUST distinguish assessment, media resolution, rendering when applicable, packaging, and saving.
- **FR-018**: Any failure MUST remain visible, state whether retry is safe, and include the target and failing stage without exposing private source locations beyond what the user needs to resolve the problem.
- **FR-019**: Existing general-purpose MP4, WebM, MOV, WAV, image, and OpenReel project exports MUST remain available and retain their current behavior.
- **FR-020**: The supported target-editor compatibility matrix MUST identify exact application builds and operating systems, MUST contain at least one passing row per advertised target before release, and MUST be updated whenever the emitted handoff contract changes. A target-editor build MUST NOT be advertised as supported without a passing row.

### Verification Requirements

- **VR-001**: Deterministic core behavior and every failure path MUST have failing-first local tests covering frame math, range projection, representability, naming, serialization, cancellation, retryability, and redaction.
- **VR-002**: No LLM or probabilistic behavior is introduced, so no probabilistic eval is required. Any later probabilistic compatibility classifier requires a separate specification and eval threshold.
- **VR-003**: Browser verification MUST reproduce both targets, full and selected ranges, blocked preflight, cancellation, write failure, safe retry, completed artifacts, and the three-primary-action path.
- **VR-004**: Destination verification MUST record the exact editor build, operating system, fixture identity, artifact SHA-256, import result, timing and drift comparison, screenshots or recordings, verifier, and date.

### Key Entities

- **Handoff Target**: The destination editor, supported versions, editable or flattened capability, required artifact types, and compatibility rules.
- **Export Range**: The full timeline or selected start and end boundaries used to derive included content and output duration.
- **Compatibility Assessment**: A deterministic set of blocking errors, flattening notices, informational differences, affected entity identifiers, and recommended actions.
- **Timeline Handoff**: The editable sequence description containing project timing, tracks, clips, source ranges, and media references.
- **Media Reference**: The stable mapping between an OpenReel media asset, its source identity, collected output name, and destination-editor reference.
- **Rendered Handoff**: The self-contained movie whose picture and mixed audio represent the selected OpenReel range.
- **Compatibility Report**: The user-readable record of target, range, artifacts, warnings, blocking or flattened-only content, and compatibility baseline.

### Assumptions

- "Importable" means the destination application accepts the artifact without a separate transcoding or conversion step.
- DaVinci Resolve users need an editable timeline handoff. FCPXML is the baseline interchange format because Resolve supports it and OpenReel's current exports do not preserve editable timeline structure.
- iMovie users need a reliable media handoff. The iMovie path is deliberately flattened because iMovie does not provide a dependable general-purpose editable timeline import contract for this workflow.
- Source media remains owned by the user. Collection or copying occurs only as part of the user-initiated export.
- OpenReel-only effects may require rendering, but silent omission is never acceptable.
- Compatibility is guaranteed only for versions listed in the maintained compatibility matrix.

### Dependencies

- The existing project timeline, media library, range selection, rendering, audio mixing, progress, cancellation, and local-save behaviors remain the sources of truth.
- Release verification requires access to the supported DaVinci Resolve and iMovie versions on compatible test systems.
- Media collection depends on the browser or desktop environment retaining access to each required source asset.

### Out of Scope

- Importing DaVinci Resolve or iMovie projects back into OpenReel.
- Round-trip synchronization after a handoff is imported and edited elsewhere.
- Reproducing destination-specific color grading, plugins, titles, transitions, or effects that have no faithful OpenReel equivalent.
- Claiming editable iMovie timeline transfer.
- Cloud delivery, collaboration links, or automatic upload to a destination editor.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of the maintained representative Resolve fixtures import into every supported Resolve version without manual repair of timeline structure or media mapping.
- **SC-002**: For supported editable properties, imported Resolve clip boundaries and source ranges differ from OpenReel by no more than one destination frame, with no cumulative audio drift across a 60-minute fixture.
- **SC-003**: 100% of the maintained horizontal, vertical, and square iMovie fixtures import into every supported iMovie version without conversion and preserve dimensions, orientation, frame rate, duration within one frame, and synchronized audible audio.
- **SC-004**: 100% of missing required media and unsupported material edits in the compatibility fixture set are reported before artifact creation; none are silently omitted.
- **SC-005**: Starting with export controls visible and any range already selected, a valid handoff starts in at most three primary activations: open the handoff dialog, select the target, and activate Start after automatic compatibility assessment. Scrolling, focus movement, and passive review are not primary activations.
- **SC-006**: For the deterministic 1,000-clip fixture on the recorded baseline of Apple M4, 16 GiB RAM, macOS, and Node.js 26.5.0, compatibility assessment completes with a median under 5 seconds across five warm-process runs and no run above 6 seconds.
- **SC-007**: Cancellation and injected failures at every export stage produce no import-ready success state and always identify the failed or cancelled stage.
- **SC-008**: Existing export regression fixtures continue to pass with unchanged output behavior.
