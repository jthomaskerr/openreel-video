# Spec: Auto Captions — Selected Clip Input Support

Status: specced → ready for implementation
Source plan: `docs/superpowers/plans/2026-07-08-subtitle-files.md`
Related canonical spec: `docs/spec/audio-analysis-subtitles.md` (§5.2–5.8, §8.2)

## 1. Problem Statement

`AutoCaptionPanel.tsx` (reached via AI Gen → Auto Captions) only supports live
browser speech recognition (`SpeechToTextEngine`). It has no way to transcribe
an already-imported audio/video clip. Meanwhile `InspectorPanel.tsx` already
implements clip-based transcription (`handleGenerateSubtitles`) using
`TranscriptionService.transcribeClip`, but that entry point is buried in the
Inspector's per-clip "AI" tab and duplicates a lot of state/logic that
`AutoCaptionPanel` doesn't share.

Goal: give `AutoCaptionPanel` a "Selected Clip" mode, backed by the existing
`TranscriptionService`, while keeping the microphone-recording mode intact.

## 2. Current State (evidence)

- `apps/web/src/components/editor/inspector/AutoCaptionPanel.tsx` — pure
  live-mic panel. Exported from `apps/web/src/components/editor/inspector/index.ts`
  and consumed only by `apps/web/src/components/editor/AIGenTab.tsx`
  (`case "captions": return <AutoCaptionPanel />`). It is NOT used inside
  `InspectorPanel`'s per-clip AI tab (`AiTab.tsx` has its own "Generate
  Captions" button wired to `InspectorPanel.handleGenerateSubtitles`).
- `packages/core/src/text/transcription-service.ts` exports `TranscriptionService`,
  `initializeTranscriptionService`, `getTranscriptionService`,
  `disposeTranscriptionService`, and types `WhisperTranscriptionProgress`,
  `TranscriptionConfig`. Re-exported from `@openreel/core` via
  `packages/core/src/text/index.ts` (`export * from "./transcription-service"`).
  `transcribeClip(clip, mediaItem, onProgress)` extracts audio (respecting
  `clip.inPoint`/`clip.outPoint`/`clip.duration`), encodes to WAV, uploads to
  `${OPENREEL_TRANSCRIBE_URL}/transcribe`, polls `/jobs/:jobId`, and returns
  `Subtitle[]` with absolute timeline timestamps (`clip.startTime`-relative).
- `apps/web/src/config/api-endpoints.ts` exports `OPENREEL_TRANSCRIBE_URL =
  "https://cloud.openreel.video"` (dev/prod same value; no `isDev` branch for
  this one, unlike `OPENREEL_CLOUD_URL`).
- `InspectorPanel.tsx` (lines ~507–578) contains the reference implementation
  `handleGenerateSubtitles`: gets `selectedClip`, resolves `mediaItem` via
  `getMediaItem(selectedClip.mediaId)`, calls
  `initializeTranscriptionService({ apiEndpoint, targetLanguage })`, then
  `transcriptionService.transcribeClip(regularClip, mediaItem, setTranscriptionProgress)`,
  then `addSubtitle({ ...subtitle, animationStyle: defaultAnimationStyle })`
  for each result.
- `useUIStore` (`apps/web/src/stores/ui-store.ts`) exposes
  `getSelectedClipIds(): string[]` — filters `selectedItems` down to
  clip-like selections (video/audio/text/shape clips), excluding
  track/effect/keyframe/marker selections.
- `useProjectStore` exposes `getClip(clipId): Clip | undefined` and
  `getMediaItem(mediaId): MediaItem | undefined`.
