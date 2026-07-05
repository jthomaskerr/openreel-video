# Audio Analysis & Subtitles — Operational Spec

**Status:** Operational (canonical source of truth for audio analysis, subtitles, and auto-transcription)
**Date:** 2026-07-04
**Last aligned:** 2026-07-05
**Sources:**
- [Operational Spec Update Summary](./OPERATIONAL-SPEC-UPDATE-SUMMARY.md) §17
- [OpenReel Spec Implications report](../superpowers/plans/spec-update/openreel-spec-implications-report.json) (Audio Analysis / Subtitles category)
- [Audio Analysis & Selection plan](../superpowers/plans/2026-07-03-audio-analysis-and-selection.md)
- [Section Identification Flow plan](../superpowers/plans/2026-07-03-section-identification-flow.md)
- [Subtitle Track/Clip Type plan](../superpowers/plans/2026-07-03-subtitle-track-clip-type.md)
- [Audio Auto-Subtitle Extraction plan](../superpowers/plans/2026-07-03-audio-auto-subtitle-extraction.md)

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

## 7. Related Operational Specs

- [Sections Identification spec](./sections-identification.md) owns the detailed `SongSection` / section-confirmation workflow. This spec only defines how audio analysis supplies energy boundaries and section-aligned sentiment into that flow.
- [Storyboard spec](./storyboard.md) owns the storyboard-generation and alteration behavior that consumes confirmed sections.
- [Export spec](./export.md) owns final render/export behavior and MUST render subtitles from subtitle track clips.
- [Backend, Persistence & Versioning spec](./backend-persistence-versioning.md) owns project persistence, project version history, and backend-first restore semantics for timeline data.

---

## 8. Consolidated Detailed Contracts

This section consolidates the former standalone subtitle specs. The files `audio-auto-subtitle-extraction.md` and `subtitle-track-clip-type.md` are retained only as compatibility redirects; they do not contain independent normative requirements.

### 8.1 Subtitle Track/Clip Type Contract

**Version:** 1.0
**Status:** Specification (Implementation planned)
**Last Updated:** 2026-07-04
**Source Plan:** [Subtitle Track/Clip Type plan](../superpowers/plans/2026-07-03-subtitle-track-clip-type.md)

---

#### Executive Summary

This specification defines the replacement of the current workaround subtitle system (flat `Timeline.subtitles` array + hijacked `TextClip` instances) with a first-class `SubtitleClip` type integrated into the standard clip/track model. The new system provides dedicated timeline rendering, editing UI, persistence, and export support for subtitles as proper timeline objects.

**Key Changes:**
- Introduce `SubtitleClip` as a clip type on `"subtitle"` tracks
- Migrate all subtitle data from the flat `timeline.subtitles` array into clip instances
- Create `SubtitleClipManager` for clip CRUD operations
- Provide dedicated `SubtitleClipComponent` for timeline rendering
- Implement `SubtitleInspectorPanel` for editing
- Migrate preview and export rendering to use clip-based subtitles
- Implement migration path for legacy projects

---

#### 1. Domain Model

##### 1.1 SubtitleClip Type

**File:** `packages/core/src/types/subtitle-clip.ts` (NEW)

The `SubtitleClip` interface extends the base `Clip` type and represents a subtitle/caption that may contain multiple words with timing data for animated playback.

```typescript
export interface SubtitleClip extends Clip {
  /** Discriminant for clip type union */
  readonly type?: "subtitle-clip";

  /** Subtitle text content (may contain \n for multi-line) */
  readonly text: string;

  /** Style properties: font, color, background, position, etc. */
  readonly style: SubtitleStyle;

  /** Per-word timing data for animated captions (karaoke, typewriter) */
  readonly words?: SubtitleWord[];

  /** Animation style to apply to this subtitle */
  readonly animationStyle?: CaptionAnimationStyle;

  /** Optional reference to source SRT media item */
  readonly sourceMediaId?: string;
}
```

**Field Semantics:**
- `text`: May contain literal newlines for multi-line captions; rendering splits on `\n`
- `style`: Reuses existing `SubtitleStyle` from core (font family, size, color, background, position preset)
- `words`: Optional array of `SubtitleWord[]` with start time and duration for each word, enabling word-by-word animation
- `animationStyle`: One of the standard `CaptionAnimationStyle` values (e.g., "karaoke", "typewriter", "fade")
- `sourceMediaId`: If the clip was created from an SRT media item, this field references that item for future re-sync or source tracking

**Inheritance from Clip:**
- `id: string` — unique clip identifier
- `mediaId?: string` — optional reference to media item
- `trackId: string` — ID of the subtitle track containing this clip
- `startTime: number` — absolute time (seconds) where the clip begins
- `duration: number` — length of the subtitle display (seconds)
- `metadata?: Record<string, any>` — optional user-defined metadata

##### 1.2 Track and Timeline Integration

**Files Modified:**
- `packages/core/src/types/timeline.ts`
- `packages/core/src/types/index.ts`

**Changes:**

1. **Clip Discriminated Union:** Add `SubtitleClip` to the `Clip` union. The existing `Clip` interface MAY include an optional `subtitleData?: SubtitleClipData` field to avoid breaking changes, OR use a strict discriminated union approach.

   **Recommended approach (non-breaking):**
   ```typescript
   export interface Clip {
     // ... existing fields
     readonly subtitleData?: {
       text: string;
       style: SubtitleStyle;
       words?: SubtitleWord[];
       animationStyle?: CaptionAnimationStyle;
       sourceMediaId?: string;
     };
   }
   ```

2. **Track type support:** The `Track` type already includes `type: "subtitle"` as a valid track type. No change needed; confirm `canAcceptMediaType("subtitle", "srt")` returns true.

3. **Deprecation marker:** Add JSDoc `@deprecated` annotation to `Timeline.subtitles` field (line 7 of `timeline.ts`). This field MUST be migrated away during load but remains for backward compatibility.

   ```typescript
   /**
    * @deprecated Use SubtitleClips on "subtitle" tracks instead.
    * This field is maintained for backward compatibility during migration.
    */
   readonly subtitles: Subtitle[];
   ```

---

#### 2. Subtitle Clip Management

##### 2.1 SubtitleClipManager

**File:** `packages/core/src/timeline/subtitle-clip-manager.ts` (NEW)

The `SubtitleClipManager` provides factory, CRUD, and bulk operations for subtitle clips on tracks.

###### 2.1.1 Creation

