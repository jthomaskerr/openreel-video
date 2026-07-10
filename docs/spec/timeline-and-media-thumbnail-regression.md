# Timeline and Media Thumbnail Regression

**Status:** Investigated; product code unchanged.

**Scope:** Timeline video thumbnails and filmstrips after media import, replacement,
version creation, autosave, and recovery.

## Diagnosis

The current timeline intentionally excludes every `blob:` thumbnail URL. That
protects a reloaded project from rendering page-scoped object URLs that no longer
exist, but it also excludes valid object URLs created during the current browser
session. A newly imported video can therefore have `thumbnailUrl` and
`filmstripThumbnails` in the project store while showing no thumbnail in its
timeline clip.

The regression was introduced by commit `d705251` (`fix(timeline): stop rendering
stale blob: URLs in video thumbnails`). The commit added the stale-URL guards and
tests for rejected `blob:` URLs, but no test for a live, current-session `blob:`
URL.

### Current behavior

- `MediaBunnyEngine.generateThumbnails()` converts each extracted
  `OffscreenCanvas` to a `Blob` and stores `URL.createObjectURL(blob)` as
  `ThumbnailResult.dataUrl` (`packages/core/src/media/mediabunny-engine.ts:489-559`).
- `project-store` copies that value into `MediaItem.thumbnailUrl` and each
  `filmstripThumbnails[].url` for import, replacement, and version creation
  (`apps/web/src/stores/project-store.ts:1935-2041`, `2167-2258`, and
  `2549-2646`). These values are normally `blob:` URLs on the importing page.
- `ClipComponent` filters all `blob:` filmstrip entries before rendering and
  renders no filmstrip when all entries are filtered
  (`apps/web/src/components/editor/timeline/ClipComponent.tsx:741-765`).
- Its single-thumbnail fallback also requires a non-`blob:` URL
  (`ClipComponent.tsx:767-776`). Because `getEffectiveThumbnailUrl()` returns
  the media item's own thumbnail first, a valid current-session object URL is
  still rejected by this guard (`packages/core/src/media/thumbnail-utils.ts:39-68`).
- The clip itself, label, selection, status badges, and the placeholder waveform
  text still render. The missing visual layer is therefore a thumbnail/filmstrip
  failure, not a clip-placement failure.
- Autosave deliberately removes `blob:` URLs before persistence and recovery
  (`apps/web/src/services/auto-save.ts:1-27`). This is correct for persistence,
  but it does not make a live in-memory object URL invalid before the page is
  reloaded. A recovery path must regenerate a thumbnail or use a durable fallback
  after sanitization.

### Likely root cause

The rendering boundary conflates two different cases:

1. a valid object URL created by this page and still backed by a live browser
   object URL; and
2. a stale object URL deserialized from a previous page session.

The persistence boundary already has the right invariant: `blob:` URLs must not
be written to autosave/backend project data. The timeline boundary applies that
invariant too broadly and consequently hides valid thumbnails before persistence
has occurred.

## Affected files and symbols

| File | Symbol/region | Relevance |
| --- | --- | --- |
| `apps/web/src/components/editor/timeline/ClipComponent.tsx` | `ClipComponent`, thumbnail background layer | Filters `blob:` URLs from filmstrip and fallback rendering. Primary regression site. |
| `packages/core/src/media/mediabunny-engine.ts` | `MediaBunnyEngine.generateThumbnails` | Produces object URLs from extracted frame blobs. Primary producer of valid session thumbnails. |
| `apps/web/src/stores/project-store.ts` | media import, `replaceMediaAsset`, asset-version creation | Copies generated URLs into `MediaItem.thumbnailUrl` and `filmstripThumbnails`. |
| `packages/core/src/media/thumbnail-utils.ts` | `getEffectiveThumbnailUrl` | Correctly prioritizes an item's thumbnail and supplies missing-file reference fallbacks; not the primary defect. |
| `apps/web/src/services/auto-save.ts` | thumbnail sanitization | Correctly strips page-scoped URLs from persisted project data. Must remain separate from live rendering policy. |
| `apps/web/src/components/editor/timeline/ClipComponent.test.tsx` | blob URL rejection tests | Covers stale-looking URLs only; currently encodes the regression without a live-URL case. |
| `packages/core/src/media/thumbnail-utils.test.ts` | `getEffectiveThumbnailUrl` tests | Covers fallback ordering and passes; useful non-regression evidence. |

## User-visible impact

After importing, replacing, or creating a video asset, the timeline clip can be
blank where its filmstrip or thumbnail should appear. The user can still see and
select the clip, but loses visual orientation while editing, especially when
scrubbing or trimming. The same symptom may occur for any media path whose
thumbnail producer returns an object URL rather than a data URL.

The existing stale-URL problem after reload is real and must remain fixed. A fix
must not restore persisted `blob:` URLs as durable project data.

## Reproduction

### Deterministic code reproduction