- `Clip.type` (packages/core/src/types/timeline.ts) is one of `"video" |
  "audio" | "image" | "metadata" | "text" | "shape" | "svg" | "sticker"`.
  Only `"video"` and `"audio"` clips carry meaningful audio content for
  transcription — matches the plan's `selectedClip?.type === "audio" ||
  selectedClip?.type === "video"` guard.
- `addSubtitle(subtitle: Subtitle): Promise<void>` and
  `applySubtitleStylePreset(presetName: string): Promise<boolean>` both exist
  on `useProjectStore` today (confirmed in `project-store.ts` and
  `project/types.ts`) — the plan's calls to these are valid against current
  API shapes (note: `applySubtitleStylePreset` returns `Promise<boolean>`, so
  the plan's `await applySubtitleStylePreset(selectedStyle)` is correct, but
  the return value is currently discarded — keep it that way, consistent with
  `InspectorPanel`'s own style-preset calls elsewhere).
- No existing test file covers `AutoCaptionPanel` or `TranscriptionService`.
  Vitest is configured at `apps/web/vitest.config.ts` (jsdom environment,
  `@openreel/core` aliased to `packages/core/src`).
- Component test conventions observed in
  `apps/web/src/components/editor/InspectorPanel.tabs.test.tsx` and
  `apps/web/src/components/editor/inspector/AssetInspectorWithTabs.audio.test.tsx`:
  use real Zustand stores (`useProjectStore.setState`, `useUIStore.getState().select(...)`),
  not full component mocks; render with `@testing-library/react`; reset state
  in `afterEach`.

## 3. Scope Decision

Implement the plan largely as written, with the following clarifications/
deviations grounded in the codebase:

1. **Do not touch `InspectorPanel`/`AiTab`.** Their existing
   `handleGenerateSubtitles` clip-transcription flow stays as-is. This work
   is scoped to `AutoCaptionPanel.tsx` only (used from the AI Gen sidebar
   panel, not the per-clip Inspector tab). No shared extraction of the
   transcription handler is required for this task — some duplication with
   `InspectorPanel.handleGenerateSubtitles` is acceptable and matches the
   plan's intent ("No major core changes should be needed").
2. **Selected clip source:** use `useUIStore((state) => state.getSelectedClipIds)`
   + `useProjectStore((state) => state.project)` + `useProjectStore((state) =>
   state.getMediaItem)`, exactly as the plan specifies, but resolve the clip
   via `useProjectStore.getState().getClip(id)` equivalent lookup — actually
   simplest is to reuse the plan's `project.timeline.tracks.flatMap(...).find(...)`
   approach since `getClip` is also acceptable and already memoized elsewhere.
   Use `project.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id ===
   selectedIds[0])` per the plan (avoids taking a dependency on `getClip`
   identity for `useMemo`, and matches an existing pattern already used
   elsewhere in the codebase for clip lookups by id across tracks).
3. **Default caption source:** `"selected-clip"` when a valid single
   audio/video clip is selected, else `"microphone"`. This must be computed
   once when the selection first becomes valid, not force-overridden every
   render (so the user can still manually switch modes without the effect
   fighting them). Implementation: initialize state lazily based on whether
   a clip is selected at mount, and add a small `useEffect` that switches
   `captionSource` to `"selected-clip"` only when it transitions from "no
   valid clip" to "valid clip selected" and the current source is
   `"microphone"` because there is nothing else to record from yet — but do
   NOT force it back to `"microphone"` when the clip becomes invalid; instead
   disable the Generate action and show the appropriate empty/error state.
   Concretely:
   - On mount: `captionSource` defaults to `"selected-clip"` if
     `isValidClipSelected` at initial render, otherwise `"microphone"`.
   - No forced re-sync afterward — simplest, least surprising behavior, and
     avoids fighting explicit user toggle. (Simpler than the plan's vague
     "recommended default" language; avoids introducing an effect with
     interaction hazards where switching clips resets a manual microphone
     choice back to selected-clip mid-workflow.)
4. **Progress model:** Two distinct progress state shapes already exist:
   `TranscriptionProgress` (mic/live, `{ segmentsFound }based`) and
   `WhisperTranscriptionProgress` (clip/backend, `{ phase, progress, message
   }`). Keep them as two separate state variables (`progress` for mic,
   `clipProgress` for backend, per the plan) rather than unifying types —
   unifying is out of scope and would touch `SpeechToTextEngine` consumers
   elsewhere (`InspectorPanel` already treats them as distinct).
5. **Error taxonomy:** implement the 4 states from the plan (§5) as derived
   UI, not separate state variables:
   - No selected clip → show guidance text, disable Generate button.
   - Wrong clip type (image/text/shape/svg/sticker/metadata selected) → show
     guidance text, disable Generate button.
   - No local media source (`mediaItem` found but has neither `.blob` nor
     `.fileHandle`) → show guidance text, disable Generate button. Detect via
     `!mediaItem.blob && !mediaItem.fileHandle` (mirrors the check inside
     `TranscriptionService.extractAudioFromClip`, which throws `"No media
     source available for audio extraction"` — catch and map that error
     message to the friendlier UI copy, and/or pre-check before invoking to
     avoid a wasted round trip).
   - Backend unavailable / any other transcription failure → surface via the
     existing `error` state + banner (already present in `AutoCaptionPanel`),
     using the caught error's message when available, falling back to
     "Transcription service is unavailable. Try again later." for generic
     network-shaped failures (e.g. `TypeError` from `fetch` rejecting, or
     non-OK HTTP responses without a parseable body).
