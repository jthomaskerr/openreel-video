# Feature Specification: Reliable Saving and Repeat Playback

**Feature Branch**: `feature/time-machine-ai-generation`
**Created**: 2026-07-22
**Status**: Draft
**Input**: User description: "Fix recurring false project conflicts during ordinary media edits and the preview freeze on second play."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Persist Consecutive Media Edits (Priority: P1)

An editor adds media, places or moves it on the timeline, and continues editing while earlier changes are still being saved. The editor's latest complete project state is saved without an ordinary sequence of local edits being reported as a project conflict.

**Why this priority**: Users cannot trust the editor if routine actions make the project unsavable or if the durable project omits their latest work.

**Independent Test**: Add a media item, trigger a save, move the item while that save remains in progress, wait for saving to finish, reopen the project, and verify that the media item and its final position are present without a conflict.

**Acceptance Scenarios**:

1. **Given** an open project with a confirmed durable version, **When** the user adds a media item and moves it while the first change is still saving, **Then** both changes are saved in their final order and no project conflict is shown.
2. **Given** a save is in progress, **When** the user makes several more project changes, **Then** the newest complete project state remains pending and is saved after the in-progress save completes.
3. **Given** several local changes have been saved, **When** the user closes and reopens the project, **Then** the reopened project matches the final saved timeline, media library, and project settings.
4. **Given** a temporary save failure occurs, **When** saving can safely be retried, **Then** the latest complete local state remains available for retry and the user is not shown a false conflict.

---

### User Story 2 - Play the Preview Repeatedly (Priority: P1)

An editor plays a timeline to the end and presses Play again. Each playback run starts from the expected position and advances normally instead of freezing on the final frame.

**Why this priority**: Repeated preview is a basic editing loop. A second-play freeze prevents review of timing and makes the editor appear broken.

**Independent Test**: Open a representative project, play it to completion, press Play again, and verify that the playhead and rendered preview restart at the beginning and continue advancing through the timeline.

**Acceptance Scenarios**:

1. **Given** playback reaches the end of a non-empty timeline, **When** playback stops, **Then** the playhead and next-play start position are reset to the beginning.
2. **Given** a completed playback run, **When** the user presses Play again, **Then** the preview begins at the start and advances without requiring a manual seek or reload.
3. **Given** the user pauses before the end, **When** the user resumes, **Then** playback continues from the paused position rather than restarting.
4. **Given** the user seeks after playback ends, **When** the user presses Play, **Then** playback begins from the user-selected position.
5. **Given** any supported timeline composition, **When** the user completes and restarts playback repeatedly, **Then** cleanup from an earlier run does not change the start position or stop the active run.

---

### User Story 3 - Preserve Real Conflict Protection (Priority: P2)

An editor is protected when the durable project truly changed outside the current sequence of local saves. The newer durable state is not overwritten, the local edit remains recoverable, and the conflict message identifies useful next actions.

**Why this priority**: Removing false conflicts must not weaken protection against genuine stale or concurrent writes.

**Independent Test**: Change the durable project through a separate writer, attempt to save an edit based on the older version, and verify that the newer durable project remains intact while the local state and recovery choices remain available.

**Acceptance Scenarios**:

1. **Given** the durable project changed outside the current local save sequence, **When** the editor submits a state based on an older durable version, **Then** the save is rejected as a real conflict and the newer durable state is not overwritten.
2. **Given** a real conflict, **When** it is reported, **Then** the local project remains in memory and the user is offered an actionable recovery path.
3. **Given** only locally ordered saves advanced the durable version, **When** the next queued local state is saved, **Then** it continues from the newly confirmed version and is not classified as an external conflict.

### Edge Cases

