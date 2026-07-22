# Feature Specification: Media Library and Import

**Feature Branch**: `feature/time-machine-media-library`  
**Created**: 2026-07-22  
**Status**: Draft  
**Input**: Feature: Media Library and Import. Description: Users import, verify, organize, preview, and insert durable media assets into projects. Relevant files: `apps/web/src/components/editor/AssetsPanel.tsx`, `apps/web/src/components/editor/asset-manager`, `apps/web/src/components/editor/media-timeline-insertion.ts`, `apps/web/src/services/media-storage.ts`, `apps/web/src/services/media-verification.ts`, `packages/core/src/media`. Focus on this feature only; do not modify other features.

## Clarifications

### Session 2026-07-22

- Q: What maximum file-size policy should media import enforce? → A: Use a configurable maximum with a 2 GiB default, while rejecting earlier when actual browser capability or available storage is lower.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Import Durable Media (Priority: P1)

As an editor, I can import one or more supported media files through the file picker or drag and drop so they become durable project assets with useful metadata and previews.

**Why this priority**: Every downstream media-library workflow depends on a reliable import that survives reloads and reports failures clearly.

**Independent Test**: Import representative video, audio, image, animated image, and subtitle files, reload the project, and verify that each successful asset remains available with its stable identity, metadata, and diagnostic state.

**Acceptance Scenarios**:

1. **Given** a project is open, **When** the user imports multiple supported files, **Then** the system processes them in a visible sequence, reports the current filename and position, and creates one stable media item for each successful file.
2. **Given** a supported media file, **When** import succeeds, **Then** the asset records its immutable source filename and identity hints, editable title, media type, file size, duration and stream metadata when applicable, and available thumbnail, filmstrip, or waveform data.
3. **Given** the same source file is imported again, **When** an existing asset matches its file identity, **Then** the existing asset is replaced or refreshed without creating an indistinguishable duplicate, while user-authored metadata and timeline references remain associated with its stable identity.
4. **Given** one file in a multi-file import is unsupported, corrupt, unreadable, or cannot be persisted, **When** processing completes, **Then** the remaining files continue and the user receives an itemized result identifying successes, failures, degraded persistence, and available retry or relink actions.
5. **Given** the browser can retain a file-system handle, **When** a file is imported or dropped, **Then** the handle is stored as recovery assistance; if handle storage fails, import may continue but the loss of automatic recovery is surfaced non-blockingly.

---

### User Story 2 - Find and Inspect Assets (Priority: P1)

As an editor, I can search, group, change view density, select, and inspect media assets so I can locate the right source quickly in a large project.

**Why this priority**: Imported assets provide little value if users cannot identify, preview, or distinguish their status.

**Independent Test**: Seed a project with mixed media types, metadata, statuses, and scenes; use every search, grouping, view, collapse, and selection control; verify the visible results and accessible control states.

**Acceptance Scenarios**:

1. **Given** assets have source names, titles, descriptions, tags, or groups, **When** the user searches case-insensitively, **Then** every matching asset remains visible and non-matching assets are excluded without changing project data.
2. **Given** the normal media view, **When** the user groups by type, status, tag, or no grouping, **Then** assets appear in the correct buckets; scenes remain a searchable type bucket but are not treated as imported media for missing-file operations.
3. **Given** grouped results, **When** the user collapses or expands all, **Then** bucket contents follow the requested state; these controls are disabled when grouping is off.
4. **Given** the media pane, **When** the user switches among large, small, and list views, **Then** the same filtered asset set and selection remain intact.
5. **Given** an asset is selected, **When** its details open, **Then** the user can identify its type, dimensions or channel metadata, duration, file size, generation/version provenance when present, preview availability, and current missing, pending, error, placeholder, or available state.

---

### User Story 3 - Insert Media at the Intended Timeline Position (Priority: P1)

As an editor, I can add a media asset at the current playhead or scrub position so it lands on a compatible track and is immediately selected for editing.

**Why this priority**: Moving an asset from the library into the edit is the primary completion point for media-library work.

**Independent Test**: Insert video, image, audio, and subtitle assets with compatible, incompatible, locked, and absent active tracks at zero and non-zero playhead/scrub positions.

**Acceptance Scenarios**:

1. **Given** a compatible active track, **When** the user chooses Add to Timeline, **Then** the asset is inserted on that track at the captured scrub position when scrubbing or otherwise at the playhead, including a valid time of zero.
2. **Given** the active track is incompatible or locked, **When** the user inserts media, **Then** the system uses an existing unlocked compatible track or creates the minimum compatible track without changing the captured insertion time.
3. **Given** insertion succeeds, **When** the new clip is created, **Then** its track becomes active and the new clip becomes the current selection.
4. **Given** the asset, track creation, or clip insertion cannot complete, **When** insertion stops, **Then** no partial selection or misleading success state remains and the user receives an actionable error.
5. **Given** media is dragged onto a timeline track, **When** the drop target is compatible, **Then** the same media identity, compatibility rules, and failure reporting apply.

---

### User Story 4 - Recover Missing or Changed Sources (Priority: P2)

As an editor reopening or moving a project, I can distinguish truly missing media from temporary verification failures and relink or replace source files without breaking existing edits.

**Why this priority**: Durable project metadata must remain useful when browser storage, backend media, network state, or local file permissions change.

**Independent Test**: Load assets whose media URLs produce available, missing, transient, invalid-range, wrong-type, offline, and decode-error outcomes, then exercise per-item verification, verify-all, direct replacement, and folder relinking.

**Acceptance Scenarios**:

1. **Given** a project loads with media references, **When** verification runs, **Then** it deduplicates work, bounds concurrency and time, publishes verifying/completed states atomically, and distinguishes confirmed absence from transient, offline, cancelled, malformed, wrong-type, truncated, and decode failures.
2. **Given** verification completes after the project, URL, or verification generation changes, **When** the stale result arrives, **Then** it is discarded and does not overwrite a newer relink or active-project state.
3. **Given** one or more assets are confirmed missing, **When** the user enables the missing-only view, **Then** only missing media items appear; the mode turns off when the final missing item is resolved and does not reactivate merely because missing items later reappear.
4. **Given** missing assets retain source filename and size hints, **When** the user chooses a folder, **Then** recursive or fallback folder matching relinks exact filename-and-size matches, preserves asset IDs and timeline references, and reports linked, unmatched, and failed counts.
5. **Given** the user replaces or links one asset directly, **When** processing succeeds, **Then** source data, technical metadata, previews, and durable storage update while title, description, tags, group, version relationship, and references remain intact.

---

### User Story 5 - Organize and Manage Assets Safely (Priority: P2)

As an editor, I can edit asset metadata, download available local media, associate supported assets with related workflows, and remove unused assets without corrupting the project.

**Why this priority**: Organization and lifecycle controls keep the library understandable while safe deletion protects existing edits.

**Independent Test**: Edit metadata and tags with keyboard controls, replace and download local media, inspect version history, associate a video with a scene, and attempt deletion both with and without timeline references.

**Acceptance Scenarios**:

1. **Given** an asset is selected, **When** the user edits title, description, tags, or group and saves, **Then** normalized metadata persists without changing the immutable source filename or binary identity.
2. **Given** a tag editor, **When** the user adds, removes, or backspaces tags, **Then** tags are trimmed, normalized case-insensitively, deduplicated, and operable by keyboard with accessible names.
3. **Given** an asset has a local blob, **When** the user downloads it, **Then** the original media bytes are offered with an appropriate filename; otherwise the unavailable action is not offered.
4. **Given** an asset is not referenced by timeline clips or protected workflows, **When** the user confirms deletion, **Then** its library record and durable binary are removed through the undoable project action and any storage cleanup failure is surfaced.
5. **Given** an asset is referenced by one or more timeline clips or protected workflows, **When** deletion is requested, **Then** deletion is blocked with the number and type of dependencies and instructions to remove or replace them first.

### Edge Cases