6. **Multi-select / no-selection:** `selectedClip` is `null` unless exactly
   one clip is selected (`selectedIds.length !== 1`), matching the plan and
   `InspectorPanel`'s own convention.

## 4. Detailed Design

### 4.1 File: `apps/web/src/components/editor/inspector/AutoCaptionPanel.tsx`

**New imports:**
```ts
import { useMemo, useEffect } from "react"; // extend existing React import
import { useUIStore } from "../../../stores/ui-store";
import { useProjectStore } from "../../../stores/project-store";
import {
  initializeTranscriptionService,
  type WhisperTranscriptionProgress,
} from "@openreel/core"; // add to existing @openreel/core import block
import { OPENREEL_TRANSCRIBE_URL } from "../../../config/api-endpoints";
```
(`SpeechToTextEngine`, `TranscriptionProgress`, `TranscriptionSegment` imports
stay as-is.)

**New store bindings (inside component body):**
```ts
const getSelectedClipIds = useUIStore((state) => state.getSelectedClipIds);
const project = useProjectStore((state) => state.project);
const getMediaItem = useProjectStore((state) => state.getMediaItem);
```

**Derived selected clip:**
```ts
const selectedClip = useMemo(() => {
  const selectedIds = getSelectedClipIds();
  if (selectedIds.length !== 1) return null;
  return (
    project.timeline.tracks
      .flatMap((track) => track.clips)
      .find((clip) => clip.id === selectedIds[0]) ?? null
  );
}, [getSelectedClipIds, project.timeline.tracks]);

const isTranscribableClip =
  selectedClip?.type === "audio" || selectedClip?.type === "video";
```

**Mode state:**
```ts
type CaptionSource = "microphone" | "selected-clip";

const [captionSource, setCaptionSource] = useState<CaptionSource>(() =>
  isTranscribableClip ? "selected-clip" : "microphone",
);
```
No auto-resync effect (see §3.3 rationale) — user can freely toggle via the
mode selector regardless of clip validity; invalid states are handled by
disabling/annotating the Generate action, not by silently changing the mode.

**Clip transcription progress + handler:**
```ts
const [clipProgress, setClipProgress] =
  useState<WhisperTranscriptionProgress | null>(null);

const handleTranscribeSelectedClip = useCallback(async () => {
  if (!selectedClip) return;

  if (selectedClip.type !== "audio" && selectedClip.type !== "video") {
    setError("Select an audio or video clip to generate captions");
    return;
  }

  const mediaItem = getMediaItem(selectedClip.mediaId);
  if (!mediaItem) {
    setError("Could not find media for selected clip");
    return;
  }

  if (!mediaItem.blob && !mediaItem.fileHandle) {
    setError(
      "This clip's source media is unavailable. Reconnect or recover the media first.",
    );
    return;
  }

  setError(null);
  setSegments([]);
  setIsTranscribing(true);

  try {
    const transcriptionService = initializeTranscriptionService({
      apiEndpoint: `${OPENREEL_TRANSCRIBE_URL}/transcribe`,
      language: selectedLanguage,
    });

    const subtitles = await transcriptionService.transcribeClip(
      selectedClip,
      mediaItem,
      setClipProgress,
    );

    subtitles.forEach((subtitle) => {
      addSubtitle(subtitle);
    });

    if (selectedStyle !== "default") {
      await applySubtitleStylePreset(selectedStyle);
    }
  } catch (err) {
    setError(
      err instanceof Error ? err.message : "Failed to transcribe clip",
    );
  } finally {
    setIsTranscribing(false);
    setClipProgress(null);
  }
}, [
  selectedClip,
  getMediaItem,
  selectedLanguage,
  selectedStyle,
  addSubtitle,
  applySubtitleStylePreset,
]);
```

