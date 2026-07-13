# Project-save regression: referenced media missing from backend storage

## Status and scope

**Status:** Specification only. Do not treat this document as evidence that the
behavior is implemented.

This regression covers a project whose `project.json` references media items but
whose backend `media/` directory lacks one or more corresponding original files.
It specifies save-time detection, bounded frontend repair, user-facing remediation,
and persistent error markers. It complements
`docs/spec/backend-persistence-versioning.md` and does not replace the asynchronous
project-creation regression in `project-save-regression.md`.

## Observed failure

The `vintage-tokyo` backend exposed the concrete inconsistent state:

- `project.json` referenced 13 image items and 10 video items.
- The media directory contained all 10 video binaries but none of the 13 image
  originals.
- Embedded JPEG thumbnails survived, so thumbnail presence falsely suggested that
  each image asset was fully persisted.
- The backend accepted later project saves and Git commits without reporting that
  the image originals were absent.

This permits an incomplete project to look successfully persisted. A user can only
discover the loss later when preview, playback, export, replacement, or another
operation needs the original bytes. Existing save receipts prove that project JSON
was committed; they do not currently prove referential integrity between the JSON
and stored media.

The user-provided browser evidence from 2026-07-13 shows that a partial repair UI
already exists: media cards can display `Missing` badges, the media panel has `Show
Only Missing Assets` and `Relink from Folder…` controls, and affected timeline clips
can display `LINK FILE`. The implementation SHOULD reuse and normalize those
surfaces. That screenshot does not prove the save-time backend audit, structured
409 contract, automatic upload/retry, durable GET audit, or receipt-gated marker
clearing specified here.

## Root cause and invariant

The upload and project-PUT stages are ordered but not transactional. The frontend
attempts uploads before PUT, while the backend independently accepts project JSON
without verifying that every required `MediaItem.id` resolves to a stored file.
Neither side closes the gap caused by absent local Blobs, failed/forgotten uploads,
legacy projects, restored thumbnails, or stale upload-deduplication state.

Required invariant:

> A successful project persistence receipt means the committed project snapshot is
> media-complete: every file-backed media item in that snapshot has an original
> binary stored under the same project and media ID.

Thumbnails, `sourceFile` hints, `remoteUrl`, object URLs, and file handles do not
satisfy this invariant.

## Backend contract

Before replacing `project.json` or starting a Git commit, the PUT handler SHALL:

1. Validate the incoming project and media IDs.
2. Scan the project's media directory into its authoritative media-ID map.
3. Compare the scan against every file-backed media item in the incoming project.
4. Continue the atomic write and awaited commit only when the missing set is empty.

When the set is non-empty, return HTTP `409` with `code: "MEDIA_INCOMPLETE"` and
the complete ordered `missingItems` array defined by the operational spec. The
handler SHALL NOT write a temporary/final project file, invoke Git commit, return a
persistence receipt, or delete the existing valid snapshot.

`GET /api/projects/:id` SHALL perform the same non-mutating comparison and include
`missingItems` in its response so legacy damage is visible on load. Missing items do
not prevent loading because the editor is the repair surface.

## Frontend recovery and failure behavior

On the first `MEDIA_INCOMPLETE` response, the save service SHALL reconcile the
backend list against the current live project, not the stale snapshot originally
queued for persistence.

For each missing ID:

- A valid in-memory Blob is uploaded.
- A readable file handle is resolved to a Blob, then uploaded.
- A supported durable original source may be fetched and uploaded only when it is
  known to represent the original asset. A thumbnail URL MUST NOT be promoted to
  the original binary.
- An item with no recoverable original is recorded as unresolved.

If all missing items upload, retry the PUT exactly once with the latest compatible
project snapshot. Concurrent edits that materially change the media library SHALL
schedule a new serialized save rather than being overwritten by the retry. If any
item is unresolved, an upload fails, or the retry returns another incomplete set,
the operation fails visibly and retains local state. The upload-deduplication set
must remove failed/missing IDs so a user-triggered retry can send them later.

No path may recurse indefinitely, mark persistence successful from an upload alone,
or silently omit the missing `MediaItem` from project JSON.

## User-visible errors and repair instructions

The failure presentation has three coordinated levels:

1. **Header/toast:** persistence changes to failed. A summary says, for example,
   `Project not fully saved: 3 original media files are missing.` The toast links
   to the Problems surface and uses the configured finite duration.
2. **Problems/Log:** one structured project-save problem lists every missing item,
   media ID, type, automatic retry outcome, and next action. Logs omit data URLs,
   binary data, and absolute paths.
3. **Affected items:** each media-browser card/row and every timeline clip using a
   missing media ID shows a persistent red error marker. The marker is keyboard
   reachable, has a non-color accessible label, and is not hidden by selection,
   generated-status badges, compact timeline mode, grouping, or list/grid view.

