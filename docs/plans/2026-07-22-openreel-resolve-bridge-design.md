# OpenReel Resolve Bridge Design

**Date:** 2026-07-22  
**Status:** Approved  
**Verified Resolve target:** DaVinci Resolve 21.0.3 build 21.0.30007 on macOS

## Outcome

From OpenReel, a user can browse backend-managed projects with rich previews, choose **Open in Resolve**, and receive a new DaVinci Resolve project populated from the selected OpenReel revision. The workflow works when Resolve is showing Project Manager with no project open.

OpenReel remains authoritative for project data, media, compatibility assessment, export artifacts, progress, and audit evidence. A native Swift bridge handles macOS launching and Accessibility automation. A thin internal Python adapter performs only operations that require Resolve's in-process scripting API.

## Non-goals

- Registering a new extension in Resolve's native **File > Import > Timeline** menu; the public API does not expose importer registration.
- Reimplementing OpenReel project parsing or compatibility logic in Swift or Python.
- Driving timeline construction through fragile UI automation when the Resolve scripting API provides a deterministic call.
- Claiming compatibility with Resolve builds that have not passed the acceptance matrix.
- Overwriting, renaming, or deleting an existing Resolve project.

## Components

### OpenReel web picker

The existing Resolve handoff control opens a master-detail project picker. The picker reads projects and preview data from the orchestrator API. It starts the export job and launches the bridge only after the backend has produced and verified the import artifact.

### Orchestrator export API

The orchestrator owns the export lifecycle. It loads a confirmed persisted project revision, resolves media through existing project media endpoints/storage, runs the core compatibility and FCPXML pipeline, records artifact hashes and expectations, and exposes progress and results.

### OpenReel Bridge.app

A per-user native Swift application registers the `openreel-resolve` URL scheme. It validates the launch request against the configured local orchestrator, requests Accessibility permission, starts or focuses Resolve, creates one new provisional project through Resolve's Project Manager UI, and invokes the installed internal script.

Swift does not parse OpenReel project documents or generate timelines. It owns native UI, launch coordination, Accessibility state transitions, timeouts, and user-visible errors.

### Internal Resolve adapter

A Python Utility script runs inside Resolve, where the project/timeline API is available even though external scripting IPC is unavailable in this installation. It reads one backend-issued request, confirms its request ID and artifact hashes, imports into the current provisional project, renames that same project after success, verifies the timeline, saves, and posts structured evidence to the orchestrator.

## Project picker

The approved layout is a master-detail browser.

### Project list

- Search by project name and description.
- Default ordering by most recently edited.
- Selected state remains visible while browsing details.
- Each row includes representative thumbnail, name, last-edited time, duration, and explicit loading/error state.

### Rich preview

- Project name and description.
- Creation and last-edited timestamps.
- Duration, frame rate, track count, clip count, and media count.
- Playback of the latest backend-known rendered output.
- Explicit missing or stale state when no current render exists; unrelated media is never substituted.
- Read-only mini timeline preserving track order, clip timing, gaps, and broad clip type.
- Expanders grouped by video, audio, titles/graphics, subtitles, and unsupported clip types.
- Video clip previews render inside each clip thumbnail.
- Audio clip previews render a real waveform and provide playback within the thumbnail.
- Unsupported or unavailable previews retain the clip row and show an actionable explanation.

### Accessibility and responsiveness

- Project list, expanders, preview controls, and primary action are keyboard-operable with visible focus.
- Status changes use a polite live region; failures use `role="alert"`.
- Loading longer than 300 ms shows real phase and progress data.
- Icon-only controls have accessible names and at least a 44-by-44 CSS-pixel target.
- Status never relies on color alone.
- The master-detail layout collapses to list-then-detail without horizontal page scrolling at narrow widths or 200% zoom.

## Backend API

Exact schemas belong in shared contracts under `packages/core`.

### Preview

`GET /api/projects/:projectId/resolve-preview`

Returns metadata, render status/source, mini-timeline primitives, typed clip groups, media preview endpoints, compatibility summary, and the persisted revision identifier used to build the preview.

Preview media is served through existing project media boundaries. The response does not expose arbitrary filesystem paths.

### Start export

`POST /api/projects/:projectId/exports/resolve`

The request includes the previewed revision identifier and export selection. The backend rejects stale revisions rather than exporting a silently changed project.

The response is `202 Accepted` with:

- job ID;
- source revision;
- initial phase;
- status endpoint;
- cancellation endpoint.

### Job status

`GET /api/projects/:projectId/exports/resolve/:jobId`

Returns a monotonic phase, processed/total counts, percentage, warnings, terminal result, and bridge launch URL when ready.

