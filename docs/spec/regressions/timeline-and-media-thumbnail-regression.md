# Timeline and Media Thumbnail Regression

**Status:** Open. The hydration path succeeds in headless Chrome but the reported
failure persists in Orion; browser-specific diagnostics are required.

**Required outcome:** Videos loaded from backend persistence display a regenerated
thumbnail in the Media pane and a repeated thumbnail in each timeline clip across
supported browsers, including Orion. Current-session object URLs remain renderable,
but page-scoped object URLs are never persisted.

## Reported symptom

Video assets, and potentially scene-derived video assets, displayed placeholders in
the Media pane and blank timeline clips. Images continued to display thumbnails.

## Root cause and fix

Video frame extraction originally produced `blob:` object URLs. Persistence correctly
removed those page-scoped URLs, leaving persisted video items with
`thumbnailUrl: null`. On reload, both renderers therefore received no thumbnail.

Commit `da923b3` (`fix(web): restore image playback and live thumbnails`) fixed the
shared backend-load boundary:

1. `BackendSaveService.load()` downloads each persisted media binary.
2. If an image or video thumbnail is missing or stale, it calls
   `generateThumbnailFromBlob()`; if the download fails, it attempts
   `generateThumbnailFromUrl()`.
3. Video capture seeks to a decodable frame and returns a JPEG data URL.
4. The hydrated item, including `blob`, `remoteUrl`, and regenerated
   `thumbnailUrl`, is passed to the project store.
5. `MediaThumbnail` renders that URL in the Media pane.
6. `ClipComponent` renders it as the repeated video fallback when no filmstrip is
   available.

The timeline also accepts live current-session `blob:` thumbnails and filmstrip
frames. Stale object URLs are controlled at persistence and recovery boundaries,
not by rejecting every `blob:` URL in the renderer.

## Reproduction fixture

Project: `vintage-tokyo`.

The backend response contains video media binaries but intentionally persists
`thumbnailUrl: null` for video items. Before the fix, loading that response left
both surfaces without thumbnails. After the fix, opening the project through the
project manager regenerates thumbnails before `load()` resolves.

## Acceptance criteria

1. A persisted video with a media binary and `thumbnailUrl: null` is hydrated with
   a non-empty regenerated thumbnail.
2. The Media pane renders the hydrated video thumbnail in large, small, and list
   views.
3. A timeline video clip without filmstrip frames renders the hydrated thumbnail
   as its fallback background.
4. A current-session video with live `blob:` thumbnail or filmstrip URLs renders
   those URLs before persistence.
5. Serialization removes `blob:` thumbnail and filmstrip URLs.
6. Missing or undecodable media does not reject project loading; it logs the
   failure and leaves the item available with its normal placeholder.
7. Image, audio, subtitle, generated-asset, and scene-derived media behavior does
   not regress.

## Deterministic regression coverage

- `apps/web/src/services/backend-save.test.ts` verifies backend load downloads media,
  populates `blob` and `remoteUrl`, regenerates missing/stale thumbnails, and clears
  stale thumbnails when no binary exists.
- `apps/web/src/components/editor/timeline/ClipComponent.test.tsx` verifies a video
  data thumbnail, a live object-URL fallback, and live object-URL filmstrip frames
  render in timeline markup.
- `apps/web/src/services/auto-save.test.ts` verifies page-scoped thumbnail URLs are
  removed before persistence.
- `packages/core/src/media/thumbnail-utils.test.ts` verifies effective-thumbnail
  fallback ordering.

No probabilistic eval is required. Thumbnail hydration and rendering are deterministic
browser/media operations rather than LLM behavior.

## Browser verification

Environment:

- web app: `http://localhost:5173`
- backend: `http://localhost:4041`
- project: `vintage-tokyo`
- browser: headless Chrome via CDP

Observed after opening `Vintage Tokyo` from the Projects dialog:

- 12 visible video cards had `data:image/jpeg` sources;
- every inspected video image completed with `naturalWidth: 320`;
- 11 timeline elements had `data:image/jpeg` background images;
- no video card used a broken image source.

This verifies the implementation in Chrome only. It does not close the regression:
the same project still fails in Orion. Compare Orion's `[ThumbnailRecovery]` and
`[BackendSave]` diagnostics with the Chrome sequence to identify whether the failure
occurs during download, metadata/decode, seek, canvas capture, or rendering.

## Important failure modes

- Regeneration is asynchronous and video capture has a five-second timeout. The UI
  must not be judged before project loading completes.
- A recovery dialog can prevent the `projectId` query target from opening. Browser
  verification must resolve that dialog and confirm the project title before
  inspecting thumbnails.
- A missing backend media-file mapping cannot be regenerated. The placeholder is
  correct in that case and the item should be reported as missing media.
- An unsupported/corrupt codec can make frame capture return `null`; project loading
  must still complete and surface the placeholder plus a diagnostic.
- Persisting generated data URLs would substantially inflate project JSON. Continue
  regenerating video thumbnails from persisted media rather than adding them to the
  semantic save payload.

## Function-spec amendments

The implementation is fixed, but these function specs should be amended so the
contract is explicit:

1. `docs/spec/thumbnails-fallbacks.md`
   - Distinguish live renderable object URLs from stale persisted object URLs.
   - Require backend and autosave recovery to regenerate missing video thumbnails
     from available media before exposing the hydrated project.
   - Define placeholder behavior for missing, corrupt, timed-out, or unsupported
     media.
   - State that scene-derived video assets use the same hydration contract.
2. `docs/spec/backend-persistence-versioning.md`
   - State that semantic project persistence strips page-scoped thumbnail URLs.
   - Require `BackendSaveService.load()` to attach `remoteUrl`/`blob` and regenerate
     missing thumbnails without making thumbnail failure fatal to project load.
   - Document that regenerated thumbnails are runtime hydration, not a semantic
     project change requiring an immediate save.
3. `docs/spec/media-import-timeline.md`
   - Require imported videos to render live thumbnails immediately and reloaded
     videos to render regenerated durable thumbnails after hydration.
   - Cover Media-pane large/small/list views and timeline fallback/filmstrip paths
     in acceptance criteria.
4. `docs/spec/asset-management-ux.md`
   - Define the Media-pane thumbnail, loading, and placeholder states for video and
     scene-derived assets.
   - Require a visible missing/unsupported state instead of an unexplained blank
     tile when regeneration cannot succeed.

## Verification commands

```bash
pnpm --filter @openreel/web exec vitest run \
  src/services/backend-save.test.ts \
  src/components/editor/timeline/ClipComponent.test.tsx \
  src/services/auto-save.test.ts

pnpm --filter @openreel/core exec vitest run \
  src/media/thumbnail-utils.test.ts
```
