# Audio Analysis & Subtitles — Operational Spec

**Status:** Operational (derived from user directives)
**Date:** 2026-07-04
**Sources:**
- `docs/spec/OPERATIONAL-SPEC-UPDATE-SUMMARY.md` §17
- `docs/superpowers/plans/spec-update/openreel-spec-implications-report.json` (Audio Analysis / Subtitles category)
- `docs/superpowers/plans/2026-07-03-audio-analysis-and-selection.md`
- `docs/superpowers/plans/2026-07-03-section-identification-flow.md`
- `docs/superpowers/plans/2026-07-03-subtitle-track-clip-type.md`
- `docs/superpowers/plans/2026-07-03-audio-auto-subtitle-extraction.md`

---

## 1. Scope

This spec covers two interrelated subsystems:

1. **Audio Analysis** — a pipeline that extracts genre, beat grid, energy curve, and section-aligned sentiment from audio files, with a UI for reviewing and selectively applying results to the timeline.
2. **Subtitles** — a first-class track/clip type for subtitle rendering and editing, plus automatic subtitle extraction from imported audio via a GPU transcription service.

These subsystems intersect at **section identification**: audio analysis provides energy boundaries and sentiment curves; lyric repetition and song-form heuristics produce section candidates; confirmed sections feed into storyboard generation as hard structural input.

---

## 2. Audio Analysis Pipeline

### 2.1 Service Architecture

The audio analysis pipeline MUST use a Python FastAPI microservice (`infra/audio-analysis/`) that runs librosa-based analysis. The Express orchestrator MUST proxy requests to this service and cache results per media item.

```
Audio file → orchestrator POST /api/analyze/audio → Python service → AudioAnalysisResult JSON
```

The Python service MUST expose:
- `POST /analyze` — accepts multipart audio upload, returns `{ jobId, status }`
- `GET /jobs/{jobId}` — returns job status and result
- `GET /health` — returns `{ ok: true, librosa_version }`

The orchestrator MUST:
- Accept `POST /api/analyze/audio` with multipart audio
- Forward to the Python service
- Cache results keyed by SHA-256 hash of the audio file
- Return cached results on subsequent requests for the same file
- Poll the Python service job endpoint (up to 30s timeout) for async results

### 2.2 Analysis Dimensions

The `AudioAnalysisResult` type MUST include the following dimensions:

| Dimension | Type | Description |
|---|---|---|
| `bpm` | `number` | Detected tempo from librosa beat tracker |
| `beatConfidence` | `number` (0–1) | Confidence of beat detection |
| `beats` | `BeatMarker[]` | Array of `{ time, strength, index, isDownbeat }` |
| `energy` | `number` (0–1) | Overall RMS energy, normalized |
| `energyCurve` | `EnergyFrame[]` | Per-frame energy values `{ timeSeconds, value }` |
| `genre` | `GenreResult` | `{ label, confidence }` — heuristic from MFCC + tempo |
| `mood` | `SentimentResult` | `{ label, confidence }` — spectral-feature heuristic |
| `sentiment` | `SentimentResult` | `{ label, confidence }` — tempo + mood heuristic |
| `sections` | `SongSectionBoundary[]` | Onset-detection boundaries `{ timeSeconds, label?, confidence }` |
| `duration` | `number` | Audio duration in seconds |
| `analyzedAt` | `number` | Unix timestamp of analysis |

### 2.3 MediaMetadata Extensions

`MediaMetadata` MUST be extended with the following optional fields:

```typescript
readonly genre?: string;
readonly mood?: string;
readonly energy?: number;                          // 0..1
readonly energyCurve?: readonly EnergyFrame[];
readonly sectionSentiment?: readonly SectionSentimentFrame[];
readonly analysisConfidence?: {
  readonly genre?: number;
  readonly mood?: number;
  readonly sentiment?: number;
  readonly energy?: number;
  readonly beat?: number;
};
readonly audioAnalyzedAt?: number;
```

### 2.4 Sentiment as Time-Series

Sentiment MUST NOT be stored as a single media-level label. It MUST be stored as a time-series of `SectionSentimentFrame` values, each keyed by section ID and bounded by section `startSeconds`/`endSeconds`:

```typescript
interface SectionSentimentFrame {
  sectionId: string;
  startSeconds: number;
  endSeconds: number;
  sentiment: "positive" | "negative" | "neutral" | "mixed" | "tense" | "uplifting" | "melancholic";
  confidence: number;
}
```

