# Audio Analysis & Subtitles — Operational Spec

**Status:** Canonical operational specification
**Owner:** Audio analysis, subtitle, and transcription subsystem
**Supersedes:** [Audio Auto-Subtitle Extraction](./audio-auto-subtitle-extraction.md), [Subtitle Track/Clip Type](./subtitle-track-clip-type.md), and [Auto Captions — Selected Clip Input Support](./2026-07-08-auto-caption-clip-input-spec.md)

## Scope

This specification owns audio analysis, transcription, subtitle domain records, subtitle import/edit/render/export behavior, and auto-caption input selection. [Song Sections](./song-sections.md) owns semantic song sections. [Timeline](./timeline.md) owns generic track placement and rendering mechanics.

## 1. Audio Analysis

Audio analysis runs through a typed service boundary and returns reproducible, time-aligned evidence:

```ts
interface AudioAnalysis {
  sourceMediaId: string;
  sourceHash: string;
  durationSeconds: number;
  tempo?: number;
  beats: Array<{ time: number; confidence: number }>;
  energy: Array<{ startTime: number; endTime: number; value: number }>;
  sentiment: Array<{
    startTime: number;
    endTime: number;
    valence: number;
    arousal: number;
    confidence: number;
  }>;
  genre?: Array<{ label: string; confidence: number }>;
  warnings: string[];
  analyzerVersion: string;
}
```

Analysis is keyed by media identity, source hash, analyzer version, and configuration. Results from different bytes or versions are never reused. Progress is cancellable and failures preserve earlier valid results.

Sentiment is time-series data, not one project-wide label. Energy and sentiment evidence may be aligned to confirmed ranges supplied by [Song Sections](./song-sections.md), but audio analysis does not own or duplicate section records.

## 2. Analysis UI and Application

The audio inspector displays duration, tempo, genre confidence, beat/energy visualization, and time-series sentiment with accessible text alternatives.

Applying analysis is explicit. It may add beat markers or provide evidence to song-section inference, but MUST NOT silently replace user edits, confirmed sections, clips, or subtitles. Stale results identify their source and require reanalysis.

## 3. Subtitle Domain Model

Subtitles are first-class timeline clips on subtitle tracks.

```ts
interface SubtitleWord {
  text: string;
  startTime: number;
  endTime: number;
  confidence?: number;
}

interface SubtitleStyle {
  fontFamily?: string;
  fontSize?: number;
  color?: string;
  backgroundColor?: string;
  position?: "top" | "center" | "bottom";
  align?: "left" | "center" | "right";
}

interface SubtitleClip {
  id: string;
  type: "subtitle";
  mediaId: string;
  startTime: number;
  duration: number;
  text: string;
  words?: SubtitleWord[];
  style?: SubtitleStyle;
  language?: string;
  source?: "manual" | "imported" | "transcribed";
  transcriptionJobId?: string;
}
```

Subtitle clip timing is relative to the project timeline. Word timing is relative to the same timeline unless explicitly typed otherwise. The implementation MUST NOT mix source-relative and timeline-relative timestamps without conversion at the boundary.

The legacy flat `Timeline.subtitles` array is deprecated. Migration creates a subtitle track and subtitle clips without losing text, timing, words, or style.

## 4. Subtitle Clip Operations

One subtitle manager owns validation and CRUD:

- create single or multiple clips atomically;
- edit text, timing, words, language, and style;
- split at a valid word/time boundary;
- merge adjacent compatible clips;
- delete and restore through undo;
- import SRT/VTT with line-specific errors;
- normalize overlaps only through an explicit policy.

Clips require non-empty normalized text, finite non-negative times, positive duration, stable unique ID, and a subtitle-compatible track. Word ranges must lie within the clip and remain ordered.

## 5. Timeline, Preview, Inspector, and Export

Subtitle tracks and placement follow [Timeline](./timeline.md). Subtitle clips render text and timing distinctly from audiovisual clips and remain selectable, draggable, trimmable, and editable.

The preview renders every active subtitle clip using project time, safe bounds, style defaults, and deterministic stacking. Selection routes to the subtitle inspector through [Inspector Shell](./inspector-shell.md).

Export uses the same active-clip and style resolution as preview. [Export](./export.md) owns frame rendering and muxing; this spec owns the subtitle data supplied to it. Preview/export parity is required for text, timing, line breaks, position, alignment, and supported style properties.

## 6. Auto-Transcription

Auto-captioning submits a transcription job through the orchestrator. Provider credentials remain server-side.

```ts
interface TranscriptionJob {
  id: string;
  projectId: string;
  mediaId: string;
  clipId?: string;
  inputRange: { startTime: number; endTime: number };
  language?: string;
  status: "queued" | "running" | "completed" | "failed" | "canceled";
  progress?: number;
  error?: { code: string; message: string; retryable: boolean };
}
```

Jobs are persistent, cancellable, and centrally polled. Reload resumes active jobs without duplicate subtitle creation. Completion is idempotent by transcription job ID.

Returned words are validated, converted to project time, and grouped deterministically using maximum duration, maximum characters, punctuation, silence gaps, and reading-speed constraints. Grouping never drops or reorders words.

## 7. Auto-Caption Input Selection

Auto-caption input precedence is:

1. a selected compatible audio clip;
2. a selected video clip with usable audio;
3. an explicitly chosen media item;
4. no implicit fallback when more than one candidate is plausible.

For a selected clip, the job uses only its effective audible source range after source offset, trim, speed, and timeline placement are resolved. Output timestamps are mapped back to project time.

The panel identifies the selected source, effective range, and duration before submission. Unsupported clips, muted/no-audio media, unavailable bytes, invalid ranges, and ambiguous selection block submission with a specific recovery action. Switching selection updates the proposed input but never retargets an already submitted job.

## 8. File Import

SRT and VTT may be imported through the Media pane or dropped onto a compatible subtitle track. Parsing occurs off the critical render path and is bounded for large files.

- Valid cues are imported atomically according to an explicit partial-failure policy.
- Cue times are validated and converted once.
- Overlaps are preserved or normalized only according to the selected policy.
- File encoding and malformed cue errors identify the relevant location.
- Import never creates generic text clips as a subtitle workaround.

## 9. Errors and Recovery

Typed problems distinguish analysis failure, unsupported input, media unavailable, transcription submission/polling failure, malformed provider output, subtitle validation, import parse failure, and export incompatibility.

Retries preserve job history and do not duplicate clips. Media availability follows [Media Assets](./media-assets.md); transport failure is not missing media. All user-visible errors integrate with [Problems, Errors & Logging](./problems-errors-logging.md).

## 10. Required Tests and Eval

Deterministic tests MUST cover analysis cache identity, time-series validation, section-evidence handoff, subtitle migration, CRUD/split/merge, timing conversion, SRT/VTT parsing, timeline/preview/export parity, input precedence, trim/speed/range mapping, word grouping, job reload, cancellation, retry, and idempotent completion.

Transcription evals use fixed audio fixtures and thresholds for word timing, text accuracy, segmentation, and language behavior. Browser verification covers selected audio/video clips, ambiguous selection, trimmed ranges, reload during transcription, editing generated subtitles, preview, and export.

## 11. Failure Modes

- Audio results are reused for different bytes or analyzer versions.
- Section records are copied into audio state and drift.
- Source-relative word times are rendered as project times.
- Selection changes retarget a running job.
- Reload or repeated polling creates duplicate subtitles.
- Preview and export use different active-cue or style logic.
- Subtitle import creates generic text clips.
- A transient media failure is treated as durable absence.
