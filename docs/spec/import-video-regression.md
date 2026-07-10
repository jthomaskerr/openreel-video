# Import-video regression

Status: investigation complete; product code was not modified.

## Scope and current behavior

The report covers two related paths for a video with embedded audio:

1. Importing or replacing a video can succeed, but the resulting video/audio is silent or fails to decode during preview.
2. Separating audio from a trimmed video creates an audio clip at the video start, but the separated clip uses the full source duration rather than the video clip's trim range.

The user-visible impact is that a video can appear in the media library and timeline while its embedded audio does not play. After “Separate audio”, the new audio clip can contain material outside the selected video range and can overlap or extend beyond the video. The reported example was `vintage tokyo, car stops.mp4`.

## Confirmed root causes

### 1. Import/replace discards the playable fallback blob

`MediaImportService.importWithFallback()` transcodes an unsupported source and returns `processedMedia.blob` as the compatible file (`packages/core/src/media/media-import-service.ts:238-324`). The normal import path and replacement path then store the original `file` instead:

- `apps/web/src/stores/project-store.ts:2024` sets `blob: file` in `importMedia`.
- `apps/web/src/stores/project-store.ts:2245` sets `blob: file` in `replaceMediaAsset`.

The same methods use metadata and thumbnails extracted from `processedMedia` (`project-store.ts:2025-2041`, `2246-2258`). This creates an internally inconsistent `MediaItem`: metadata describes the fallback/transcoded asset, while the blob used later by playback is the original source. `MediaBridge.importFile()` returns the processed media without changing this (`apps/web/src/bridges/media-bridge.ts:190-238`).

Playback decodes the stored blob directly with `AudioContext.decodeAudioData` (`packages/core/src/playback/playback-controller.ts:650-681`). Therefore an import can report success and render video thumbnails, yet embedded audio remains unavailable when the original codec/container cannot be decoded. Replacement has the same failure because it follows the same `blob: file` assignment.

This is the strongest explanation for the reported replaced-clip silence. It is a code-supported diagnosis; it still needs a real unsupported-codec fixture or browser run to demonstrate the exact file.

### 2. Separate-audio does not copy trim points

`separateAudio()` finds the source video clip, but its `clip/add` action passes only `trackId`, `mediaId`, `startTime`, and `audioTrackIndex` (`apps/web/src/stores/project-store.ts:3257-3266`). It does not pass:

- `duration: videoClip.duration`
- `inPoint: videoClip.inPoint`
- `outPoint: videoClip.outPoint`

`ActionExecutor.applyClipAction()` defaults these values from the media's full metadata duration (`packages/core/src/actions/action-executor.ts:493-499`) and defaults `inPoint` to `0`, `outPoint` to the resulting duration (`:539-543`). Thus a trimmed source clip produces a full-length separated clip at the source clip's timeline start. This directly explains “separating audio does not respect trim.”

The implementation also reuses the video media ID and stores only `audioTrackIndex` (`project-store.ts:3263-3266`). The preview scheduler passes `clip.audioTrackIndex` nowhere in its decode path: `PlaybackController.getAudioClipsAtTime()` calls `getOrDecodeAudioBuffer(mediaItem)` (`packages/core/src/playback/playback-controller.ts:588-614`), and `decodeAudioBuffer()` decodes the whole blob with `decodeAudioData` (`:650-681`). This is a separate multi-audio-track risk: the selected embedded stream is not demonstrably honored by this path.

## Affected files and symbols

| File | Symbol / range | Role |
| --- | --- | --- |
| `apps/web/src/stores/project-store.ts` | `importMedia`, `:1813-2125` | Imports media, builds `MediaItem`, persists blob |
| `apps/web/src/stores/project-store.ts` | `replaceMediaAsset`, `:2145-2300` | Replaces media while preserving asset identity |
| `apps/web/src/stores/project-store.ts` | `separateAudio`, `:3150-3293` | Adds separated audio clips and mutes source |
| `packages/core/src/media/media-import-service.ts` | `MediaImportService.importMedia`, `:66-216` | Chooses direct import vs fallback |
| `packages/core/src/media/media-import-service.ts` | `importWithFallback`, `:238-324` | Produces compatible blob and metadata |
| `packages/core/src/actions/action-executor.ts` | `applyClipAction` / `clip/add`, `:466-563` | Applies duration and trim defaults |
| `packages/core/src/playback/playback-controller.ts` | `getAudioClipsAtTime`, `:588-614` | Schedules audio for video/audio tracks |
| `packages/core/src/playback/playback-controller.ts` | `decodeAudioBuffer`, `:650-681` | Decodes the stored media blob |
| `apps/web/src/components/editor/preview-audio-playback.ts` | `getAudioPlaybackClips` | Decides embedded vs separated preview audio |