Sentiment frames SHOULD align with the start and end of repeated lyric sections (choruses). The audio analysis service MAY compute raw sentiment windows, but the frontend/store contract MUST persist them as `SectionSentimentFrame[]` keyed by section ID.

### 2.5 Frontend Bridge

A frontend `AudioAnalysisBridge` (singleton, subscribable) MUST manage analysis state, following the `BeatSyncBridge` pattern exactly. It MUST provide:

- `analyzeAudio(blob, mediaId?)` → `AudioAnalysisResult`
- `clearAnalysis()`
- `applyGenre(mediaId, genre)`, `applyBeats(mediaId, beats)`, `applyEnergy(mediaId, energyCurve)`
- `subscribe(listener)` → unsubscribe function

### 2.6 Store Actions

The project store MUST provide:

- `analyzeAudio(mediaId)` — triggers analysis via the bridge, stores raw results on `MediaMetadata`
- `applyAudioAnalysis(mediaId, selection: AnalysisSelection)` — selectively applies analysis dimensions to the timeline:
  - `applyBeats` → sets `timeline.beatMarkers` and `timeline.beatAnalysis`
  - `applyEnergy` → sets `timeline.audioAnalysis.energyData`
  - `applySections` → sets `timeline.audioAnalysis.sectionMarkers`
  - Genre/mood/sentiment → updates `MediaMetadata`

### 2.7 UI: Analysis Display and Apply Controls

The clip inspector's `AudioTab` MUST include an `AudioAnalysisSection` that shows:
- Analysis status (not analyzed / analyzing / complete)
- "Analyze Audio" button when no analysis exists
- Results display: genre, mood, sentiment, energy, BPM, beat count, section count
- Per-dimension "Apply" buttons: Apply to Clip, Apply to Timeline

The asset inspector's `AudioTab` MUST be extended with analysis trigger and results display.

A timeline `EnergyMarkerOverlay` MUST render the energy curve as a colored gradient bar above tracks, plus section markers as labeled vertical lines in the ruler area.

---

## 3. Section Identification Flow

### 3.1 Evidence Sources

Section identification MUST combine up to four evidence sources:

1. **Lyric repetition** — repeated or partially repeated lyric blocks detected as likely choruses/refrains
2. **Song-form heuristics** — typical pop-song structure (intro → verse → prechorus → chorus → verse → chorus → bridge → outro) applied as a skeleton when no lyrics are available
3. **Energy boundaries** — audio energy jumps from librosa onset detection, snapping section boundaries within ±4 seconds when confidence ≥ 0.65
4. **Optional lyrics file** — user-provided `.txt`, `.lrc`, or `.srt` file parsed into timed lyric lines

### 3.2 Domain Types

The `@openreel/music-video-domain` package MUST define:

```typescript
type SongSectionKind =
  | "intro" | "verse" | "prechorus" | "chorus"
  | "bridge" | "breakdown" | "drop" | "solo"
  | "outro" | "unknown";

interface SectionEvidence {
  kind: "lyric-repetition" | "song-form" | "energy-boundary" | "manual" | "lyrics-file";
  confidence: number;
  note: string;
}

interface EditableSongSection {
  id: string;
  name: string;
  kind: SongSectionKind;
  startSeconds: number;
  endSeconds: number;
  color: string;
  confidence: number;
  confirmed: boolean;
  evidence: SectionEvidence[];
}

interface SectionAnalysisResult {
  status: "needs-confirmation" | "confirmed";
  sections: EditableSongSection[];
}
```

### 3.3 Inference Functions

The `sections.ts` module MUST export:

- `inferSectionsFromLyrics(lines, durationSeconds)` — identifies repeated lyric blocks, labels them as choruses, pads boundaries (±4s start, +8s end)
- `inferSongSections({ durationSeconds, lyrics?, energyBoundaries? })` — merges lyric-derived sections with song-form skeleton and snaps to energy boundaries
- `buildSongFormSkeleton(durationSeconds)` — produces a conservative pop-song structure for songs > 90s:
  - Intro: 0–8%, Verse 1: 8–25%, Prechorus 1: 25–34%, Chorus 1: 34–50%, Verse 2: 50–64%, Chorus 2: 64–80%, Bridge/Breakdown: 80–90%, Outro: 90–100%

### 3.4 Confirmation Requirement

Sections inferred by the system MUST NOT be silently accepted for storyboard generation. The user MUST confirm or edit sections first.