```typescript
export interface CreateSubtitleClipParams {
  /** ID of the subtitle track to add to */
  trackId: string;

  /** Subtitle text content */
  text: string;

  /** Absolute start time in seconds */
  startTime: number;

  /** Display duration in seconds; defaults to 5 if omitted */
  duration?: number;

  /** Partial style override; merged with track default or preset */
  style?: Partial<SubtitleStyle>;

  /** Animation style for word-by-word playback */
  animationStyle?: CaptionAnimationStyle;

  /** Per-word timing data */
  words?: SubtitleWord[];

  /** Source SRT media item ID (if imported) */
  mediaId?: string;
}

export class SubtitleClipManager {
  /**
   * Create a new subtitle clip on the specified track.
   * Validates startTime >= 0 and duration > 0.
   * Assigns a unique ID and applies defaults.
   *
   * @param params Creation parameters
   * @param tracks Current timeline tracks (to validate track exists)
   * @returns Success: { track, clip } | Error: { error: string }
   */
  createClip(
    params: CreateSubtitleClipParams,
    tracks: Track[]
  ): { track: Track; clip: SubtitleClip } | { error: string };

  /**
   * Update the text content of a subtitle clip.
   *
   * @param tracks Timeline tracks
   * @param clipId Clip to update
   * @param text New text content
   * @returns Updated tracks array
   */
  updateText(tracks: Track[], clipId: string, text: string): Track[];

  /**
   * Update or merge style properties of a subtitle clip.
   *
   * @param tracks Timeline tracks
   * @param clipId Clip to update
   * @param style Partial style override (merged with existing)
   * @returns Updated tracks array
   */
  updateStyle(
    tracks: Track[],
    clipId: string,
    style: Partial<SubtitleStyle>
  ): Track[];

  /**
   * Update timing (start and duration) of a subtitle clip.
   * Validates new timing does not overlap with other clips on the same track.
   *
   * @param tracks Timeline tracks
   * @param clipId Clip to update
   * @param startTime New absolute start time
   * @param duration New display duration
   * @returns Updated tracks array
   */
  updateTiming(
    tracks: Track[],
    clipId: string,
    startTime: number,
    duration: number
  ): Track[];

  /**
   * Remove a subtitle clip from its track.
   *
   * @param tracks Timeline tracks
   * @param clipId Clip to remove
   * @returns Updated tracks array
   */
  removeClip(tracks: Track[], clipId: string): Track[];

  /**
   * Find the active subtitle clip at the given playback time.
   * Returns null if no clip is active.
   *
   * @param tracks Timeline tracks
   * @param time Current playback time (seconds)
   * @returns Active clip or null
   */
  getClipAtTime(tracks: Track[], time: number): SubtitleClip | null;

  /**
   * Find all subtitle clips that overlap the given time range.
   *
   * @param tracks Timeline tracks
   * @param startTime Range start (inclusive)
   * @param endTime Range end (exclusive)
   * @returns Array of overlapping clips
   */
  getClipsInRange(
    tracks: Track[],
    startTime: number,
    endTime: number
  ): SubtitleClip[];

  /**
   * Import SRT file content into a subtitle track, creating SubtitleClip instances.
   * Parses SRT format and creates clips at the extracted timings.
   *
   * TODO: Specify SRT parsing behavior for edge cases (overlapping entries, malformed times)
   *
   * @param tracks Timeline tracks
   * @param trackId Target subtitle track
   * @param srtContent Raw SRT file content
   * @returns { tracks, errors } where errors is a list of parse/validation errors (non-fatal)
   */
  importSRTToTrack(
    tracks: Track[],
    trackId: string,
    srtContent: string
  ): { tracks: Track[]; errors: string[] };

  /**
   * Export subtitle clips from a subtitle track as valid SRT format.
   * Generates SRT with entry numbers, timecodes, and text in standard format.
   *
   * @param tracks Timeline tracks
   * @param trackId Source subtitle track
   * @returns SRT-formatted string
   */
  exportSRTFromTrack(tracks: Track[], trackId: string): string;
}
```

**Export:** `packages/core/src/timeline/index.ts` re-exports `SubtitleClipManager`.

**Constraints:**
- `startTime` MUST be >= 0
- `duration` MUST be > 0
- Each clip MUST have a unique `id` (auto-generated)
- Clips with the same track ID SHOULD NOT overlap (validation required)

---

#### 3. Store Actions and Persistence

##### 3.1 Project Store Subtitle Actions

**Files Modified:**
- `apps/web/src/stores/project-store.ts`
- `apps/web/src/stores/project/subtitle-helpers.ts`
- `apps/web/src/stores/project/types.ts`

**Changes:**

All subtitle operations MUST be rewritten to delegate to `SubtitleClipManager` and operate on clips on `"subtitle"` tracks, not the flat `timeline.subtitles` array.

###### 3.1.1 addSubtitle

```typescript
/**
 * Create a new SubtitleClip on the "Captions" subtitle track.
 * If no subtitle track exists, create one.
 * If a "Captions" subtitle track does not exist, find one or create it.
 *
 * @param text Subtitle text
 * @param startTime Absolute start time (seconds)
 * @param duration Display duration (seconds)
 * @param style Optional style override
 */
addSubtitle(
  text: string,
  startTime: number,
  duration?: number,
  style?: Partial<SubtitleStyle>
): void;
```

**Implementation requirements:**
1. Find or create a subtitle track named "Captions" (type = `"subtitle"`)
2. Call `SubtitleClipManager.createClip()` with the provided parameters
3. Do NOT create a text clip as a workaround; use only subtitle clips
4. Update undo/redo stack

###### 3.1.2 removeSubtitle

```typescript
/**
 * Remove a SubtitleClip by ID.
 * Deletes the clip from its subtitle track.
 *
 * @param clipId Subtitle clip ID
 */
removeSubtitle(clipId: string): void;
```

**Implementation requirements:**
1. Find the clip in any subtitle track
2. Call `SubtitleClipManager.removeClip()`
3. Update undo/redo stack

###### 3.1.3 updateSubtitle

```typescript
/**
 * Update a SubtitleClip's text, timing, and/or style.
 *
 * @param clipId Clip ID to update
 * @param updates Partial update object { text?, startTime?, duration?, style? }
 */
updateSubtitle(
  clipId: string,
  updates: {
    text?: string;
    startTime?: number;
    duration?: number;
    style?: Partial<SubtitleStyle>;
  }
): void;
```

**Implementation requirements:**
1. Find the clip
2. Call appropriate manager methods (`updateText`, `updateStyle`, `updateTiming`)
3. Update undo/redo stack

###### 3.1.4 importSRT

```typescript
/**
 * Import SRT file content into a subtitle track.
 * Creates SubtitleClip instances for each SRT entry.
 *
 * @param srtContent Raw SRT file content
 * @param trackId Optional target track; creates "Captions" track if omitted
 * @returns { clipCount, errors }
 */
importSRT(srtContent: string, trackId?: string): { clipCount: number; errors: string[] };
```

**Implementation requirements:**
1. Find or create subtitle track named "Captions"
2. Call `SubtitleClipManager.importSRTToTrack()`
3. Collect and report any parse errors (non-fatal)
4. Update undo/redo stack

###### 3.1.5 exportSRT

```typescript
/**
 * Export SubtitleClips from a subtitle track as SRT format.
 *
 * @param trackId Subtitle track to export
 * @returns SRT-formatted string
 */
exportSRT(trackId: string): string;
```

**Implementation requirements:**
1. Delegate to `SubtitleClipManager.exportSRTFromTrack()`
2. Return SRT-formatted output suitable for file download

###### 3.1.6 applySubtitleStylePreset

```typescript
/**
 * Apply a style preset to all SubtitleClips on subtitle tracks.
 *
 * @param presetName Name of preset (e.g., "default", "white-outline", "yellow-bg")
 */
applySubtitleStylePreset(presetName: string): void;
```

**Implementation requirements:**
1. Locate all subtitle clips across all subtitle tracks
2. For each clip, call `SubtitleClipManager.updateStyle()` with the preset style
3. Update undo/redo stack

##### 3.2 Backward Compatibility and Migration

**File:** `apps/web/src/stores/project-store.ts` (loadProject)

On project load, check for the legacy subtitle format and migrate:

```typescript
private migrateSubtitles(project: Project): Project {
  const timeline = project.timeline;

  // Only migrate if old flat array has data
  if (!timeline.subtitles || timeline.subtitles.length === 0) {
    return project;
  }

  // Ensure subtitle track exists
  const subtitleTrack = this.ensureSubtitleTrack(timeline);

  // Convert each old Subtitle to SubtitleClip
  const manager = new SubtitleClipManager();
  for (const oldSub of timeline.subtitles) {
    const clipParams: CreateSubtitleClipParams = {
      trackId: subtitleTrack.id,
      text: oldSub.text,
      startTime: oldSub.startTime,
      duration: oldSub.duration,
      style: oldSub.style,
      animationStyle: oldSub.animationStyle,
      words: oldSub.words,
      sourceMediaId: oldSub.mediaId,
    };
    const result = manager.createClip([subtitleTrack], clipParams);
    if (!("error" in result)) {
      subtitleTrack.clips.push(result.clip);
    }
  }

  // Clear deprecated field
  timeline.subtitles = [];

  return project;
}
```

**Also handle legacy text clips on subtitle tracks:**

During migration, any `TextClip` on a `"subtitle"` track SHOULD be converted to `SubtitleClip`. Add a check:

```typescript
// After clip migration from flat array, scan tracks for orphaned text clips
for (const track of timeline.tracks) {
  if (track.type === "subtitle") {
    // Convert any TextClip to SubtitleClip
    track.clips = track.clips.map(clip => {
      if (clip.type === "text-clip") {
        return convertTextClipToSubtitleClip(clip);
      }
      return clip;
    });
  }
}
```

**Deprecation Schedule:**
1. **Phase 1 (now):** Both formats accepted on load; legacy format automatically migrated
2. **Phase 2 (v2.x):** Remove migration code; reject projects with `timeline.subtitles`
3. **Phase 3 (v3.x):** Remove `Timeline.subtitles` field entirely

---

#### 4. Timeline UI Components

##### 4.1 SubtitleClipComponent

**File:** `apps/web/src/components/editor/timeline/SubtitleClipComponent.tsx` (NEW)

A dedicated timeline clip component for rendering subtitle clips with text preview, styling, and interaction.

```typescript
interface SubtitleClipComponentProps {
  /** The subtitle clip to render */
  clip: SubtitleClip;

  /** Pixels per second for positioning */
  pixelsPerSecond: number;

  /** Whether this clip is selected */
  isSelected: boolean;

  /** Callback when clip is clicked (with modifier key support) */
  onSelect: (clipId: string, addToSelection: boolean) => void;

  /** Callback when clip edge is dragged (trim) */
  onTrim: (clipId: string, edge: "left" | "right", newTime: number) => void;

  /** Callback when clip is dragged to a new start time */
  onMoveClip?: (clipId: string, newStartTime: number) => void;

  /** Optional context menu handler */
  onContextMenu?: (clipId: string, event: React.MouseEvent) => void;
}
```

**Rendering:**

The component MUST display:

1. **Visual container:** Rose/pink color palette (similar to TextClip, but distinct)
2. **Subtitle badge:** Small `"S"` or speaker icon in top-left corner
3. **Text preview:** First 1-2 lines of clip text, truncated to fit width
4. **Multi-line support:** If clip height is sufficient, show multiple lines
5. **Trim handles:** Left and right edge handles for time adjustment (drag to resize)
6. **Selection state:** Highlight (border/shadow) when selected
7. **Animation indicator:** Show an icon (e.g., musical note) if `animationStyle` is set

**Interactions:**

- **Click:** Call `onSelect(clipId, event.metaKey || event.ctrlKey)`
- **Drag left/right edge:** Call `onTrim(clipId, edge, newTime)`
- **Drag clip body:** Call `onMoveClip(clipId, newStartTime)`
- **Right-click:** Show context menu with options:
  - Delete
  - Split at playhead
  - Apply style preset
  - Export as SRT

**Styling:**