- The user cancels a file or folder picker, drops a directory or non-file item, or the browser lacks the File System Access API.
- A multi-file import contains duplicate names with different sizes, duplicate content with different names, or mixed valid and invalid files.
- File metadata reports zero, negative, non-finite, missing, rotated, or unusually large dimensions, duration, frame rate, channel count, or size.
- Thumbnail, filmstrip, waveform, local storage, backend upload, or retained-handle generation fails after decoding succeeds.
- An SRT file contains parse warnings, no cues, overlapping cues, invalid timing, or an existing matching subtitle asset.
- Verification receives 200 HTML, wrong MIME, malformed ranges, zero/truncated bodies, unsupported HEAD, offline errors, aborts, timeouts, or stale responses.
- Folder relinking finds multiple files with the same filename and size or only a partial subset of missing assets.
- The playhead is zero, the scrub position changes while insertion is asynchronous, or the active track becomes locked/removed before completion.
- The asset is deleted, replaced, or relinked from another action while import, verification, or insertion is still pending.
- Generated versions and scene associations exist, but generation and storyboard editing remain owned by their separate feature workflows.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST allow one or multiple files to be imported through an accessible file action and through drag and drop.
- **FR-002**: The system MUST support its currently advertised formats: MP4, WebM, MOV, and MKV video; MP3, WAV, AAC, OGG, and FLAC audio; JPEG, PNG, WebP, and GIF images; and SRT subtitles, subject to explicit runtime capability validation.
- **FR-003**: The system MUST validate each file independently and continue processing later files after an individual failure.
- **FR-004**: Multi-file import MUST show the current filename, one-based position, total count, and current processing stage, and MUST finish with itemized success, failure, and degraded-persistence results.
- **FR-005**: A successful import MUST create or update a stable media identity with immutable source filename, source identity hints, media type, technical metadata, editable title, and available preview derivatives.
- **FR-006**: Re-importing an exact source identity MUST update the existing asset rather than create an indistinguishable duplicate, while preserving user metadata, group/version identity, and timeline references.
- **FR-007**: Local durable storage MUST complete or enter an explicit retryable degraded state before import is reported as fully durable; backend upload MAY continue asynchronously but its failure MUST remain visible and retryable.
- **FR-008**: Failures to persist recovery handles MUST be logged with asset/file context and shown as a non-blocking loss of automatic recovery rather than silently ignored.
- **FR-009**: Subtitle import MUST parse cue timing directly, retain a stable subtitle media item, calculate duration from valid cues, surface parse warnings, and reject an unusable empty or invalid result.
- **FR-010**: Search MUST match source name, editable title, description, tags, and group case-insensitively without mutating asset order or metadata.
- **FR-011**: Users MUST be able to switch among large, small, and list views without losing filters, grouping, or selection.
- **FR-012**: Users MUST be able to group assets by type, status, tag, or no grouping, and collapse/expand controls MUST be available only when grouping is active.
- **FR-013**: Status grouping and badges MUST distinguish available, missing, pending/unrealized, and error assets; transient verification failure MUST NOT be presented as confirmed missing.
- **FR-014**: Asset inspection MUST expose applicable technical metadata, availability, user metadata, generation provenance, version history, preview state, and safe management actions.
- **FR-015**: Selection, toolbar, menus, grouping, metadata editing, and asset actions MUST provide semantic roles, accessible names, visible focus, keyboard operation, and live progress/status announcements.
- **FR-016**: Timeline insertion MUST capture scrub time when actively scrubbing and otherwise playhead time before asynchronous work; a start time of zero MUST remain valid.
- **FR-017**: Timeline insertion MUST prefer the selected compatible unlocked track, then an existing compatible unlocked track, then create one compatible track.
- **FR-018**: A successful insertion MUST activate the target track and select only the newly created clip.
- **FR-019**: Track creation, clip insertion, and drag-drop failures MUST avoid partial UI state and MUST surface an actionable error with the media and target identifiers.
- **FR-020**: Verification MUST deduplicate project/media work, bound concurrency and retries, enforce a timeout, support cancellation, and discard results for stale projects, URLs, or verification generations.
- **FR-021**: Verification MUST use a one-byte range request when a server does not support HEAD and MUST reject misleading success responses with wrong content type, malformed range, or missing/truncated bytes.
- **FR-022**: Missing-only mode MUST derive from authoritative media status rather than current search results, turn off when the last missing asset resolves, and remain off until the user explicitly enables it again.
- **FR-023**: Folder relinking MUST match missing assets by normalized filename plus exact size, preserve stable media IDs, report linked/unmatched/failed counts, and avoid choosing silently among ambiguous matches.
- **FR-024**: Direct replace or relink MUST preserve title, description, tags, group, version identity, generation provenance, and references while updating source identity, binary, technical metadata, and previews.
- **FR-025**: User metadata changes MUST be saved atomically, normalize/deduplicate tags, preserve immutable source names, and surface save failures without closing or resetting edits.
- **FR-026**: Download MUST be offered only when local media bytes are available and MUST not alter project state.
- **FR-027**: Deletion MUST be undoable at the project-model level, remove durable binary data after model success, surface cleanup failure, and be blocked while timeline clips or protected workflow records reference the asset.
- **FR-028**: Long-running import, verification, relinking, replacement, and insertion operations MUST expose progress within 300 ms and MUST not leave controls indefinitely disabled after cancellation or failure.
- **FR-029**: Missing media, decode failure, thumbnail failure, storage failure, upload failure, verification failure, and insertion failure MUST never be silently skipped; each MUST produce actionable UI feedback and structured diagnostics with project/media identifiers.
- **FR-030**: Import MUST enforce a configurable maximum source-file size with a 2 GiB default, preflight available browser storage and runtime capability, and report whether rejection was caused by the configured cap, available capacity, or unsupported runtime capability.

