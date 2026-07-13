# Backend Outage Must Not Mark Media Missing

**Canonical functional specs:** [Media Assets](../media-assets.md), [Project Lifecycle and Persistence](../project.md), and [Problems, Errors & Logging](../problems-errors-logging.md).

**Status:** Open design and implementation regression.

## Outcome

A temporary backend outage, restart, HMR failure, timeout, CORS failure, or client
network interruption must not cause persisted media or its timeline clips to be
reported as missing. “Missing” is a confirmed durable-storage fact, not the absence
of a currently loaded browser `Blob`.

When availability is uncertain, the editor preserves the project and media metadata,
shows a recoverable unavailable/verifying state, retries safely, and confirms media
existence with the backend before offering relink or persisting a missing verdict.

## Existing failure

`getMediaStatus()` currently returns `OK` only when `item.blob` is truthy. An item
with a durable `remoteUrl` but no in-memory blob is classified `MISSING`. During a
backend outage, media hydration can fail or be bypassed while project/autosave data
still contains valid backend identity. Every consumer of `MediaStatus.MISSING` then
shows missing cards, missing timeline badges, preview placeholders, relink actions,
and missing counts even though the backend media may still exist.

This conflates three independent facts:

- whether durable media is recorded as existing;
- whether the backend is currently reachable;
- whether the browser currently has decoded/in-memory media.

## Required state model

Availability must be explicit and runtime-owned. Recommended states:

| State | Meaning | User treatment |
| --- | --- | --- |
| `available` | A usable blob exists or backend existence was confirmed. | Normal media. |
| `verifying` | Existence check is in flight or awaiting retry. | Keep clip visible; show non-destructive checking state. |
| `temporarily_unavailable` | Verification could not complete due to transport/server/browser failure. | Keep clip and metadata; offer Retry, never Relink as the primary action. |
| `confirmed_missing` | An authoritative backend response confirms no media mapping/object, or local-only media cannot be found after local recovery checks. | Show missing/relink workflow. |
| `decode_error` | Bytes exist but browser cannot decode them. | Show unsupported/corrupt diagnostic; do not call it missing. |
| `unauthorized` | Verification returned authentication/authorization failure. | Re-authenticate; do not call it missing. |

Do not persist transient states into semantic project JSON. Persist durable media
identity and provenance; derive runtime availability per session.

## Robust verification design

1. On project load, retain each media item and its `remoteUrl`/backend media mapping
   even if downloading or thumbnail generation fails.
2. Set backend-backed unresolved items to `verifying`, not `missing`.
3. Verify existence with a bounded-concurrency `HEAD` request or a dedicated batch
   endpoint such as `POST /api/projects/:id/media/verify` with media IDs.
4. Treat only authoritative `404`/`410` results for both mapping and object as
   `confirmed_missing`. A project-manifest omission should be rechecked once against
   the media endpoint to avoid stale-manifest races.
5. Treat timeout, connection refusal, DNS, `5xx`, aborted navigation, CORS, HMR
   restart, and offline state as `temporarily_unavailable` with exponential backoff
   and jitter.
6. On backend recovery, retry verification automatically, then hydrate media and
   thumbnails without requiring project reload.
7. Provide a user-triggered **Verify media**/**Retry connection** action for one item
   and all unresolved items.
8. Update the store atomically after verification so Media pane, timeline, preview,
   inspector, missing-only count, and Problems panel cannot disagree.
9. Never autosave a transient failure as missing, clear media identity, remove a
   clip, or trigger relink automatically.

## Recovery path

For an item currently displayed as missing:

1. If it has backend identity (`remoteUrl`, media mapping, or project/media IDs),
   transition to `verifying` and ask the backend to verify it.
2. If verified, restore `available`, download lazily or eagerly according to playback
   needs, regenerate the thumbnail, and clear all missing indicators atomically.
3. If the backend is unavailable, transition to `temporarily_unavailable`, retain
   retries, and keep Retry available.
4. If the backend confirms absence, check IndexedDB, retained file handles, relink
   folders, and generated-asset provenance before `confirmed_missing`.
5. If local recovery succeeds, upload/reassociate according to persistence policy,
   then mark `available`.
6. Only after every applicable durable/local source is exhausted should the UI offer
   relink as the primary recovery action.

## Corner cases

- Backend restarts between project GET and media verification.
- Project manifest is newer than media upload, or media upload is newer than Git JSON.
- `HEAD` is unsupported although `GET` works; retry with a small ranged GET or batch API.
- Authentication expiry produces `401`/`403`, not missing.
- Reverse proxy returns an HTML error body with status `200`; validate MIME type and
  content range before declaring media available.
- CDN/proxy cache returns stale `404` or stale `200`; include version/ETag where available.
- Media mapping exists but object storage file is absent.
- Object exists but is zero bytes, truncated, corrupt, or unsupported by the browser.
- CORS blocks media-element access while `fetch` succeeds.
- Browser is offline, suspended, background-throttled, or aborts requests during HMR.
- User switches projects while verification is in flight; stale results must not
  mutate the newly active project.
- Multiple clips reference one media item; verify once and update every consumer.
- Duplicate media IDs or filenames across projects must never cross-associate.
- Local-only, unsaved, generated, proxy, scene-derived, subtitle, audio, and image
  items have different valid recovery sources.
- Object URLs from a prior page session are stale; current-session object URLs may be
  valid but are not durable evidence.
- A thumbnail can fail while source media remains available; thumbnail failure is not
  missing media.
- Playback decode can fail after successful existence verification; classify as
  `decode_error`.
- Backend recovers after manual relink starts; resolve races deterministically and do
  not overwrite newer user-selected media.
- Autosave conflict dialog chooses local data while backend media remains canonical.
- Verification retries must be bounded and cancellable, with no request storm for a
  large library.

## Deterministic regression tests

1. `getMediaStatus` or its replacement classifies backend-identified/no-blob media as
   `verifying` or `temporarily_unavailable`, never `missing`.
2. Connection refusal, timeout, aborted request, CORS-like rejection, and every `5xx`
   response preserve media identity and do not increment confirmed-missing counts.
3. `401`/`403` produce `unauthorized`; decode/canvas failure produces `decode_error`.
4. Only authoritative confirmed absence produces `confirmed_missing`.
5. A later successful verification transitions all surfaces back to available without
   reload.
6. Autosave serialization excludes transient runtime availability state and preserves
   backend identity.
7. Concurrent verification is deduplicated per project/media ID, bounded, cancellable,
   and ignores stale-project results.
8. One media item referenced by multiple clips causes one verification request and a
   consistent atomic UI update.
9. Thumbnail-generation failure with playable bytes never marks the item missing.
10. Backend outage during HMR followed by recovery restores status and thumbnails.

No LLM eval is required. This is deterministic transport and state-machine behavior.

## Function-spec amendments

- `backend-persistence-versioning.md`: define verification API semantics, authoritative
  absence, retry behavior, and the rule that transient failures cannot alter semantic
  media completeness.
- `asset-management-ux.md`: distinguish verifying, unavailable, unauthorized, decode
  error, and confirmed-missing visuals/actions/counts.
- `media-import-timeline.md`: require timeline and preview to preserve clips during
  transient source outages and recover atomically.
- `problems-errors-logging.md`: add structured problem codes and Retry/Verify actions
  for each availability state.