Selecting a marker or affected item SHALL explain:

`The original file for “<name>” is missing from the saved project. Your local edits
are still available, but this project is not fully persisted. Relink or locate the
original file, then save again. If the original no longer exists, remove the item
and dependent clips, or download/regenerate it before relinking.`

Available actions are `Relink original file`, `Locate containing folder` when
supported, and `Remove missing item…` with explicit destructive confirmation and a
preview of dependent clips/references. A mismatch against available `sourceFile`
hints requires confirmation; it must not silently attach the wrong file.

Markers remain after reload because the GET audit recreates them. They clear only
after a backend-confirmed complete save or explicit removal of the item and all
references. Dismissing a toast does not clear item state.

## Acceptance criteria

- PUT detects every referenced file-backed media ID absent from backend storage.
- An incomplete PUT returns deterministic `409 MEDIA_INCOMPLETE` details and causes
  no project-file write, Git commit, success receipt, or successful persistence UI.
- GET reports legacy missing items without preventing project load.
- The frontend automatically uploads recoverable original files and retries PUT no
  more than once.
- The retry uses current compatible state and cannot overwrite concurrent edits.
- Unrecoverable items produce explicit instructions and preserve local project data.
- Failed IDs are retryable; upload deduplication cannot suppress the repair.
- Media cards/rows and every dependent timeline clip show accessible persistent
  error markers across supported layouts.
- A thumbnail alone never satisfies or repairs original-media completeness.
- Error markers survive reload and clear only on backend-confirmed repair or
  confirmed removal.
- Persistence logs and problems identify affected IDs without exposing binaries,
  data URLs, secrets, or absolute local paths.

## Required deterministic regression tests

### Orchestrator

- PUT with one missing media ID returns 409 containing that item and never calls
  `saveProject()` or `gitStore.commit()`.
- PUT with several missing IDs returns all of them in media-library order.
- PUT with a complete media map writes once, commits once, and returns the normal
  receipt.
- Existing committed JSON is unchanged after an incomplete PUT.
- GET returns `missingItems` for a legacy incomplete fixture and `[]` for a complete
  fixture.
- Thumbnail-bearing items with no original binary are still reported missing.

### Web save service/store

- A 409 whose missing item has a Blob uploads it, awaits completion, retries PUT
  once, and marks persistence successful only from the retry receipt.
- A readable file handle follows the same path.
- An unresolved item performs no retry PUT, preserves project state, marks failed,
  and emits the exact remediation problem.
- A failed upload removes the media ID from upload deduplication and permits a later
  manual retry.
- A second 409 stops after one retry and reports the remaining set.
- Concurrent media edits during reconciliation are not replaced by the queued
  snapshot.

### UI

- Media grid, media list, grouped media, and timeline clip fixtures render an
  accessible missing-original marker for audited IDs only.
- One media item referenced by multiple clips marks every dependent clip.
- Relink success uploads and saves, then clears markers only after the receipt.
- Relink mismatch asks for confirmation; cancel leaves the marker intact.
- Confirmed removal deletes the item and dependent references before the next save.
- Toast dismissal leaves persistent item/clip markers and the Problems entry intact.

Gate tests SHALL use temporary project/media directories and fake upload responses.
They must be local, deterministic, non-flaky, and must not require real media
decoding, paid services, or a running production backend.

## Browser verification required for implementation sign-off

Use a fixture project with two visible assets: one complete and one referenced but
missing from backend media storage.

1. Load the project and confirm GET audit markers on the missing media card and all
   dependent clips, while the complete asset is unmarked.
2. Trigger save with a recoverable local Blob; confirm upload, one retry, successful
   persistence, and marker removal.
3. Repeat without a recoverable original; confirm failed header state, finite toast,
   persistent marker, Problems details, and relink instructions.
4. Relink the correct file and save; reload and confirm the marker remains absent.
5. Exercise a wrong-file selection and confirmed removal, including the dependent
   clip/reference preview.
6. Verify grid/list, compact timeline, keyboard access, reduced motion, and relevant
   console/network health.

Capture the initial missing state, unrecoverable guidance, and repaired state as
screenshot evidence. Typechecking or unit tests alone do not complete this UI
regression.

## Important failure modes

- A scan/upload race could report a false absence or commit before an upload rename;
  uploads must complete atomically before the authoritative audit.
- Treating all media-library entries as file-backed without a future explicit
  external/virtual type could reject legitimate metadata-only assets. Do not add
  filename or thumbnail heuristics; introduce a typed storage contract instead.
- Retrying an old snapshot can erase concurrent edits. Reconciliation must re-read
  live state and remain serialized with the normal save queue.
- Removing an item without enumerating every dependent clip/reference creates a
  different dangling-reference bug.
- Persisting the error only in React component state loses it on reload; GET audit
  is the durable source of truth.