**Primary action dispatch** (replaces direct `onClick={handleStartTranscription}`
wiring on the main button):
```ts
const handlePrimaryAction = useCallback(async () => {
  if (captionSource === "selected-clip") {
    await handleTranscribeSelectedClip();
  } else {
    await handleStartTranscription();
  }
}, [captionSource, handleTranscribeSelectedClip, handleStartTranscription]);
```
`isTranscribing` must be shared/consistent across both paths so the Stop
button (mic-only) and disabled states don't desync — both handlers already
set the same `isTranscribing` state variable, so this works without change.

**Generate button disabled condition (selected-clip mode):**
```ts
const generateDisabled =
  isTranscribing ||
  (captionSource === "selected-clip" && !isTranscribableClip);
```

**Mode selector UI** — add a two-option toggle/select (reuse existing
`Select`/`SelectTrigger`/`SelectContent`/`SelectItem` primitives already
imported from `@openreel/ui`, consistent with Language/Style selectors already
in the file) with options `"Selected Clip"` and `"Microphone Recording"`,
disabled while `isTranscribing`.

**Guidance/error copy** (rendered above or in place of the existing static
footer paragraph, only in `"selected-clip"` mode):
- No clip selected (`!selectedClip`): "Select an audio or video clip in the
  timeline to generate captions."
- Wrong type (`selectedClip && !isTranscribableClip`): "Selected clip does not
  contain audio."
- Valid selection, idle: "Generate captions from the selected audio/video
  clip."
- Microphone mode (unchanged): "Record live speech from your microphone." /
  existing "Speak clearly into your microphone..." copy retained as fallback
  in that branch.

Media-unavailable and backend-unavailable messages surface through the
existing `error` banner (already rendered when `error` is truthy), not as
separate static copy blocks — this reuses existing UI rather than adding a
fifth conditional-copy region.

**Progress UI (selected-clip mode):** render `clipProgress.message` +
`clipProgress.progress`% using the same visual pattern already used for
`WhisperTranscriptionProgress` in `AiTab.tsx` (label + thin progress bar,
colored red/green/primary by `phase`), gated on `captionSource ===
"selected-clip" && clipProgress`. Microphone-mode's existing `progress &&
isTranscribing` block stays gated on `captionSource === "microphone"`.

**Button labels:**
- Idle, selected-clip mode → "Generate Captions" (`Captions` icon, reuse
  import already present in `AiTab.tsx`'s icon set — add `Captions` to this
  file's `lucide-react` import list).
- Idle, microphone mode → "Start Recording" (unchanged, `Mic` icon).
- Transcribing, selected-clip mode → "Generating…" (no Stop button — clip
  transcription cannot be cancelled by the current `TranscriptionService`
  API).
- Transcribing, microphone mode → "Stop Recording" (unchanged, `MicOff`
  icon).

### 4.2 No changes required to:
- `packages/core/src/text/transcription-service.ts`
- `apps/web/src/config/api-endpoints.ts`
- `apps/web/src/components/editor/InspectorPanel.tsx`
- `apps/web/src/components/editor/inspector/tabs/AiTab.tsx`
- `apps/web/src/components/editor/AIGenTab.tsx` (already renders
  `<AutoCaptionPanel />` for the "captions" feature — no wiring changes
  needed)

## 5. Testing Plan

New file: `apps/web/src/components/editor/inspector/AutoCaptionPanel.test.tsx`

Follow the established pattern from `InspectorPanel.tabs.test.tsx` (real
Zustand stores, `render`/`screen`/`fireEvent`, reset in `afterEach`) rather
than deep-mocking stores. Mock only `@openreel/core`'s
`initializeTranscriptionService` (and `SpeechToTextEngine` if needed for
`isSupported`/`getSupportedLanguages` determinism in jsdom).

Cases:
1. No clip selected → defaults to microphone mode; guidance text shown when
   selected-clip mode is manually chosen; Generate button disabled in that
   case.
2. Audio clip selected → defaults to selected-clip mode; Generate button
   enabled; clicking it calls the mocked `transcribeClip` and, on resolving
   with `Subtitle[]`, calls `addSubtitle` once per subtitle.
3. Video clip selected → same as above.
4. Image/text/metadata clip selected → selected-clip mode shows "Selected
   clip does not contain audio."; Generate button disabled if forced into
   selected-clip mode.
5. Media item missing `blob` and `fileHandle` → clicking Generate sets the
   "source media is unavailable" error without calling
   `transcribeClip`.
6. Successful transcription with `selectedStyle !== "default"` → asserts
   `applySubtitleStylePreset` called with the chosen preset id.
7. Failed `transcribeClip` (mock rejects) → `error` state renders the
   rejection message; `isTranscribing` resets to `false`;
   `clipProgress` resets to `null`.
8. Progress callback invocation → mock `transcribeClip` to call the passed
   `onProgress` callback synchronously with a sample
   `WhisperTranscriptionProgress`; assert the progress bar/message renders.
9. Switching mode via the selector while a clip is selected does not throw
   and correctly swaps which button/section renders (mic vs clip controls).
10. Microphone-mode existing behavior (start/stop/apply segments) still
    passes unchanged — regression coverage for `handleStartTranscription`,
    `handleStopTranscription`, `handleApplySegments`.

`TranscriptionService` itself already has no test file; adding one for
`packages/core/src/text/transcription-service.test.ts` covering
`transcribeClip`'s clip-trim math (`inPoint`/`outPoint`/`duration`),
WAV encoding header correctness, and `sendToWhisper`/`pollForResult`
success/429/404/failed/timeout branches is valuable but is a separable,
optional follow-up (flagged as a `#followup` inbox item, not blocking this
task, since `AutoCaptionPanel` is a pure consumer of that already-implemented
service and the plan itself says "No major core changes should be needed").