The `SectionConfirmationPanel` MUST:
- Display the section list sorted by `startSeconds`
- Show evidence badges (lyrics, energy, song form, manual)
- Show confidence percentage per section
- Provide inline name/kind dropdown with sequential naming (Verse 1, Verse 2, Chorus 1, etc.)
- Disable the "Confirm sections" button when sections overlap or have invalid duration
- Only fire `onConfirmed` after explicit user confirmation

### 3.5 Store State

The music-video store MUST provide:

- `setInferredSections(projectId, sections)` — stores sections as unconfirmed
- `updateSectionBoundary(projectId, sectionId, startSeconds, endSeconds)` — edits one section
- `splitSection(projectId, sectionId, splitSeconds)` — creates two sections from one
- `renameSection(projectId, sectionId, kind, name)` — changes section kind and name
- `confirmSections(projectId)` — marks all sections confirmed, sets status to `"confirmed"`

### 3.6 Section Meta-Track

A `SectionMetaTrack` component MUST render sections as an arranger-style meta-track above timeline lanes:

- 28px-high horizontal track above normal tracks
- Colored blocks by section `color` (intro/outro: slate, verse: blue, prechorus: purple, chorus: orange, bridge: teal, breakdown: red, drop: green, solo: yellow, unknown: gray)
- Start/end drag handles for boundary adjustment
- Split button at cursor/time via context menu or inline control
- Smart section-name dropdown with sequential names
- Rendered when the active music-video project has `sectionAnalysis.sections.length > 0`

### 3.7 Lyrics File Input

The storyboard generation dialog MUST include an optional lyrics file input. Supported formats: `.txt`, `.lrc`, `.srt`. Parsed lyrics feed into `inferSongSections` before confirmation.

The storyboard configuration pane MUST include an "Upload lyrics" action that re-runs section inference while preserving manually confirmed sections unless the user chooses "Replace sections."

### 3.8 Feeding Confirmed Sections into Storyboard

Storyboard create and alter LLM calls MUST receive confirmed sections as hard timing/structure input. The request payload MUST include `confirmedSections: EditableSongSection[]`.

The orchestrator MUST reject generation requests when no confirmed sections exist:

```typescript
if (!body.confirmedSections?.length || body.confirmedSections.some(s => !s.confirmed)) {
  return res.status(400).json({ error: "Confirm song sections before generating storyboard" });
}
```

The LLM prompt MUST include the rule: "You must preserve the provided section boundaries. Create shots that start/end inside these sections unless explicitly instructed otherwise. Chorus sections should usually contain repeated visual motifs or returning imagery."

---

## 4. Subtitles as First-Class Track/Clip Type

### 4.1 SubtitleClip Type

Subtitles MUST be stored as clips on `"subtitle"` tracks, NOT as a flat `Timeline.subtitles` array. The `SubtitleClip` type MUST extend `Clip` with subtitle-specific data:

```typescript
interface SubtitleClipData {
  text: string;                              // SRT caption text (may contain \n)
  style: SubtitleStyle;                      // font, size, color, background, position
  words?: SubtitleWord[];                    // per-word timing for animated captions
  animationStyle?: CaptionAnimationStyle;    // karaoke, typewriter, etc.
  sourceMediaId?: string;                    // source SRT media item ID
}
```

The `Clip` interface MUST include an optional `subtitleData?: SubtitleClipData` property. This avoids breaking all existing clip consumers while allowing subtitle-specific rendering and editing.

### 4.2 Track Type

The `Track.type` union MUST include `"subtitle"`. Subtitle tracks MUST accept clips with `subtitleData` populated. The `canAcceptMediaType` function MUST route `"srt"` media type to `"subtitle"` tracks.

### 4.3 SubtitleClipManager

A `SubtitleClipManager` class MUST provide CRUD operations on subtitle clips within tracks:

- `createClip(params)` — creates a `SubtitleClip` on a subtitle track
- `updateText(tracks, clipId, text)` — updates subtitle text
- `updateStyle(tracks, clipId, style)` — merges partial style
- `updateTiming(tracks, clipId, startTime, duration)` — adjusts timing
- `removeClip(tracks, clipId)` — removes a subtitle clip
- `getClipAtTime(tracks, time)` — finds active subtitle at a given time
- `getClipsInRange(tracks, startTime, endTime)` — finds subtitles in a time range
- `importSRTToTrack(tracks, trackId, srtContent)` — parses SRT into subtitle clips
- `exportSRTFromTrack(tracks, trackId)` — generates SRT from subtitle clips

