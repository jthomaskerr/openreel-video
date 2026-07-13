# Subtitle/caption regression investigation

Status: investigation complete; product code intentionally unchanged.

## Executive diagnosis

Subtitle state has two competing representations:

1. `Timeline.subtitles: Subtitle[]` remains the source for subtitle lookup,
   preview subtitle overlays, subtitle selection, style presets, and SRT
   export-related logic.
2. `projectStore.addSubtitle()` does not append to that array. It creates a
   generic `TextClip` in a track named `Captions` through `createTextClip()`.

The conversion is one-way. The resulting text clip has the imported start time
and duration, but it has no `Subtitle` identity, word timing, subtitle style
position, or corresponding flat-array record. Any code that reads the other
representation therefore sees no subtitle or stale subtitle data. This is the
primary root cause of the regression family, not SRT timestamp parsing.

The repository's existing implementation plan reaches the same conclusion:
the current workaround is explicitly described as “flat array + text clips,”
with skipped CRUD/export tests, and proposes a first-class subtitle clip model
(`docs/superpowers/plans/2026-07-03-subtitle-track-clip-type.md`, lines 5–7,
177–224).

## Concrete current behavior

### Auto-caption generation

- `AutoCaptionPanel` supports microphone recording and selected audio/video
  clip transcription. The selected-clip path calls
  `TranscriptionService.transcribeClip()` and then calls `addSubtitle()` once
  per returned subtitle (`apps/web/src/components/editor/inspector/AutoCaptionPanel.tsx`).
- `TranscriptionService` correctly extracts the selected clip range and
  returns absolute timeline timestamps by adding `clip.startTime`
  (`packages/core/src/text/transcription-service.ts:90–118, 371–424`).
- A selected subtitle/text clip is not a valid transcription source: the UI
  only enables generation for `audio` or `video` clips. There is no command to
  generate captions from an already placed subtitle/text track.

### Import and placement

- `importSRT()` parses valid timestamps and calls `addSubtitle()` for every
  parsed item (`apps/web/src/stores/project-store.ts:5517–5546`).
- `addSubtitle()` finds or creates a track named `Captions`, then calls
  `createTextClip(captionsTrack.id, subtitle.startTime, subtitle.text,
  subtitle.endTime - subtitle.startTime, ...)` (`project-store.ts:5422–5472`).
- It does not write `project.timeline.subtitles`. Consequently, imported or
  auto-generated captions can appear as timeline text clips while
  `getSubtitle()`, `removeSubtitle()`, `updateSubtitle()`, and the flat-array
  preview/selection code cannot find them.
- The text-clip style mapping copies font family, size, color, and background,
  but drops `SubtitleStyle.position`. `createTextClip()` then applies
  `DEFAULT_TEXT_TRANSFORM.position = { x: 0.5, y: 0.5 }`
  (`packages/core/src/text/types.ts:175–193`). This is why generated captions
  default to the visual center instead of the expected bottom caption area.

### Preview, selection, and editing

- `Preview` reads `project.timeline.subtitles` into `allSubtitles` and renders
  those records with `renderSubtitleToCanvas()`; it separately renders text
  clips from the title engine on text/subtitle tracks
  (`apps/web/src/components/editor/Preview.tsx:845–861, 2290–2338`). The two
  paths do not share identity or edits.
- Marquee selection in `Timeline.handleBoxSelectionEnd()` iterates only
  `track.clips` (`Timeline.tsx:462–526`). Caption text clips live in the
  title engine's separate `textClips` map and are painted into the lane by
  `TrackLane`, so marquee selection cannot discover them.
- Individual text clips can be clicked, moved, and trimmed through
  `TextClipComponent`, but there is no subtitle-specific multi-edit operation
  and the existing `updateSubtitle()` action updates only the disconnected
  flat array (`project-store.ts:5474–5506`).
- The four intended CRUD/export tests are explicitly skipped because the API
  has not been migrated (`apps/web/src/stores/project-store.test.ts:1997–2024`).

## User-visible impact

- Imported and automatically generated captions may have correct initial
  timeline block times but become inconsistent with preview, subtitle
  inspector, style, deletion, update, and export paths.
- Captions cannot be generated from an already placed subtitle/text track.
- Marquee selection does not select caption blocks; users must operate on
  individual text clips, and there is no reliable “edit/move all subtitles”
  workflow.
- Caption placement is centered because subtitle positioning is discarded
  before generic text-clip creation.
- Fixing only SRT parsing or only canvas rendering will leave the state,
  selection, and edit regressions intact.

## Reproduction steps

### Code-level reproduction (verified)

1. Start with an empty project and initialize the title engine.
2. Call `useProjectStore.getState().importSRT()` with two valid SRT blocks.
3. Observe that a text track named `Captions` and two title-engine text clips
   are created with the expected initial start times and durations.
4. Observe that `project.timeline.subtitles` remains empty, so
   `getSubtitle()` returns `undefined`, CRUD operations have no effect on the
   created clips, and flat-array preview/selection code has no matching records.
5. Inspect the created clips: their default transform is centered and the
   source `SubtitleStyle.position` was not passed to `createTextClip()`.
6. Drag a marquee over the caption lane. `handleBoxSelectionEnd()` examines
   `track.clips`, not title-engine text clips, so no caption is added to the
   selection.

### UI reproduction (not run)

The exact browser flow should be verified once browser tooling is available:

1. Run `pnpm dev` and open the editor.
2. Import an SRT containing at least two non-overlapping captions.
3. Play/scrub the media and compare caption visibility/timing with the SRT;
   then select a caption and attempt edit, delete, marquee select, and bulk
   move/edit operations.