## 6. Browser Verification (required — UI change, non-negotiable per AGENTS.md)

1. `pnpm dev` (port 5173), open the editor.
2. Import a video clip with speech; add to timeline; select it.
3. Open AI Gen → Auto Captions. Confirm it opens in "Selected Clip" mode by
   default with the clip's Generate Captions button enabled.
4. Click Generate Captions; confirm progress phases render
   (extracting/uploading/transcribing/processing/complete) and subtitles
   land on the timeline's Captions track with timings aligned to the clip's
   `startTime`.
5. Set a non-default Caption Style before generating; confirm the style
   preset is applied to the new subtitles.
6. Repeat with an audio-only clip.
7. Select an image/text clip; confirm the disabled/guidance state renders
   correctly and switching to Microphone Recording mode still works
   (existing live-mic flow unaffected).
8. Deselect all clips; confirm empty-state guidance and default-to-microphone
   behavior.
9. Simulate a media-unavailable clip (e.g. a clip whose source was never
   downloaded/blob-backed in this session, if reproducible) or verify via
   code inspection that the guard fires; otherwise note as a code-level check
   only.

## 7. Out of Scope / Explicitly Deferred

- Any change to `infra/transcribe-gpu/main.py` or its Python dependency
  resolution (`fastapi`, `faster_whisper`, `uvicorn`, `deep_translator` import
  errors are a local dev-environment/dependency issue, unrelated to this
  frontend change, per the plan's own Notes section).
- Consolidating `AutoCaptionPanel`'s new clip-transcription logic with
  `InspectorPanel.handleGenerateSubtitles` into a shared hook/utility.
- `TranscriptionJobStore` / job-poller / status-badge work described in
  `docs/spec/audio-analysis-subtitles.md` §5.3–5.7 — that describes a larger,
  separate orchestrator-based async job architecture not present in the
  current codebase and not required by this plan.
- Adding cancel/abort support for in-flight clip transcription (`transcribeClip`
  has no cancellation token today).

## 8. Acceptance Criteria

- [ ] `AutoCaptionPanel` offers a mode selector between "Selected Clip" and
      "Microphone Recording".
- [ ] With a single audio/video clip selected, panel defaults to
      "Selected Clip" mode and "Generate Captions" is enabled.
- [ ] Clicking Generate in selected-clip mode invokes
      `TranscriptionService.transcribeClip` with the selected clip + its
      media item, streams progress, and adds returned subtitles via
      `addSubtitle`, applying the chosen style preset if non-default.
- [ ] Non-audio/video clip selections, no-selection, and missing-media cases
      each render the specified guidance/disabled state without crashing.
- [ ] Microphone recording mode (`handleStartTranscription`/
      `handleStopTranscription`/`handleApplySegments`) is unchanged and still
      passes its (new) regression tests.
- [ ] New unit tests in `AutoCaptionPanel.test.tsx` cover all cases in §5 and
      pass under `pnpm --filter @openreel/web test:run`.
- [ ] Manual browser verification per §6 completed and confirmed.
- [ ] No changes made to `infra/transcribe-gpu/main.py`.