- A new edit arrives after a save request starts but before its durable confirmation returns.
- Dozens of rapid local mutations occur while saving, including media import, clip placement, movement, trimming, and metadata changes.
- A save becomes durable before its background confirmation is visible to the editor.
- Media upload succeeds but project-state saving fails, or project-state saving succeeds but confirmation is delayed.
- The user switches projects while one or more saves remain queued; each save and status update must remain attached to its originating project.
- Playback is restarted after a full run for a single video clip, multiple visual clips, image-only content, audio-only content, and timelines containing gaps.
- Playback is paused, resumed, ended, restarted, and manually sought in quick succession.
- A timeline has no playable duration or contains unavailable media; playback must stop with actionable feedback rather than enter a false playing state.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST treat consecutive saves initiated by one editor session as an ordered local sequence rather than independent concurrent writers.
- **FR-002**: While a save is in progress, the system MUST retain the newest complete project state produced by later local edits.
- **FR-003**: After a local save becomes durable, the next queued local save MUST be based on that newly confirmed durable version.
- **FR-004**: Ordinary local edit sequences MUST NOT produce a project conflict solely because an earlier local save completed first.
- **FR-005**: Coalescing or ordering saves MUST preserve every effect represented by the newest complete local project state, including media-library and timeline changes.
- **FR-006**: A successful saved state MUST reopen with the same final project identity, settings, media references, timeline structure, clip positions, and clip properties.
- **FR-007**: The save status shown to the user MUST distinguish pending, saving, durably saved, retryable failure, incomplete media, and genuine conflict states.
- **FR-008**: A failed save MUST preserve the latest in-memory project state and provide an actionable failure message without silently discarding queued changes.
- **FR-009**: Save requests and their completion, retry, failure, and conflict status MUST remain bound to the project that originated them, including after the user switches projects.
- **FR-010**: The system MUST continue to reject a save based on a durable version that was changed by a genuinely separate writer.
- **FR-011**: A genuine conflict MUST preserve the newer durable project, retain the local conflicting state for recovery, and identify available recovery actions.
- **FR-012**: When playback reaches the end of a non-empty timeline, the system MUST leave playback stopped and make the beginning the default start position for the next run.
- **FR-013**: Starting playback after a completed run MUST advance the playhead and rendered preview from the beginning without requiring a manual seek, edit, or reload.
- **FR-014**: Pausing and resuming before the end MUST preserve the paused position, while a user seek MUST replace the default start position.
- **FR-015**: Ending or cleaning up an earlier playback run MUST NOT overwrite a later reset, seek, or active playback position.
- **FR-016**: Repeat playback MUST work for every supported timeline composition, including video, image, audio-only, multi-clip, and gap-containing timelines.
- **FR-017**: An unplayable timeline or unavailable media MUST produce an explicit stopped or error state with actionable feedback; it MUST NOT appear to be playing while the preview is frozen.
- **FR-018**: Deterministic regression coverage MUST exercise an edit arriving during an in-progress save, multiple queued edits, a genuine external conflict, playback completion followed by replay, pause/resume, and seek-after-completion.
- **FR-019**: The complete add-media, move-media, save, reopen, play-to-end, and play-again workflow MUST be verified in the browser before the regression is considered resolved.

### Key Entities

- **Project State**: The complete editable state for one project, including identity, settings, media library, timeline, and clip properties.
- **Durable Project Version**: The most recently confirmed complete project state, identified by an immutable revision and its project identity.
- **Local Save Sequence**: Ordered save attempts produced by one editor session, where each later attempt represents a project state derived from earlier local work.
- **External Writer**: Any actor outside the current local save sequence that can advance the durable project version and create a genuine stale-write conflict.
- **Playback Run**: One transition from a chosen start position through playing to pause, completion, stop, or error.
- **Playback Position**: The authoritative timeline position used by the playhead, rendered preview, and next playback start.

### Assumptions

- One user actively edits a project in one editor session at a time; collaborative merge behavior remains outside this feature.
- A later complete project state in the same local save sequence includes the effects of earlier local states and may replace redundant queued snapshots.
- Existing atomic-save and genuine stale-write protections remain authoritative and must not be bypassed.
- Existing supported project data and media-availability rules remain unchanged except for the reliability requirements stated here.
- The project constitution is currently an unfilled template and adds no feature-specific governance requirements.

### Scope Boundaries

- This feature covers false conflicts caused by the editor's own ordered saves, but does not add automatic merging for independent writers.
- This feature covers preview lifecycle correctness, but does not redesign player controls or add new playback modes.
- This feature hardens all ordinary project mutations affected by save ordering; it is not limited to the two reported add-media and move-media examples.
- Broader project history, collaboration, portable package, and recovery-envelope work remains governed by the Project Lifecycle and Persistence specification.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Across 100 deterministic runs where a media item is added and then moved while the first save is in progress, zero runs report a false conflict and 100% reopen with the final media item and position intact.
- **SC-002**: Across 100 deterministic rapid-edit sequences of at least 20 local mutations, 100% finish with the latest complete state durably saved or an explicit actionable non-conflict failure; no queued edit is silently lost.
- **SC-003**: Across genuine stale-write cases, 100% preserve the newer durable project and retain the local state for recovery rather than overwriting either state.
- **SC-004**: For each supported representative timeline composition, 20 consecutive full playback runs restart from the expected position and visibly advance; zero second or later runs freeze at the end position.
- **SC-005**: Pause/resume and seek-after-completion checks preserve the user-selected start position in 100% of deterministic runs.
- **SC-006**: Under normal local operating conditions, the editor reaches either a durably saved state or an actionable error within 10 seconds after the final edit in a local sequence.
- **SC-007**: The browser acceptance workflow completes add, move, save, reopen, full playback, and second playback with no project conflict, no lost edit, and no frozen preview.