### 4.4 Store Migration

The project store MUST be migrated from the flat `Timeline.subtitles` array to subtitle clips on tracks:

- `addSubtitle` MUST create a `SubtitleClip` on a `"subtitle"` track (remove the `"text"` track fallback)
- `removeSubtitle` MUST remove the clip from its track
- `updateSubtitle` MUST delegate to `SubtitleClipManager.updateText`/`updateStyle`
- `importSRT` MUST delegate to `SubtitleClipManager.importSRTToTrack`
- `exportSRT` MUST delegate to `SubtitleClipManager.exportSRTFromTrack`
- `applySubtitleStylePreset` MUST iterate over all subtitle clips on subtitle tracks

A one-time migration MUST convert existing projects with the old `timeline.subtitles` format on load.

### 4.5 Timeline Rendering

A `SubtitleClipComponent` MUST render subtitle clips on the timeline:

- Display truncated subtitle text on the clip block (rose palette, subtitle icon, "S" badge)
- Show speaker/music note icon for animated captions
- Support trim handles (left/right edge drag) for timing adjustment
- Support click-to-select
- Show multi-line text preview when tall enough
- Context menu: delete, split, change style preset

`TrackLane` MUST route subtitle clips on `"subtitle"` tracks to `SubtitleClipComponent`.

### 4.6 Preview Rendering

The Preview component MUST read subtitle data from subtitle track clips, NOT from `timeline.subtitles`. The `getActiveSubtitleClips` function MUST filter clips by `currentTime >= clip.startTime && currentTime < clip.startTime + clip.duration`. The existing `renderSubtitleToCanvas` pipeline MUST accept `SubtitleClip` data (fields are compatible: `text`, `style`, `words`, `animationStyle`).

### 4.7 Export Rendering

The `ExportEngine` MUST compute max duration from subtitle track clips and render subtitles during video export using the same canvas rendering pipeline as the preview.

### 4.8 Subtitle Inspector

A `SubtitleInspectorPanel` MUST provide editing controls when a subtitle clip is selected:

- Text editor (textarea) for multi-line subtitle text
- Style preset dropdown (reuses `SUBTITLE_STYLE_PRESETS` from core)
- Font family, size, color, background color, position controls
- Animation style selector (reuses `CaptionAnimationStyle`)
- Timing preview (non-editable; trim via timeline)
- Split, delete, and export-to-SRT buttons

### 4.9 SRT File Drop

Dropping an SRT file onto the timeline MUST create a new subtitle track (or add to an existing one) with subtitle clips parsed from the SRT content. Dropping onto a non-subtitle track or empty area MUST create a new subtitle track.

### 4.10 Deprecation of Flat Subtitle Array

Once all consumers are migrated, the `Timeline.subtitles` array MUST be removed. The `SubtitleEngine` methods that operate on the flat array MUST be deprecated. `parseSRT`/`exportSRT` MUST be retained as standalone utility functions.

---

## 5. Audio Auto-Subtitle Extraction

### 5.1 Trigger

When a user imports an audio file (MP3, WAV, AAC, OGG, FLAC) into the media library, the system MUST automatically kick off an async transcription job. The audio import itself MUST complete successfully regardless of transcription outcome.

### 5.2 Transcription Service

The orchestrator MUST proxy transcription requests to the existing `infra/transcribe-gpu/` service (Whisper/faster-whisper):

- `POST /api/transcribe` — accepts multipart audio upload, returns `{ jobId, status }`
- `GET /api/transcribe/:jobId` — returns job status, progress, and result

The orchestrator MUST NOT store transcription state — it is a pure proxy.

### 5.3 TranscriptionJobStore

A Zustand `TranscriptionJobStore` MUST track transcription jobs per media item, following the `generation-job-store.ts` pattern:

| State | Description |
|---|---|
| `queued` | Job created, awaiting submission |
| `transcribing` | Job submitted, polling for completion |
| `completed` | Transcription finished, result available |
| `failed` | Transcription failed, error stored |

