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
- A selected range begins or ends inside a clip, transition, speed change, title, or audio fade.
- The project frame rate differs from one or more source assets, or timing lands between target-editor frames.
- A clip is reversed, frozen, retimed, nested, generated, compound, or uses an OpenReel-only effect.
- A track is hidden, muted, locked, empty, or contains overlapping clips.
- Media is offline, browser-local permission has expired, a source URL is unavailable, or two assets have the same filename.
- A source filename or project name contains characters not accepted by the destination or local file system.
- The user cancels during compatibility assessment, media collection, rendering, packaging, or save selection.
- The destination file already exists or available storage is insufficient.
- The handoff is imported into a target-editor version outside the supported compatibility matrix.

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
- **FR-010**: A feature that cannot be represented in the editable Resolve handoff MUST be rendered into a faithful substitute when that outcome is supported and disclosed; otherwise the editable export MUST be blocked and the user MUST be directed to the flattened handoff.
- **FR-011**: Required missing or inaccessible media MUST block any handoff that would otherwise omit or misrepresent that content. The failure MUST include an actionable relink or permission-recovery step.
- **FR-012**: Hidden video tracks and muted audio tracks MUST remain excluded from the output unless the user explicitly changes their project state before export.
- **FR-013**: Each completed handoff MUST include a human-readable compatibility report naming the project, target, exported range, output artifacts, warnings, substitutions, unsupported items, and compatibility baseline.
- **FR-014**: Output names and internal media references MUST be deterministic, collision-safe, and valid for the user's local file system.
- **FR-015**: Repeated export of an unchanged project with the same target and range MUST produce equivalent timeline structure and media mapping.
- **FR-016**: Users MUST be able to cancel without receiving a misleading success state or a partially completed artifact presented as import-ready.
- **FR-017**: Export progress MUST distinguish assessment, media resolution, rendering when applicable, packaging, and saving.
- **FR-018**: Any failure MUST remain visible, state whether retry is safe, and include the target and failing stage without exposing private source locations beyond what the user needs to resolve the problem.
- **FR-019**: Existing general-purpose MP4, WebM, MOV, WAV, image, and OpenReel project exports MUST remain available and retain their current behavior.
- **FR-020**: The supported target-editor compatibility matrix MUST identify the tested DaVinci Resolve and iMovie versions and MUST be updated whenever the emitted handoff contract changes.

### Key Entities

- **Handoff Target**: The destination editor, supported versions, editable or flattened capability, required artifact types, and compatibility rules.
- **Export Range**: The full timeline or selected start and end boundaries used to derive included content and output duration.
- **Compatibility Assessment**: A deterministic set of blocking errors, flattening notices, informational differences, affected entity identifiers, and recommended actions.
- **Timeline Handoff**: The editable sequence description containing project timing, tracks, clips, source ranges, and media references.
- **Media Reference**: The stable mapping between an OpenReel media asset, its source identity, collected output name, and destination-editor reference.
- **Rendered Handoff**: The self-contained movie whose picture and mixed audio represent the selected OpenReel range.
- **Compatibility Report**: The user-readable record of target, range, artifacts, warnings, substitutions, unsupported content, and compatibility baseline.

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
- **SC-005**: A user can choose a target, review compatibility, and start a valid handoff in no more than three primary actions.
- **SC-006**: Compatibility assessment completes within 5 seconds for a project containing 1,000 clips on the project's supported baseline device.
- **SC-007**: Cancellation and injected failures at every export stage produce no import-ready success state and always identify the failed or cancelled stage.
- **SC-008**: Existing export regression fixtures continue to pass with unchanged output behavior.