4. Open AI → Auto Captions with a subtitle/text clip selected and confirm that
   the selected-clip mode is unavailable; select an audio/video clip and
   confirm that generation is available.
5. Confirm generated captions render at center rather than bottom.

Browser verification was unavailable in this session: no browser connector or
Playwright/browser tool was exposed. The UI claims above are therefore tied to
the code paths and deterministic tests below, not a live screenshot/session.

## Affected files and symbols

| Area | Files/symbols | Failure contribution |
| --- | --- | --- |
| State contract | `packages/core/src/types/timeline.ts:5–8`, `Timeline.subtitles` | Keeps a flat subtitle store alongside track clips |
| Creation | `apps/web/src/stores/project-store.ts:addSubtitle`, `createTextClip` | Writes only generic title-engine clips; drops position/identity |
| CRUD/export | `removeSubtitle`, `updateSubtitle`, `getSubtitle`, `importSRT`, `exportSRT` | Operates on flat array, not created caption clips |
| Auto captions | `apps/web/src/components/editor/inspector/AutoCaptionPanel.tsx` | Routes every generated subtitle through the broken conversion |
| Transcription | `packages/core/src/text/transcription-service.ts:transcribeClip`, `convertToSubtitles` | Timestamp source is otherwise correct; affected downstream |
| Rendering | `apps/web/src/components/editor/Preview.tsx:allSubtitles`, subtitle-track branch; `canvas-renderers.ts:renderSubtitleToCanvas` | Reads two unjoined models |
| Timeline | `Timeline.handleBoxSelectionEnd`, `TrackLane`, `TextClipComponent` | Marquee sees `track.clips`; caption clips are title-engine-only |
| Defaults | `packages/core/src/text/types.ts:DEFAULT_TEXT_TRANSFORM`, `DEFAULT_TEXT_STYLE` | Generic text defaults to center |
| Existing evidence | `apps/web/src/stores/project-store.test.ts:2008–2024` | Four regression tests are skipped |

## Acceptance criteria for the fix

1. There is one canonical persisted subtitle representation. A created,
   imported, or auto-generated caption has stable identity, text, start/end
   times, word timing when available, style, and track membership.
2. Preview playback, timeline blocks, inspector editing, deletion, style
   presets, project save/load, SRT import/export, and video export all read and
   write that same representation.
3. Caption timing remains aligned after import, auto-generation, move, trim,
   save/load, and export. Clip-local transcription offsets are added exactly
   once.
4. Caption styling preserves `position`; the default is bottom, with explicit
   top/center/bottom overrides respected by preview and export.
5. Selecting one caption exposes editable text and timing. Marquee selection
   can select multiple captions, and bulk move/edit applies to every selected
   caption without changing unselected clips.
6. Auto Captions clearly distinguishes microphone input from audio/video clip
   input and handles no selection, wrong clip type, missing media, and backend
   errors without creating partial or orphaned captions.
7. Existing microphone recording and ordinary text-clip behavior remain
   unchanged.

## Required regression tests

- Store CRUD: add/import, get, update, remove, and style-update a subtitle and
  assert the canonical track record changes; assert no orphan representation
  remains.
- SRT round trip: import two timed blocks, export them, and assert timestamps,
  text, ordering, and duration are preserved.
- Auto-caption integration: mock `transcribeClip()` with word-timed results,
  assert one canonical caption per returned segment, correct absolute times,
  style position, and no duplicate flat/text records.
- Range math: transcribe a clip with non-zero `startTime`/`inPoint` and assert
  each word and segment is offset exactly once.
- Persistence: save and reload captions, then assert preview/timeline/CRUD
  still reference the same IDs and times.
- Marquee selection: render a timeline with two caption clips, drag a box over
  them, and assert both are selected; assert a box outside them selects none.
- Bulk editing: move/edit multiple selected captions and assert all selected
  records update, including preview timing and text.
- Position rendering: verify bottom is the default and top/center/bottom
  positions produce the corresponding canvas bounds in both preview and
  export paths.
- Error handling: no selected clip, unsupported clip, missing media, backend
  rejection, and partial result failure must leave no orphan captions and must
  re-enable the action.

## Verification evidence

Executed from the repository root on 2026-07-10:

```text
pnpm --filter @openreel/web test:run \
  src/components/editor/inspector/AutoCaptionPanel.test.tsx \
  src/stores/project-store.test.ts

Test Files  2 passed (2)
Tests       71 passed | 4 skipped (75)
```

The 10 `AutoCaptionPanel` tests pass, including selected audio/video input,
unsupported selection guidance, missing media, backend failure, progress, and
mode switching. The project-store suite passes 65 tests, but its four subtitle
CRUD/export tests remain skipped; those skips are direct evidence of the
unfixed contract gap. The SRT import tests pass only for creation of generic
text clips and therefore do not prove canonical subtitle CRUD, preview
alignment, or export correctness.

No product code was modified during this investigation. The code-review graph
MCP requested by repository instructions was not available; Serena semantic
symbol/search tools were used for targeted navigation instead. Browser
verification was also unavailable as noted above.

## Recommended implementation direction

Adopt the already documented first-class `SubtitleClip`/subtitle-track
direction in `docs/superpowers/plans/2026-07-03-subtitle-track-clip-type.md`.
Migrate `addSubtitle`, CRUD, import/export, preview, timeline selection, and
inspector behavior together, then unskip the four store tests and add the UI
regressions above. Do not extend the current flat-array-plus-generic-text-clip
workaround; that would preserve the source of the divergence.
