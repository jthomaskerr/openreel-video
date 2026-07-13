# Image Preview and Video Thumbnail Regression

**Canonical functional specs:** [Media Assets](../media-assets.md) and [Timeline](../timeline.md).

**Status:** Implemented and verified.

## Outcome

Pressing Play keeps image clips visible in the render preview, including images
whose media is represented by a backend/original URL rather than an in-memory
`Blob`. Newly generated video thumbnails also remain visible in the media browser
and timeline during the browser session that created them.

## Diagnosis

Two source-lifetime assumptions caused the visible regressions:

1. `Preview` only built playback `ImageBitmap`s from `MediaItem.blob`. Generated
   and backend-backed images can instead carry `remoteUrl`, `originalUrl`, or a
   durable `thumbnailUrl`. The paused preview could use URL-backed media in some
   paths, but playback's image caches stayed empty, so pressing Play produced a
   blank frame for those clips.
2. `ClipComponent` treated every `blob:` thumbnail as stale. MediaBunny creates
   valid current-session filmstrip and thumbnail object URLs, so the timeline
   discarded the normal output of the thumbnail generator. Commit `d705251`
   introduced this filtering while fixing stale URLs restored after reload.

The correct boundary is persistence, not rendering. Page-scoped object URLs are
valid while the page that created them is alive. `sanitizeForAutoSave()` and the
backend serializer already remove them before project data is persisted, and
backend/recovery loading regenerates thumbnails from restored media.

## Implementation

- `preview/media-image-source.ts` defines the image playback source contract:
  use an in-memory Blob first, otherwise fetch `remoteUrl`, `originalUrl`, then
  `thumbnailUrl`, and decode the resulting Blob with `createImageBitmap`.
- All three image playback/decode cache paths in `Preview.tsx` use that contract.
- `ClipComponent.tsx` renders live `blob:` filmstrip and fallback thumbnail URLs.
- Persistence sanitization remains unchanged and continues to remove `blob:`
  thumbnail and filmstrip URLs before autosave.

## Acceptance criteria

1. A Blob-backed image remains visible before and during playback.
2. A backend/original-URL-backed image is fetched, decoded, cached, and remains
   visible during playback.
3. When only a durable image thumbnail is available, playback uses it instead of
   rendering a blank image layer.
4. A newly generated/imported video with current-session `blob:` filmstrip URLs
   displays those tiles in its timeline clip.
5. A current-session `blob:` single thumbnail displays when no filmstrip exists.
6. The media browser continues to render the media item's thumbnail URL directly.
7. Autosave and backend persistence never retain page-scoped `blob:` thumbnail
   or filmstrip URLs, so stale URLs are not restored after reload.
8. A missing or failed remote image source fails without crashing playback; the
   existing warning/log path identifies the affected clip.

## Regression tests

- `preview/media-image-source.test.ts`
  - decodes an imported image Blob without a network request;
  - fetches and decodes a backend-backed image;
  - falls back to a durable thumbnail;
  - rejects an image with no usable source.
- `timeline/ClipComponent.test.tsx`
  - renders a current-session `blob:` single thumbnail;
  - renders current-session `blob:` filmstrip frames.
- `services/auto-save.test.ts`
  - retains the persistence boundary tests that strip `blob:` thumbnails and
    filmstrips.

## Failure modes

- A remote response that is unavailable, non-2xx, blocked by authentication, or
  not decodable cannot produce an image frame. The decoder throws, and Preview's
  existing callers catch the failure and leave that clip without a frame while
  logging the cache/decode failure.
- A live object URL can still be revoked early by its owner. This change does not
  make revoked URLs valid; it stops rejecting valid URLs solely by scheme.
- Cross-origin image URLs must permit fetch access. Same-origin backend URLs and
  CORS-enabled generated assets are supported.

## Verification

Run:

```sh
pnpm --filter @openreel/web exec vitest run \
  src/components/editor/preview/media-image-source.test.ts \
  src/components/editor/timeline/ClipComponent.test.tsx \
  src/services/auto-save.test.ts
pnpm --filter @openreel/web typecheck
```

Browser sign-off was completed in headless Chrome against the running app at
`http://[::1]:5173/#/editor` with a 1440×1000 viewport. A deterministic PNG and
MP4 were imported and placed on separate image/video tracks. The image preview's
center pixel remained `[254, 254, 0, 255]` before and during playback, proving the
frame did not disappear when Play was pressed. The video media card loaded a
160px-wide thumbnail, and the timeline video clip rendered thumbnail background
images. Screenshot evidence is stored outside the repository at
`/tmp/openreel-video-preview-regression-after.png`.

The headless environment reported expected capability fallbacks: WebGPU had no
adapter and WebGL2 was unavailable, so the renderer used Canvas2D. No media
decode, image cache, thumbnail, React, or Vite errors occurred during the target
interaction.