Phases are `queued`, `loading`, `assessing`, `resolving-media`, `serializing`, `verifying`, `ready`, `launching`, `importing`, `saving`, `validating`, `completed`, `failed`, or `cancelled`.

### Import evidence

`POST /api/projects/:projectId/exports/resolve/:jobId/import-result`

Accepts one idempotent result for the issued request ID:

- Resolve application version/build;
- destination project name;
- imported timeline name and duration;
- track and clip counts by type;
- offline-media count and identifiers;
- save result;
- sanitized warnings or stable failure code;
- artifact hashes used by the importer.

Repeated identical completion is accepted. A conflicting second result is rejected and logged.

## End-to-end flow

1. The user opens the Resolve picker in OpenReel.
2. The web app lists backend-managed projects and requests rich preview data for the selection.
3. The user selects **Open in Resolve**.
4. The orchestrator locks the selected persisted revision, validates media, generates FCPXML plus a manifest, verifies hashes and expectations, and records progress.
5. The web app remains open, displays real phases, and offers cancellation until launch begins.
6. When ready, OpenReel opens `openreel-resolve://import/<job-id>` with a short-lived request token. The URL contains no project data or filesystem paths.
7. Swift validates the request against the configured localhost orchestrator and acquires a per-user import lock.
8. Swift starts or focuses Resolve. If Accessibility permission is missing, macOS prompts once and the job remains retryable.
9. Swift navigates to Project Manager if necessary and creates one uniquely named provisional project: `OpenReel Import <request-id>`.
10. Swift invokes **Workspace > Scripts > OpenReel Bridge** inside that project.
11. Python retrieves the issued manifest/artifact from the backend, confirms the request ID and hashes, and imports into the current provisional project.
12. Python chooses a collision-free final name from the manifest, renames the same project, saves it, and validates the imported timeline.
13. Python posts import evidence to the backend. Swift reports completion to the user and focuses the new Resolve project.
14. OpenReel updates the job UI from backend state.

If import fails, the provisional project remains for diagnosis with its unique request ID. Existing projects are not changed and failures are not silently cleaned up.

## Safety and trust boundaries

- The orchestrator is authoritative for projects, revisions, media, exports, and audit evidence.
- The bridge accepts only loopback orchestrator origins configured at installation; launch URLs cannot redirect it to arbitrary hosts.
- Launch tokens are short-lived, single-use, scoped to one job, and never logged.
- Manifest paths are relative, normalized, and rejected on traversal or symlink escape.
- Artifact and media hashes are checked before import.
- Only one bridge import can run per user at a time.
- Resolve project names are collision-safe. No existing project is overwritten or deleted.
- Raw media, project documents, prompts, tokens, and arbitrary paths are excluded from diagnostic logs.

## Failure handling

Every terminal failure has a stable code, safe message, diagnostic detail, and recovery action. Required cases include:

- stale OpenReel revision;
- missing or unsupported media;
- backend export failure;
- render preview unavailable;
- bridge not installed;
- Accessibility denied;
- Resolve not installed or failed to launch;
- unexpected Resolve UI state or menu not discovered;
- internal script not installed or not discovered;
- request expired or already consumed;
- artifact hash mismatch;
- FCPXML rejected;
- destination name collision exhaustion;
- Resolve save failure;
- offline imported media;
- bridge/backend timeout or lost callback.

Retries reuse safe completed stages. Retrying launch/import does not regenerate a valid backend artifact unless its source revision or artifact verification changed.

## Verification

### Deterministic tests

- Core schemas, state transitions, redaction, compatibility report, request/result idempotency, and artifact hashing.
- Orchestrator preview/export/result routes with fake project/media stores and temporary artifact storage.
- Web picker loading, search, selection, metadata, playback states, clip expanders, keyboard operation, progress, cancellation, launch, and recovery.
- Swift manifest/request validation and Accessibility state machine against a fake AX driver.
- Python adapter against a fake Resolve API, including rename collision, import rejection, save failure, offline media, and idempotent result submission.
- Contract fixture shared by TypeScript, Swift, and Python to prevent protocol drift.

### Live acceptance

On DaVinci Resolve 21.0.3 build 21.0.30007:

1. Start at Project Manager with no project open.
2. Select Vintage Tokyo from OpenReel's rich picker.
3. Confirm rendered preview, clip groups, video/audio thumbnails, mini timeline, and metadata.
4. Select **Open in Resolve** and observe backend progress.
5. Confirm Resolve launches, creates one new project, invokes the importer, and leaves the new project open.
6. Verify timeline name, duration, track order/count, clip count, and zero offline media.
7. Confirm the backend records the exact source revision, artifact hashes, Resolve build, and import evidence.
8. Repeat the job to prove collision-safe naming and no mutation of the first Resolve project.

Compatibility documentation is updated only after this live matrix passes.