- Use rose palette (#F3B5C6, #F47DA1, #E1337C, etc.)
- Distinct from text clip styling (which uses blue/purple)
- Hover state: slightly lighter background, shadow
- Selected state: solid border in rose-600 or darker

##### 4.2 Timeline Track Integration

**File:** `apps/web/src/components/editor/timeline/TrackLane.tsx` (MODIFIED)

In the `TrackLane` component, add rendering for subtitle clips:

**Current behavior:** Routes all subtitle track clips through `TextClipComponent` as a workaround.

**New behavior:** Add a dedicated rendering branch for `SubtitleClip` instances:

```typescript
{track.type === "subtitle" &&
  track.clips
    .filter((clip): clip is SubtitleClip => hasSubtitleData(clip))
    .map((clip) => (
      <SubtitleClipComponent
        key={clip.id}
        clip={clip}
        pixelsPerSecond={pixelsPerSecond}
        isSelected={selectedClipIds.includes(clip.id)}
        onSelect={onSelectClip}
        onTrim={onTrimSubtitleClip}
        onMoveClip={onMoveClip}
        onContextMenu={handleClipContextMenu}
      />
    ))}
```

Where `hasSubtitleData(clip)` checks if `clip.subtitleData` exists or `clip.type === "subtitle-clip"`.

**Callback implementations:**

- `onTrimSubtitleClip`: Calls `SubtitleClipManager.updateTiming()`
- `onMoveClip`: Calls `SubtitleClipManager.updateTiming()` with new start time and same duration
- Context menu handler: Integrates with standard timeline context menu

##### 4.3 Timeline Trim Enablement

**File:** `apps/web/src/components/editor/Timeline.tsx`

Ensure that trim handles are enabled for subtitle track clips. In the trim handler (around line 1167), add `"subtitle"` to the list of trim-enabled track types:

```typescript
const isTrimEnabledTrack =
  track.type === "video" ||
  track.type === "image" ||
  track.type === "audio" ||
  track.type === "subtitle";
```

---

#### 5. Preview Rendering

##### 5.1 Preview Component Updates

**File:** `apps/web/src/components/editor/Preview.tsx` (MODIFIED)

**Current behavior:** Reads subtitles from two sources:
1. `project.timeline.subtitles` (flat array)
2. Text clips on `"subtitle"` tracks

**New behavior:** Read ONLY from subtitle clips on `"subtitle"` tracks.

**Change:**

Replace the memo that reads `allSubtitles` from the flat array:

```typescript
// OLD (remove):
const allSubtitles = useMemo(() => {
  return project.timeline.subtitles || [];
}, [project.timeline.subtitles]);

// NEW (add):
const allSubtitles = useMemo(() => {
  return project.timeline.tracks
    .filter((t) => t.type === "subtitle")
    .flatMap((t) => t.clips)
    .filter(isSubtitleClip);
}, [project.timeline.tracks]);
```

Define `isSubtitleClip(clip)`:

```typescript
function isSubtitleClip(clip: Clip): clip is SubtitleClip {
  return clip.subtitleData !== undefined || clip.type === "subtitle-clip";
}
```

**All call sites** that use `allSubtitles` (passed to `getActiveSubtitles()`, `renderSubtitleToCanvas()`, etc.) remain unchanged; they accept the same data.

##### 5.2 Canvas Renderer Updates

**File:** `apps/web/src/components/editor/preview/canvas-renderers.ts` (MODIFIED)

**Current behavior:** `getActiveSubtitles()` expects a flat `Subtitle[]` array and filters by `currentTime >= sub.startTime && currentTime < sub.endTime`.

**New behavior:** Add support for `SubtitleClip[]` which has timing on `clip.startTime` and `clip.startTime + clip.duration`.

**Add helper function:**

```typescript
export const getActiveSubtitleClips = (
  clips: SubtitleClip[],
  currentTime: number
): SubtitleClip[] => {
  return clips.filter((clip) =>
    currentTime >= clip.startTime &&
    currentTime < clip.startTime + clip.duration
  );
};
```

**Overload existing `getActiveSubtitles()`:**

```typescript
export function getActiveSubtitles(items: Subtitle[], time: number): Subtitle[];
export function getActiveSubtitles(items: SubtitleClip[], time: number): SubtitleClip[];
export function getActiveSubtitles(
  items: Subtitle[] | SubtitleClip[],
  time: number
): Subtitle[] | SubtitleClip[] {
  if (!items || items.length === 0) return [];

  // Detect type by checking for startTime + duration (clip) vs startTime + endTime (subtitle)
  const isCLips = "duration" in items[0];

  if (isClips) {
    return (items as SubtitleClip[]).filter((clip) =>
      time >= clip.startTime && time < clip.startTime + clip.duration
    );
  } else {
    return (items as Subtitle[]).filter((sub) =>
      time >= sub.startTime && time < sub.endTime
    );
  }
}
```

**Rendering functions:** `renderSubtitleToCanvas`, `renderStaticSubtitle`, `renderAnimatedSubtitle` already work with `{ text, style, words, animationStyle }` shape — no changes needed if `SubtitleClip` has the same fields.

---

#### 6. Export Rendering

##### 6.1 Export Engine Integration

**File:** `packages/core/src/export/export-engine.ts` (MODIFIED)

**Current behavior:** Duration calculation considers `timeline.subtitles` flat array (lines 1395–1400).

**Change 1: Duration calculation**

Update to consider subtitle track clips:

```typescript
// Instead of:
// const maxSubtitleEnd = Math.max(...timeline.subtitles.map(s => s.endTime), 0);

// Use:
let maxSubtitleEnd = 0;
for (const track of timeline.tracks) {
  if (track.type === "subtitle") {
    for (const clip of track.clips) {
      const end = clip.startTime + clip.duration;
      if (end > maxSubtitleEnd) maxSubtitleEnd = end;
    }
  }
}
```

**Change 2: Frame rendering**

If the export engine has its own subtitle rendering (separate from preview), update it to read from track clips. If the export path reuses preview rendering (likely), no additional change is needed beyond Change 1.

**Search for:** Grep the export engine for references to `getActiveSubtitles()`, `renderSubtitleToCanvas()`, or `timeline.subtitles`. If found, ensure they use clip-based subtitles.

---

#### 7. Inspector UI

##### 7.1 SubtitleInspectorPanel

**File:** `apps/web/src/components/editor/inspector/SubtitleInspectorPanel.tsx` (NEW)

A dedicated inspector panel for editing subtitle clip properties.

**Layout:**

```
┌──────────────────────────────────┐
│ Subtitle Inspector               │
├──────────────────────────────────┤
│ Text                             │
│ ┌──────────────────────────────┐ │
│ │ [textarea: multi-line text]  │ │
│ └──────────────────────────────┘ │
├──────────────────────────────────┤
│ Style Preset:  [Dropdown▼ Def] │
├──────────────────────────────────┤
│ Font:          [Family▼] [24px] │
│ Color:         [■ White]        │
│ Background:    [■ Black] [75%]  │
│ Position:      (●Bottom ○Center │
│                 ○Top)            │
├──────────────────────────────────┤
│ Animation:     [None▼]          │
├──────────────────────────────────┤
│ Timing:        0.50s – 5.50s    │
│ [████████░░░░░░░░] (read-only) │
├──────────────────────────────────┤
│ [Delete] [Split] [Export SRT]   │
└──────────────────────────────────┘
```

**Components:**

1. **Text Editor**
   - `<textarea>` for multi-line text
   - Character limit: TODO: Determine max subtitle length
   - Real-time preview in video

2. **Style Preset Dropdown**
   - Options: "Default", "White Outline", "Yellow BG", "Custom"
   - Reuses `SUBTITLE_STYLE_PRESETS` from core
   - Applying preset merges into current style

3. **Font Controls**
   - Font family selector (dropdown with common fonts)
   - Font size spinner (px)

4. **Color Selector**
   - Text color picker
   - Background color picker
   - Background opacity slider (0–100%)

5. **Position Selector**
   - Radio buttons: Bottom (default), Center, Top

6. **Animation Dropdown**
   - Options from `CaptionAnimationStyle` enum
   - "None" (default), "Karaoke", "Typewriter", "Fade", etc.

7. **Timing Display** (read-only)
   - Shows clip start and end time
   - Trim via timeline, not inspector

8. **Action Buttons**
   - **Delete:** Remove the clip
   - **Split:** Split clip at current playhead position
   - **Export SRT:** Export this clip (and others on the same track?) as SRT

**Field Updates:**

- Text changes: `updateSubtitle(clipId, { text })`
- Style changes: `updateSubtitle(clipId, { style: { ... } })`
- Animation changes: `updateSubtitle(clipId, { animationStyle })`

##### 7.2 Inspector Tab Integration

**File:** `apps/web/src/components/editor/inspector/InspectorTabs.tsx` (MODIFIED)

Add routing to show `SubtitleInspectorPanel` when a subtitle clip is selected:

```typescript
if (selectedClips.length === 1) {
  const clip = selectedClips[0];

  if (isSubtitleClip(clip)) {
    return <SubtitleInspectorPanel clip={clip} />;
  }

  if (isTextClip(clip)) {
    return <TextInspectorPanel clip={clip} />;
  }

  // ... other clip types
}
```

##### 7.3 Auto-Caption Panel Update

**File:** `apps/web/src/components/editor/inspector/AutoCaptionPanel.tsx` (MODIFIED)

Update the speech-to-text caption generation button to use the new `addSubtitle` action (which now creates subtitle clips instead of text clips). No UI changes needed, only ensure the action delegation is updated.

---

#### 8. Serialization and Persistence

##### 8.1 Project JSON Serialization

**Files Modified:**
- `packages/core/src/types/project.ts`
- `apps/web/src/services/auto-save.ts`

**Requirements:**

1. `SubtitleClip` fields MUST be serialized to JSON when saving projects
2. `JSON.parse()` on a saved project MUST reconstruct `SubtitleClip` instances
3. Auto-save MUST include subtitle clips in the serialized `project.timeline.tracks[]` array

**Implementation:**

Since `SubtitleClip` extends `Clip` and inherits standard serializable fields, JSON serialization should work automatically. The key is ensuring that:

- If using `subtitleData?: SubtitleClipData` pattern, this object is included in the serialized Clip
- OR if using a strict union, the type discriminant is preserved

**Verification:**

```typescript
const clip: SubtitleClip = {
  id: "sub-1",
  type: "subtitle-clip",
  trackId: "track-1",
  startTime: 10,
  duration: 5,
  text: "Hello",
  style: DEFAULT_SUBTITLE_STYLE
};
const json = JSON.stringify(clip);
const restored = JSON.parse(json);
assert(restored.text === "Hello");
```

##### 8.2 Migration on Project Load

**File:** `apps/web/src/stores/project-store.ts`

See **Section 3.2 Backward Compatibility and Migration** above. The `migrateSubtitles()` function runs on every `loadProject()` call to detect and convert the old flat subtitle format.

---

#### 9. SRT File Drop Handling

##### 9.1 Drag-and-Drop Integration

**Files Modified:**
- `apps/web/src/components/editor/Timeline.tsx` (handleDropMedia, handleDropOnEmpty)
- `apps/web/src/components/editor/timeline/TrackLane.tsx` (handleDrop)

**Requirement:** When a user drags an SRT file onto the timeline, the system MUST:

1. Detect that the dropped media item has `type: "srt"`
2. Parse the SRT file content
3. Create a subtitle track (if not present) or use an existing one
4. Create `SubtitleClip` instances for each SRT entry
5. NOT create a generic media clip or text clip

**Implementation:**

In the drop handler:

```typescript
async function handleDropMedia(data: DropData) {
  const mediaItem = project.mediaLibrary.items.find(m => m.id === data.mediaId);

  if (!mediaItem) return;

  // Check if dropped media is an SRT file
  if (mediaItem.type === "srt") {
    // Read SRT content
    const srtContent = await mediaItem.blob.text();

    // Import to subtitle track
    const result = projectStore.importSRT(srtContent);

    if (result.errors.length > 0) {
      showNotification(`SRT import: ${result.errors.length} error(s)`);
    }

    return;
  }

  // Handle other media types normally
  // ...
}
```

**Track Placement:**

- If SRT is dropped on the empty area or a non-subtitle track, create a new subtitle track named "Captions"
- If dropped on an existing subtitle track, add clips to that track
- Clips are positioned at the timeline location where the drop occurred (if detectable)

---

#### 10. Testing Strategy

##### 10.1 Unit Tests

**File:** `packages/core/src/timeline/subtitle-clip-manager.test.ts` (NEW)

Test the `SubtitleClipManager` in isolation:

**Test suite:**
- Clip creation with validation
- Clip update (text, style, timing)
- Clip removal
- Clip querying (at time, in range)
- SRT import/export with edge cases
- TODO: Overlapping clip handling
- TODO: Boundary time validation

##### 10.2 Integration Tests

**File:** `apps/web/src/stores/project-store.test.ts` (MODIFIED)

Unskip lines 1628–1644 and rewrite/add new tests:

**Test cases:**
- `addSubtitle creates a SubtitleClip on subtitle track, not text clip`
- `addSubtitle finds or creates "Captions" track`
- `removeSubtitle removes clip from track`
- `updateSubtitle updates text and style`
- `importSRT parses valid SRT and creates clips`
- `importSRT returns errors for malformed SRT`
- `exportSRT generates valid SRT output`
- `applySubtitleStylePreset applies style to all clips`
- `getSubtitle(clipId) returns correct clip`
- TODO: Test undo/redo for all operations

**File:** `apps/web/src/test/export-integration.test.ts` (MODIFIED)

Unskip lines 298–309 and add tests:

**Test cases:**
- `exportVideo includes subtitle clips with correct timing`
- `exportVideo renders subtitles with correct style`
- TODO: Test animated subtitles in export

##### 10.3 UI Component Tests

**File:** `apps/web/src/components/editor/timeline/SubtitleClipComponent.test.tsx` (NEW)

- Rendering text preview
- Select/deselect interaction
- Trim handle drag
- Context menu

**File:** `apps/web/src/components/editor/inspector/SubtitleInspectorPanel.test.tsx` (NEW)

- Text edit and save
- Style preset application
- Animation selection
- Delete, split, export actions

---

#### 11. Migration and Deprecation Timeline

##### 11.1 Phase 1: New Subtitle Clips (Current)

**Status:** Specification and implementation

- `SubtitleClip` type introduced
- `SubtitleClipManager` provides clip CRUD
- Store actions updated to use clips
- Timeline UI renders clips via `SubtitleClipComponent`
- Preview and export updated
- Inspector panel for editing
- Backward compatibility: old projects auto-migrate on load
- `Timeline.subtitles` marked `@deprecated` but still functional

**Deliverables:**
- All spec items (Tasks 1–11 from plan)
- Tests enabled and passing
- Manual testing: add/edit/delete/export subtitles

##### 11.2 Phase 2: Deprecation (v2.x)

**Actions:**
- Remove auto-migration code (projects with old format rejected)
- Remove `TextClip` fallback on subtitle tracks
- Add warnings if code tries to access `timeline.subtitles`

##### 11.3 Phase 3: Cleanup (v3.x)

**Actions:**
- Remove `Timeline.subtitles` field
- Remove deprecated methods from `SubtitleEngine`
- Remove any dead code references

---

#### 12. Constraints and Assumptions

##### 12.1 Functional Constraints

| Constraint | Rationale |
|-----------|-----------|
| Subtitle clips MUST have `startTime >= 0` | Negative time is invalid |
| Subtitle clips MUST have `duration > 0` | Zero/negative duration makes no sense |
| Clip text MAY contain `\n` for multi-line | Standard newline handling |
| Clips on same track SHOULD NOT overlap | TODO: Clarify overlap handling (allow? merge? warn?) |
| SubtitleClipManager works with tracks[] array | Stateless, pure functions for undo/redo |
| SRT import creates clips at extracted timings | Do NOT reposition based on track location |

##### 12.2 API Boundaries

| Boundary | Constraint |
|----------|-----------|
| `SubtitleClipManager` | Operates on `Track[]` array; returns updated array or error object |
| Store actions | Delegate to manager; maintain undo/redo; notify subscribers |
| Timeline component | Renders clips; delegates trim/move to store |
| Preview canvas | Reads clips from tracks; uses existing subtitle renderers |
| Inspector | Edits clip properties via store actions; no direct clip mutation |

##### 12.3 Assumptions

- `SubtitleStyle` and `CaptionAnimationStyle` types are stable and reusable
- `SRT` file format follows RFC 6597 (or similar standard)
- Subtitle tracks are not meant for audio content (dedicated "audio" track type exists)
- Export engine uses the same canvas rendering as preview (or is updated in parallel)

---

#### 13. Open Questions and TODOs

| # | Question | Impact | Owner |
|---|----------|--------|-------|
| 13.1 | How to handle overlapping subtitle clips? Allow multiple at same time, or error? | Rendering, timing logic | TBD |
| 13.2 | What is the maximum subtitle text length? | UI validation, SRT parsing | TBD |
| 13.3 | Should SRT import preserve all metadata (speaker, style tags) or flatten to text? | SRT fidelity | TBD |
| 13.4 | Trim handles: snap to exact frame boundary or smooth drag? | Timeline UX | TBD |
| 13.5 | Split button: creates two clips at playhead, or opens split time picker? | UI flow | TBD |
| 13.6 | Undo/redo granularity: single action per keystroke or debounce text edits? | Edit behavior | TBD |
| 13.7 | Per-word timing (words[] array): how are word boundaries determined during import? | SRT parsing, animation | TBD |
| 13.8 | Project migration: run migration on every load, or only on first detection? | Performance, safety | TBD |

**Action:** Implementation team MUST resolve these before or during development; document final decisions in ADR.

---

#### 14. File Change Summary

##### New Files
- `packages/core/src/types/subtitle-clip.ts`
- `packages/core/src/timeline/subtitle-clip-manager.ts`
- `apps/web/src/components/editor/timeline/SubtitleClipComponent.tsx`
- `apps/web/src/components/editor/inspector/SubtitleInspectorPanel.tsx`
- `packages/core/src/timeline/subtitle-clip-manager.test.ts` (test)

##### Modified Files
- `packages/core/src/types/timeline.ts` — Add `SubtitleClip` to union; deprecate `Timeline.subtitles`
- `packages/core/src/types/index.ts` — Re-export `SubtitleClip`
- `packages/core/src/timeline/index.ts` — Export `SubtitleClipManager`
- `packages/core/src/index.ts` — Re-export (if not indirect)
- `packages/core/src/export/export-engine.ts` — Update duration calc and frame rendering
- `apps/web/src/stores/project-store.ts` — Rewrite subtitle actions; add migration logic
- `apps/web/src/stores/project/subtitle-helpers.ts` — Update helpers for clips
- `apps/web/src/stores/project/types.ts` — Import `SubtitleClip`
- `apps/web/src/stores/project/project-helpers.ts` — Remove or update `subtitles: []` default
- `apps/web/src/components/editor/Timeline.tsx` — Add trim enablement for subtitle tracks; handle SRT drops
- `apps/web/src/components/editor/timeline/TrackLane.tsx` — Add `SubtitleClipComponent` rendering branch
- `apps/web/src/components/editor/timeline/index.ts` — Export `SubtitleClipComponent`
- `apps/web/src/components/editor/Preview.tsx` — Read subtitles from clips instead of flat array
- `apps/web/src/components/editor/preview/canvas-renderers.ts` — Add `getActiveSubtitleClips` overload
- `apps/web/src/components/editor/inspector/InspectorTabs.tsx` — Route to `SubtitleInspectorPanel`
- `apps/web/src/components/editor/inspector/index.ts` — Export `SubtitleInspectorPanel`
- `apps/web/src/components/editor/inspector/AutoCaptionPanel.tsx` — Update action delegation
- `apps/web/src/services/auto-save.ts` — Verify serialization (likely no change)
- `packages/core/src/types/project.ts` — Ensure `SubtitleClip` included in type
- `apps/web/src/stores/project-store.test.ts` — Unskip and rewrite tests
- `apps/web/src/test/export-integration.test.ts` — Unskip and rewrite tests

##### Removed/Deprecated
- `Timeline.subtitles` field (deprecated; removed in Phase 3)
- `createTextClip` workaround for subtitles (redirect to `SubtitleClipManager`)
- Orphaned test skip markers

---

#### Appendix A: Type Definitions

##### A.1 SubtitleClipData (optional pattern)

If using the non-breaking pattern of `Clip.subtitleData?:`:

```typescript
export interface SubtitleClipData {
  text: string;
  style: SubtitleStyle;
  words?: SubtitleWord[];
  animationStyle?: CaptionAnimationStyle;
  sourceMediaId?: string;
}
```

##### A.2 Helper Functions

```typescript
export function isSubtitleClip(clip: Clip): clip is SubtitleClip {
  return clip.subtitleData !== undefined || clip.type === "subtitle-clip";
}

export function hasSubtitleData(clip: Clip): boolean {
  return isSubtitleClip(clip);
}

export function ensureSubtitleTrack(timeline: Timeline): Track {
  let track = timeline.tracks.find(t => t.type === "subtitle" && t.name === "Captions");
  if (!track) {
    track = {
      id: generateId(),
      type: "subtitle",
      name: "Captions",
      clips: [],
    };
    timeline.tracks.push(track);
  }
  return track;
}
```

---

#### Appendix B: References

**Source Plan:** [Subtitle Track/Clip Type plan](../superpowers/plans/2026-07-03-subtitle-track-clip-type.md)

**Related Specs:**
- (TBD) Track and Clip Architecture spec
- (TBD) Export Engine spec

**Standards:**
- SRT format: RFC 6597 (WebVTT) or de facto SRT standard
- JSON serialization: Standard JSON conventions
- React component patterns: Project conventions (TBD reference)

---

---

### 8.2 Audio Auto-Subtitle Extraction Contract

**Version:** 1.0
**Date:** 2026-07-04
**Status:** Active

---

#### Overview

The Audio Auto-Subtitle Extraction system automatically transcribes audio media (MP3, WAV, AAC, OGG, FLAC) upon import using a GPU-accelerated transcription service. Transcription is asynchronous and fire-and-forget; the audio import always succeeds regardless of transcription outcome. Completed transcriptions are automatically imported as `SubtitleClip` instances on the project's subtitle track, providing immediate subtitle editing and export capabilities.

---

#### Scope

This specification covers:

- Audio file detection and automatic transcription triggering on import
- Orchestrator proxy API routes for transcription job submission and polling
- Async transcription job lifecycle management and state persistence
- Real-time progress reporting and status badges in the Assets Panel
- Graceful error handling without data loss
- Automatic subtitle generation and integration with the subtitle track system

**Out of scope:**
- Manual transcription triggering (future enhancement)
- Language detection or translation (baseline uses detected language)
- Custom word grouping heuristics (deferred to user edit after import)
- SRT file format changes (see [subtitle-track-clip-type](#cross-references) spec)

---

#### Architecture

##### High-level Flow

```
Audio Import
    ↓
[Audio MediaItem created in project]
    ↓
[Background: submitAudio to orchestrator]
    ↓
[TranscriptionJobStore: queued → transcribing]
    ↓
[useTranscriptionJobPoller: polls orchestrator every 3s]
    ↓
[Transcription completes with word-timed Whisper results]
    ↓
[AutoGroupWordSegments: cluster words into subtitle segments]
    ↓
[addSubtitle called for each segment → SubtitleClip on timeline]
    ↓
[AssetsPanel badge changes: spinner → check icon]
```

##### Key Components

| Component | Location | Role |
|-----------|----------|------|
| **Orchestrator Routes** | `apps/orchestrator/src/routes/transcribe.ts` | Proxy `POST /api/transcribe` and `GET /api/transcribe/:jobId` to GPU service |
| **TranscriptionJobStore** | `apps/web/src/stores/transcription-job-store.ts` | Zustand store tracking job states (queued → transcribing → completed/failed) |
| **transcription-client** | `apps/web/src/services/transcription-client.ts` | HTTP client; exposes `submitAudio()` and `pollJob()` |
| **useTranscriptionJobPoller** | `apps/web/src/hooks/useTranscriptionJobPoller.ts` | App-level React hook; polls active jobs, converts results to SubtitleClip data |
| **TranscriptionBadge** | `apps/web/src/components/editor/TranscriptionBadge.tsx` | UI overlay on audio thumbnails showing transcription status |
| **project-store** | `apps/web/src/stores/project-store.ts` | Triggers transcription on audio import; calls subtitle helpers on completion |

---

#### Data Model

##### TranscriptionJob

```typescript
interface TranscriptionJob {
  readonly mediaId: string;           // ID of the audio MediaItem
  readonly jobId: string;              // Backend job identifier from transcribe service
  status: TranscriptionJobStatus;      // "queued" | "transcribing" | "completed" | "failed"
  progress: number;                    // 0–100, updated during transcription
  error?: string;                      // Error message if status === "failed"
  result?: {
    text: string;                      // Full transcribed text
    words: Array<{
      word: string;
      start: number;                   // Start time (seconds)
      end: number;                     // End time (seconds)
    }>;
    language: string;                  // Detected or specified language (ISO 639-1)
    duration: number;                  // Total audio duration (seconds)
  };
}
```

##### SubtitleSegment (derived from word grouping)

After transcription completes, the `useTranscriptionJobPoller` groups contiguous words into segments using the heuristic:
- **Gap threshold:** Gap > 0.5 seconds between words starts a new segment
- **Word limit:** Segments capped at 20 words (prevents overly long single subtitles)

Each segment becomes a `SubtitleClip` with:
- `text`: concatenated words (space-separated)
- `startTime`: first word's `start` time
- `endTime`: last word's `end` time
- `words`: word-timed array for animated captions (karaoke, typewriter, etc.)

---

#### API Contracts

##### Orchestrator Routes

###### POST `/api/transcribe`

**Purpose:** Submit audio for transcription.

**Request:**
```
POST /api/transcribe HTTP/1.1
Content-Type: multipart/form-data

---boundary
Content-Disposition: form-data; name="audio"; filename="track.mp3"
Content-Type: audio/mpeg

[binary audio data]
---boundary
Content-Disposition: form-data; name="language"

en
---boundary--
```

**Optional fields:**
- `language`: ISO 639-1 code (e.g., "en", "es", "fr"). Helps Whisper; defaults to auto-detect.
- `target_language`: ISO 639-1 code. If provided, translates transcript to target language (GPU service feature).

**Response (200 OK):**
```json
{
  "jobId": "job-abc123def456",
  "status": "processing"
}
```

**Error responses:**
- `400 Bad Request`: Missing or invalid audio.
- `502 Bad Gateway`: Transcription service unavailable.

---

###### GET `/api/transcribe/:jobId`

**Purpose:** Poll a transcription job's status and retrieve results.

**Response (200 OK):**

*While transcribing:*
```json
{
  "jobId": "job-abc123def456",
  "status": "processing",
  "progress": 45
}
```

*Completed:*
```json
{
  "jobId": "job-abc123def456",
  "status": "completed",
  "progress": 100,
  "result": {
    "text": "Hello world. This is a test.",
    "words": [
      { "word": "Hello", "start": 0.1, "end": 0.5 },
      { "word": "world", "start": 0.6, "end": 1.0 },
      { "word": "This", "start": 1.2, "end": 1.5 },
      { "word": "is", "start": 1.6, "end": 1.8 },
      { "word": "a", "start": 1.9, "end": 2.0 },
      { "word": "test", "start": 2.1, "end": 2.5 }
    ],
    "language": "en",
    "duration": 2.5
  }
}
```

*Failed:*
```json
{
  "jobId": "job-abc123def456",
  "status": "failed",
  "error": "Audio format not supported"
}
```

---

#### Lifecycle

##### TranscriptionJob State Machine

```
┌──────────┐
│  queued  │  [Created when audio import begins]
└────┬─────┘
     │ [submitAudio succeeds]
     ▼
┌──────────────┐
│ transcribing │  [Job queued at GPU service; polling begins]
└────┬─────────┘
     │
     ├─ [progress updates 10–90%]
     │
     ├─ [status: "completed", result received]
     │  ▼
     │ ┌───────────┐
     │ │ completed │  [Word grouping → subtitle segments created]
     │ └───────────┘
     │
     └─ [status: "failed" or network error]
        ▼
     ┌────────┐
     │ failed │  [Retry action available; audio remains in library]
     └────────┘
```

##### Retry Behavior

When a job fails (or polling times out):

1. User clicks the "Failed" badge in AssetsPanel
2. `useTranscriptionJobStore.retryJob(mediaId)` resets the job to `"queued"`, clears error
3. `submitAudio` is called again with the same audio blob
4. New `jobId` is assigned; polling resumes

**Invariant:** The audio `MediaItem` is **never removed** during transcription failure.

---

#### Job Store (Zustand)

**File:** `apps/web/src/stores/transcription-job-store.ts`

**State:**
```typescript
interface TranscriptionJobState {
  jobs: Record<string, TranscriptionJob>;  // Keyed by mediaId

  // Actions
  createJob(mediaId: string, jobId: string): void;
  startJob(mediaId: string): void;
  updateProgress(mediaId: string, progress: number): void;
  completeJob(mediaId: string, result: TranscriptionJob["result"]): void;
  failJob(mediaId: string, error: string): void;
  retryJob(mediaId: string): void;
  getJob(mediaId: string): TranscriptionJob | undefined;
  getJobsByStatus(status: TranscriptionJobStatus): TranscriptionJob[];
  clearCompleted(): void;
}
```

**Persistence:**
- Zustand `persist` middleware stores jobs in localStorage.
- **Partialize:** Only `"completed"` and `"failed"` jobs persist; `"queued"` and `"transcribing"` are transient and rebuilt on app load.
- **Storage key:** `"transcription-jobs"`

**Rationale:** Users may close the app during transcription; completed results are preserved for reference, but active polling resumes from scratch on reload.

---

#### Client Service

**File:** `apps/web/src/services/transcription-client.ts`

**Public API:**
```typescript
async function submitAudio(
  blob: Blob,
  fileName: string,
  language?: string,
  targetLanguage?: string,
): Promise<{ jobId: string; status: string }>;

async function pollJob(jobId: string): Promise<{
  jobId: string;
  status: string;
  progress?: number;
  result?: TranscriptionJob["result"];
  error?: string;
}>;
```

**Constraints:**
- Stateless; no side effects
- Uses native `fetch` (Node 18+)
- Handles HTTP errors by throwing with descriptive messages
- No retry logic in the client; retries handled at the hook level

---

#### Polling Hook

**File:** `apps/web/src/hooks/useTranscriptionJobPoller.ts`

**Behavior:**
1. Mounts at app root (alongside `useGenerationJobPoller`)
2. Every 3 seconds (configurable via `intervalMs` param), queries `getJobsByStatus("transcribing")`
3. For each active job, calls `pollJob(jobId)`
4. **On completion:** Calls `completeJob()` with result; **triggers subtitle import** (see below)
5. **On failure:** Calls `failJob()` with error message
6. **On transient network error:** Logs warning; keeps polling (non-fatal)

**Word Grouping Logic:**
When a job completes, the poller calls `autoGroupWordSegments()` which:
- Iterates through words in order
- Groups words into segments when:
  - Gap between consecutive words exceeds 0.5 seconds, OR
  - Segment would contain > 20 words
- Returns array of `{ text, words, startTime, endTime }` segments ready for `addSubtitle()`

**Subtitle Auto-Import:**
After grouping, the poller calls `useProjectStore.getState().addSubtitle()` for each segment:
```typescript
addSubtitle({
  text: segment.text,
  startTime: segment.startTime,
  endTime: segment.endTime,
  words: segment.words,  // Preserves word timing for animations
  style: DEFAULT_SUBTITLE_STYLE,
});
```

This creates `SubtitleClip` instances on the project's `"subtitle"` track (see [subtitle-track-clip-type](#cross-references) spec).

---

#### Project Store Integration

**File:** `apps/web/src/stores/project-store.ts`

##### importMedia Trigger

When `importMedia()` completes for an audio file:

1. Check `mediaType === "audio"`
2. Extract blob: `const blob = newMediaItem.blob ?? file`
3. Fire background job (no await) via `setTimeout(..., 0)`:
   ```typescript
   setTimeout(async () => {
     try {
       const { jobId } = await submitAudio(blob, newMediaItem.name);
       useTranscriptionJobStore.getState().createJob(newMediaItem.id, jobId);
       useTranscriptionJobStore.getState().startJob(newMediaItem.id);
     } catch (error) {
       useTranscriptionJobStore
         .getState()
         .failJob(newMediaItem.id, error.message);
     }
   }, 0);
   ```

**Invariant:** Import completes and returns successfully **before** `submitAudio` is called. If transcription submission fails, the audio remains in the library.

---

#### UI: AssetsPanel Status Badge

**File:** `apps/web/src/components/editor/TranscriptionBadge.tsx`

**Behavior:**
- Rendered as an overlay on audio media items
- **No job or "queued":** No badge shown
- **"transcribing":** Spinner + progress percentage (blue)
- **"completed":** Check icon + "SRT" label (green); tooltip "Subtitles ready"
- **"failed":** Error icon + "Failed" label (red); tooltip shows error message; clickable to retry
- **Non-audio items:** No badge

**Styling:**
- Positioned absolute bottom-left of thumbnail
- Icons from `lucide-react` (Loader2, CheckCircle2, AlertCircle)
- Smooth transitions on status change

**Retry Interaction:**
On click of failed badge:
1. `stopPropagation()` prevents media item selection
2. `retryJob(mediaId)` resets job state
3. `submitAudio` re-submitted inline (not via project-store, to preserve isolated retry logic)
4. New `jobId` assigned; badge updates to spinner

---

#### Error Handling

##### Transcription Submission Failure

**Scenario:** `submitAudio()` throws (network down, malformed audio, etc.)

**Behavior:**
- Job transitions to `"failed"` with error message
- Audio `MediaItem` remains in library
- User sees red badge with retry button
- Retry is triggered by clicking badge

##### Polling Failures

**Scenario:** `pollJob()` throws (transient network error, service hiccup)

**Behavior:**
- Warning logged to console
- Job **remains** in `"transcribing"` state
- Polling continues on next interval
- No user-visible error (non-fatal; expected to recover)

##### Service Unavailable

**Scenario:** Transcription service (GPU instance) is offline

**Behavior:**
- Initial `submitAudio` returns `502 Bad Gateway` from orchestrator
- Job fails immediately
- User sees error badge; can retry once service is up

##### Incomplete Results

**Scenario:** Job completes but `result` field is null or `words` array is empty

**Behavior:**
- `completeJob()` is still called (status transitions to completed)
- Subtitle auto-import is **skipped** (no words to group)
- Badge shows check mark, but no subtitles are added to timeline
- User can manually re-trigger via UI (future enhancement)

---

#### Constraints and Assumptions

##### Audio Detection

- Audio files are identified by `processedMedia.metadata.hasAudio === true`
- Supported formats: MP3, WAV, AAC, OGG, FLAC (as per `infra/transcribe-gpu` capabilities)
- Transcription is triggered **only** if `mediaType === "audio"` (not for video with audio track)

##### Blob Availability

- For freshly imported audio: `newMediaItem.blob` is set from the upload
- For existing projects loaded from disk: `MediaItem.blob` may be null (blobs are not persisted)
- The code uses `newMediaItem.blob ?? file` which is safe for fresh imports; retry on persisted projects is a future enhancement

##### Whisper Output Format

- Whisper returns word-level timestamps (`start`, `end` in seconds)
- Language is auto-detected or specified via request
- Translation (if requested) yields target-language text but original word timings

##### Subtitle Track Assumption

- Project MUST have or create a `"subtitle"` track to accept auto-imported subtitles
- The `addSubtitle()` method in project-store creates this track if missing (existing behavior)
- See [subtitle-track-clip-type](#cross-references) for track/clip semantics

---

#### Configuration

**Environment Variables:**

| Variable | Scope | Default | Purpose |
|----------|-------|---------|---------|
| `TRANSCRIBE_SERVICE_URL` | Orchestrator | `http://localhost:8000` | GPU transcription service base URL |

**Hard-coded Constants:**

| Constant | Value | Purpose |
|----------|-------|---------|
| `POLL_INTERVAL_MS` | 3000 | Polling interval (3 seconds) |
| `SEGMENT_GAP_THRESHOLD` | 0.5 | Gap (seconds) to split segments |
| `MAX_WORDS_PER_SEGMENT` | 20 | Max words per subtitle segment |

---

#### Testing Strategy

##### Unit Tests

- **transcription-job-store.test.ts:** State transitions, persistence, idempotency
- **transcription-client.test.ts:** HTTP mocking, error handling, multipart form encoding
- **useTranscriptionJobPoller.test.ts:** Polling loop, job completion handling, word grouping
- **TranscriptionBadge.test.tsx:** Badge rendering, retry button interaction

##### Integration Tests

- **project-store.test.ts:** Audio import triggers transcription; non-audio files do not
- **App.tsx:** Poller hook is mounted and active
- **End-to-end scenario:** Import audio → job polls → completion → subtitles appear on timeline (manual; requires transcribe service running)

---

#### Future Enhancements

- **Manual transcription trigger:** Button in AssetsPanel to transcribe existing audio without re-importing
- **Language selection:** Dropdown to specify language before import (currently auto-detected)
- **Translation:** UI to request target-language transcription
- **Custom word grouping:** Inspector panel with manual segment editor after auto-grouping
- **Whisper model selection:** Switch between base/small/medium/large models (performance vs. accuracy)
- **Batch transcription:** Queue multiple audio files for concurrent processing
- **Webhook callbacks:** Real-time updates via WebSocket instead of polling

---

#### Cross-References

- **[Subtitle Track/Clip Type Contract](#81-subtitle-trackclip-type-contract):** First-class `SubtitleClip` type, subtitle track rendering, and inspector panel. Auto-imported subtitles create `SubtitleClip` instances per the canonical contract in this spec.
- **[Audio Auto-Subtitle Extraction plan](../superpowers/plans/2026-07-03-audio-auto-subtitle-extraction.md):** Implementation plan with 8 atomic tasks, TDD steps, and code snippets.
- **[Subtitle Track/Clip Type plan](../superpowers/plans/2026-07-03-subtitle-track-clip-type.md):** Domain model for subtitles, track/clip architecture, and timeline rendering.
- **Core types:** `packages/core/src/types/timeline.ts` (`Subtitle`, `SubtitleWord`, `SubtitleStyle`, `Track`, `Clip`)
- **GPU service:** `infra/transcribe-gpu/main.py` — Whisper-based transcription with word-level timing

---

#### Glossary

- **Transcription job:** Async task in the GPU service; identified by unique `jobId`
- **Word grouping:** Heuristic to cluster Whisper word-level output into user-facing subtitle segments
- **SubtitleClip:** First-class clip type on subtitle tracks (new; see [Subtitle Track/Clip Type Contract](#81-subtitle-trackclip-type-contract))
- **Fire-and-forget:** Background work that does not block the main operation (audio import)
- **Polling:** Periodic HTTP GET to check job status (3-second interval)
- **Partialize:** Zustand middleware feature to selectively persist state fields

---

#### Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-07-04 | Spec Writer | Initial operational spec from plan documents |

---

## 9. Open Questions

- TODO: What port should the Python audio-analysis service default to? Plan uses `8001` (Whisper uses `8000`).
- TODO: Should "Apply Beat Markers" replace or merge with existing timeline beat markers? v1 replaces entirely.
- TODO: Energy overlay rendering: gradient bar (Option A) vs. per-frame colored lines (Option B)? Plan follows Option A.
- TODO: Genre classifier uses simple heuristics (MFCC + tempo thresholds) rather than a trained model. Future: swap in ONNX model (musiCNN, VGGish).
- TODO: Word grouping heuristic (0.5s gap, 20 word max) may need tuning after user feedback for fast/slow speech.
- TODO: Transcription for persisted projects with existing audio (where `MediaItem.blob` is null) needs a different trigger mechanism.
- TODO: Chunked upload or streaming for very long audio files (>1 hour) as future optimization.