### Key Entities *(include if feature involves data)*

- **Media Asset**: A stable project record containing immutable source identity, editable descriptive metadata, media type, technical metadata, preview derivatives, durable-location information, version/generation provenance, and availability state.
- **Source Identity**: Filename, byte size, last-modified time, and optional folder hint used to detect re-imports and relink candidates without treating display metadata as identity.
- **Media Availability Outcome**: A versioned verification result distinguishing available, confirmed missing, transient/offline/cancelled, invalid response, and decode failure evidence.
- **Preview Derivative**: Thumbnail, filmstrip frame, or waveform derived from source media and associated with the stable media ID.
- **Timeline Media Reference**: A clip-to-media relationship that constrains deletion and must survive replace/relink operations.
- **User Metadata**: Editable title, description, normalized tags, and optional group that remains independent from the immutable source filename.
- **Import Result**: Per-file outcome containing success, error/degraded stage, stable media ID when created, warnings, and available recovery action.

### Assumptions and Dependencies

- This specification describes and hardens the existing browser-based media library rather than replacing it.
- Local browser storage is the immediate durable source; the existing orchestrator upload provides cross-session/project recovery when configured.
- Browser codec support can vary, so the advertised format list is validated at runtime and capability errors remain specific.
- Exact duplicate identity follows the existing filename/size/last-modified matching policy; content hashing is outside this feature.
- Maximum import size is configurable with a 2 GiB default; actual browser capability or available storage MAY impose a lower effective limit and MUST be reported specifically.
- Safe deletion defaults to blocking referenced assets. Cascading deletion of timeline clips is outside scope.
- Scene association and generated-version metadata may be displayed or linked here, while scene editing and generation remain separate feature workflows.

### Out of Scope

- Cloud asset catalogs, shared-team libraries, remote stock search, digital-asset-management permissions, or background transcoding farms.
- Content-based duplicate detection, automatic tagging, semantic search, or AI-generated descriptions.
- Timeline editing beyond placing a selected media asset and selecting the resulting clip.
- Storyboard/scene creation, generation job execution, or export behavior.
- Cascading deletion of dependent clips or project records.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a deterministic mixed batch, 100% of valid files become stable assets and 100% of invalid or degraded files receive an itemized outcome without preventing later files from processing.
- **SC-002**: After reload, 100% of successfully durable test assets retain their stable IDs, source identity, user metadata, technical metadata, and references.
- **SC-003**: Search, grouping, view, missing-only, and selection fixtures return the expected visible set in 100% of tested combinations, including empty and zero-result states.
- **SC-004**: Representative video, image, audio, and subtitle insertions land at the captured zero or non-zero timeline time on the required track and select exactly the new clip in 100% of deterministic cases.
- **SC-005**: Verification fixtures classify every available, missing, transient, offline, cancelled, malformed, wrong-type, truncated, timeout, and stale result correctly without a stale result overwriting current state.
- **SC-006**: Folder relinking preserves media IDs and timeline references for every exact match, reports every unmatched or failed item, and makes zero silent ambiguous matches.
- **SC-007**: Attempts to delete referenced assets are blocked in 100% of dependency fixtures; unreferenced deletion remains undoable and every storage-cleanup failure is visible.
- **SC-008**: Import, verification, relink, replace, and insertion operations show status within 300 ms, return controls to an operable state after every tested failure/cancellation, and add no more than 10 ms p95 interaction delay during ordinary library browsing.
- **SC-009**: Keyboard-only users can reach and operate every media toolbar, grouping, view, metadata, relink, and management action with visible focus and an accessible name in the browser verification matrix.
- **SC-010**: A user can import, locate, inspect, and place a supported media file on the timeline in under two minutes without consulting developer tools.
- **SC-011**: Boundary tests at one byte below, exactly at, and one byte above the configured maximum, plus insufficient-capacity and unsupported-runtime fixtures, produce the expected accept/reject outcome and specific reason in 100% of cases without allocating the full source size in test memory.