The store MUST provide:
- `createJob(mediaId, jobId)` — creates a job in `"queued"` state
- `startJob(mediaId)` — transitions to `"transcribing"`
- `updateProgress(mediaId, progress)` — updates progress percentage
- `completeJob(mediaId, result)` — transitions to `"completed"` with result
- `failJob(mediaId, error)` — transitions to `"failed"` with error message
- `getJob(mediaId)` — returns job or `undefined`
- `getJobsByStatus(status)` — returns jobs filtered by status
- `clearCompleted()` — removes completed jobs
- `retryJob(mediaId)` — resets a failed job to `"queued"` for re-submission

Only completed jobs MUST survive page reload (persistence partialize). Calling `createJob` twice for the same `mediaId` MUST overwrite the old entry.

### 5.4 Transcription Client

A `transcription-client.ts` service module MUST handle communication with the orchestrator:

- `submitAudio(blob, fileName, language?, targetLanguage?)` — POSTs multipart form, returns `{ jobId, status }`
- `pollJob(jobId)` — GETs job status, returns `{ jobId, status, progress?, result?, error? }`

### 5.5 Job Polling

A `useTranscriptionJobPoller` hook MUST poll all active (`"transcribing"`) jobs every 3 seconds. It MUST be mounted at the app root alongside `useGenerationJobPoller`.

On completion, the poller MUST:
1. Store the raw result in the job store
2. Group Whisper word-timed results into subtitle segments
3. Auto-import segments as subtitle clips on a subtitle track

Transient network errors during polling MUST log a warning but NOT transition the job to failed — polling continues.

### 5.6 Word Grouping into Subtitle Segments

Whisper returns word-by-word timestamps. These MUST be grouped into subtitle segments using the following heuristic:

- A new segment is started when the gap between consecutive words exceeds 0.5 seconds, OR
- The current segment would exceed 20 words

Each segment MUST include:
- `text` — joined words
- `startTime` — first word's start time
- `endTime` — last word's end time
- `words` — array of `SubtitleWord` objects for per-word highlighting

Auto-imported subtitles MUST use `animationStyle: "word-highlight"` for karaoke-style highlighting.

### 5.7 Status Display

Audio media items in the Assets panel MUST show a transcription status badge:

| Job Status | Badge |
|---|---|
| `transcribing` | Spinning loader + progress percentage |
| `completed` | Green check + "SRT" label |
| `failed` | Red error icon + "Failed" label (clickable to retry) |

Video and image items MUST never show transcription badges. No badge MUST be shown for audio items without a transcription job.

### 5.8 Error Handling

A failed transcription MUST NOT remove the audio from the media library. The failed badge MUST show the error message in a tooltip. Clicking a failed badge MUST trigger a retry: reset to `"queued"`, re-submit audio, create a new backend job. Retrying a completed or non-existent job MUST be a no-op.

---

## 6. Timeline Integration Types

The `Timeline` interface MUST be extended with:

```typescript
interface Timeline {
  // ... existing fields
  readonly audioAnalysis?: TimelineAudioAnalysis;
}

interface TimelineAudioAnalysis {
  readonly genre?: string;
  readonly mood?: string;
  readonly sentiment?: string;
  readonly energy: number;
  readonly energyData?: TimelineEnergyData;
  readonly sectionMarkers?: TimelineSectionMarker[];
  readonly sourceMediaId?: string;
  readonly analyzedAt: number;
}

interface TimelineEnergyData {
  readonly frames: TimelineEnergyMarker[];
  readonly overall: number;
  readonly sourceMediaId?: string;
  readonly analyzedAt: number;
}

interface TimelineEnergyMarker {
  readonly time: number;
  readonly value: number;   // 0..1
  readonly index: number;
}

interface TimelineSectionMarker {
  readonly time: number;
  readonly label: string;
  readonly confidence: number;
}
```

---

## 7. Open Questions

- TODO: What port should the Python audio-analysis service default to? Plan uses `8001` (Whisper uses `8000`).
- TODO: Should "Apply Beat Markers" replace or merge with existing timeline beat markers? v1 replaces entirely.
- TODO: Energy overlay rendering: gradient bar (Option A) vs. per-frame colored lines (Option B)? Plan follows Option A.
- TODO: Genre classifier uses simple heuristics (MFCC + tempo thresholds) rather than a trained model. Future: swap in ONNX model (musiCNN, VGGish).
- TODO: Word grouping heuristic (0.5s gap, 20 word max) may need tuning after user feedback for fast/slow speech.
- TODO: Transcription for persisted projects with existing audio (where `MediaItem.blob` is null) needs a different trigger mechanism.
- TODO: Chunked upload or streaming for very long audio files (>1 hour) as future optimization.