1. Create a video `MediaItem` with `thumbnailUrl: "blob:..."` and/or
   `filmstripThumbnails` whose entries use `blob:` URLs.
2. Attach it to a video `Clip` and render `ClipComponent`.
3. Observe that the clip markup contains no thumbnail background using those URLs.
4. Repeat with a `data:` or HTTPS URL and observe that the thumbnail background is
   rendered.

The existing test fixtures demonstrate steps 1-3 in
`apps/web/src/components/editor/timeline/ClipComponent.test.tsx:146-213`.
Those tests model the URL shape but do not distinguish a live URL from a stale
one.

### Manual browser reproduction (not executed in this investigation)

1. Start the web app with `pnpm dev`.
2. Open the editor and import a decodable video file.
3. Place or observe the imported clip on the video timeline.
4. Inspect the media item in devtools and confirm that thumbnail values are
   `blob:` URLs while the timeline clip has no filmstrip background.
5. Compare with an asset whose thumbnail is a data URL or remote URL.

Browser execution was unavailable in this environment: no Browser plugin was
listed and `pnpm exec playwright --version` failed because Playwright is not
installed. The manual steps remain required for UI sign-off.

## Acceptance criteria

1. A newly imported, replaced, or versioned video with a valid current-session
   object URL displays a filmstrip in its timeline clip.
2. If no usable filmstrip exists, a valid current-session single thumbnail is
   displayed as the repeated fallback.
3. A project loaded after reload never attempts to render an object URL that was
   persisted from an earlier page session.
4. Autosave/backend serialization continues to remove `blob:` thumbnail URLs and
   `blob:` filmstrip entries.
5. After recovery, the app either regenerates thumbnails from the restored media
   blob or renders the documented durable/reference fallback; it must not leave a
   recoverable video permanently without a visual thumbnail solely because its
   prior object URL was sanitized.
6. Existing missing-file fallback ordering remains intact:
   `referenceAssetIds` → `referenceImageUrl` → `referenceImageUrls` (with the
   final documented placeholder behavior where implemented).
7. The clip label, selection, drag/trim behavior, status badges, and audio/video
   classification remain unchanged.

## Required regression tests

Add deterministic tests before changing the rendering policy:

- `ClipComponent.test.tsx`: a video with a current-session `blob:` thumbnail URL
  renders the fallback background.
- `ClipComponent.test.tsx`: a video with current-session `blob:` filmstrip URLs
  renders filmstrip tile backgrounds and chooses frames by timestamp.
- `ClipComponent.test.tsx`: a stale/reloaded media representation does not render
  an object URL when the recovery contract marks it unavailable. Prefer a fixture
  that models the recovery state rather than treating every `blob:` prefix as
  stale.
- `auto-save.test.ts`: retain the existing assertions that serialized
  `thumbnailUrl` and `filmstripThumbnails` do not contain `blob:` URLs.
- `thumbnail-utils.test.ts`: retain the current fallback-priority coverage.
- Recovery test: after persisted thumbnail sanitization, restoring a media blob
  regenerates a usable thumbnail or selects a durable fallback.

The two new rendering tests should use a deterministic `URL.createObjectURL`
fixture or an explicit in-memory URL registry so they prove the live-session
contract without relying on a real browser decoder.

## Verification evidence

Evidence collected against the current working tree:

- `git show d705251` identifies the exact change that introduced the
  `blob:`-rejection guards and the two corresponding tests.
- `packages/core/src/media/mediabunny-engine.ts:542-549` shows the producer
  creates object URLs from extracted thumbnail blobs.
- `apps/web/src/stores/project-store.ts:1951-1982` shows those URLs are copied
  into the media item during import; equivalent paths exist for replacement and
  version creation.
- `apps/web/src/components/editor/timeline/ClipComponent.tsx:743-775` shows
  the timeline removes all object URLs from both filmstrip and fallback paths.
- `pnpm --filter @openreel/web exec vitest run src/components/editor/timeline/ClipComponent.test.tsx`
  passed: 8 tests. This confirms the current stale-URL guard and existing
  fallback assertions, but does not prove the desired live-object-URL behavior.
- `pnpm --filter @openreel/core exec vitest run src/media/thumbnail-utils.test.ts`
  passed: 22 tests. Fallback resolution is not the failing layer.
- `pnpm --filter @openreel/web exec vitest run src/services/auto-save.test.ts src/components/editor/timeline/ClipComponent.test.tsx src/components/editor/Preview.missing-video.test.tsx`
  passed: 21 tests. Persistence sanitization and preview fallback tests remain
  green.
- Browser verification was not completed because Browser tooling and Playwright
  were unavailable. No product code was modified during this investigation.

## Recommended implementation boundary

Keep object-URL sanitization at autosave/backend serialization and recovery, but
do not use the URL scheme alone to decide whether a currently mounted timeline
may render a thumbnail. The eventual implementation should establish an
explicit distinction between live in-memory thumbnail state and recovered
persisted state, then verify both import and reload flows in a real browser.