## Reproduction steps

### A. Import/replace silence

1. Start a development build and open a project containing a video with audio.
2. Import a video whose original container/codec requires the FFmpeg fallback, or replace an existing video with that file through “Replace/Link file”.
3. Confirm the import succeeds and the video appears in the asset library/timeline.
4. Play the video from the preview.
5. Observe video frames without embedded audio, or an audio decode failure in the console.
6. Inspect the resulting `MediaItem`: its metadata/thumbnails come from the processed result, but `blob` is the original `File`, not the fallback blob.

### B. Trim then separate audio

1. Import a video with embedded audio and place it on a video track.
2. Trim it so `inPoint > 0` and/or `outPoint < media.metadata.duration`; retain a shorter `clip.duration`.
3. Use the clip context menu’s “Separate audio”.
4. Inspect the generated audio clip.
5. Current result: its `startTime` matches the video, but its duration/in/out points default from the full media duration rather than the trimmed video clip.
6. Play the timeline and confirm the separated clip is not constrained to the selected source range. If the source blob is not browser-decodable, it is silent as well.

Browser reproduction was not run in this investigation: no browser tool is exposed, and the local Vite server could not bind in the sandbox (`listen EPERM ::1:5173`).

## Acceptance criteria

- Import and replace retain the exact blob returned by the import service, including a transcoded fallback blob; metadata, thumbnails, and blob describe the same asset.
- A supported direct import still stores the original file bytes and remains playable.
- A trimmed video’s separated audio clip has the same `startTime`, `duration`, `inPoint`, and `outPoint` as the source video clip.
- Separating audio mutes the embedded source without muting or duplicating the separated clip.
- The separated clip plays the requested embedded audio stream when `audioTrackIndex` is set, or the implementation documents and tests the supported stream-selection behavior.
- Existing user metadata and stable media identity are preserved when replacing an asset.
- Failed import/replace leaves the previous media and timeline unchanged.

## Required regression tests

Add deterministic tests before implementation is considered complete:

1. `MediaImportService` fallback test: mock a fallback transcode and assert the result’s `media.blob` is the compatible blob.
2. `ProjectStore.importMedia` test: mock `MediaBridge.importFile()` with a processed blob different from the input file; assert the stored `MediaItem.blob` is the processed blob.
3. `ProjectStore.replaceMediaAsset` equivalent: assert replacement stores the processed blob and keeps the existing media ID and user metadata.
4. `separateAudio` trim regression: source clip with `startTime: 12`, `duration: 3`, `inPoint: 7`, `outPoint: 10`; assert the generated audio clip has those same four timing values.
5. Playback regression: an imported video with embedded audio and no separated clip is scheduled; a separated clip suppresses the duplicate embedded path while remaining audible.
6. Stream-selection regression, if multi-track separation remains supported: assert `audioTrackIndex` reaches the decoder/extraction operation and selects the requested stream.
7. Failure atomicity test: failed import/replace does not add a media item, replace the blob, or alter existing clips.

The existing suite has useful adjacent coverage but does not close these gaps. `apps/web/src/stores/project-store.test.ts:1833-1956` checks that separate-audio creates clips and counts tracks, but uses an untrimmed clip and does not assert timing. `apps/web/src/components/editor/preview-audio-playback.test.ts:103-304` covers scheduling and duplicate suppression, not fallback-blob persistence. `apps/web/src/bridges/media-bridge.test.ts` verifies bridge delegation and result propagation, not store persistence of `processedMedia.blob`.

## Verification evidence

- Focused command: `pnpm --filter @openreel/web exec vitest run src/stores/project-store.test.ts src/components/editor/preview-audio-playback.test.ts src/bridges/media-bridge.test.ts`
  - Result: 3 test files passed; 102 tests passed; 4 skipped.
  - Existing stderr only reported expected “No thumbnails generated” warnings from mocked imports.
- Typecheck command: `pnpm --filter @openreel/web typecheck`
  - Result: passed with exit code 0.
- Dev-server attempt: `pnpm --filter @openreel/web dev -- --host 127.0.0.1`
  - Result: failed before serving because the sandbox denied binding (`Error: listen EPERM ... ::1:5173`).
- Code-review graph: unavailable in this session; semantic graph queries could not be executed. Findings were derived from exact source inspection, line-numbered code, existing tests, and git history.
- Browser verification: unavailable because no browser connector/tool is exposed and the dev server could not start.

## Recommended implementation boundary

The likely minimal fix is scoped to the import/replace blob assignment and the `separateAudio` clip-add timing parameters, followed by the tests above. Stream selection should be treated as a separate acceptance item because the current preview decoder is keyed only by media ID and does not include `audioTrackIndex` in its cache or decode contract.
