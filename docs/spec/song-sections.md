# Song Sections — Operational Spec

**Status:** Canonical operational specification
**Owner:** Song-section subsystem
**Supersedes:** [Sections Identification](./sections-identification.md) and the section-identification requirements formerly duplicated in [Audio Analysis & Subtitles](./audio-analysis-subtitles.md)

## Scope

This specification owns inference, evidence, editing, validation, confirmation, persistence, and timeline presentation of semantic song sections. [Audio Analysis & Subtitles](./audio-analysis-subtitles.md) supplies audio evidence. [Storyboard](./storyboard.md) consumes confirmed sections.

## 1. Domain Contract

```ts
type SongSectionKind =
  | "intro"
  | "verse"
  | "pre-chorus"
  | "chorus"
  | "post-chorus"
  | "bridge"
  | "breakdown"
  | "instrumental"
  | "outro"
  | "custom";

interface SectionEvidence {
  source: "lyrics" | "repetition" | "energy" | "beats" | "manual";
  confidence: number;
  detail?: string;
}

interface SongSection {
  id: string;
  name: string;
  kind: SongSectionKind;
  startSeconds: number;
  endSeconds: number;
  confidence: number;
  evidence: SectionEvidence[];
  confirmed: boolean;
  color?: string;
}

interface SectionAnalysisResult {
  sections: SongSection[];
  durationSeconds: number;
  warnings: string[];
  sourceVersion: string;
}
```

IDs remain stable across boundary edits and renames. Inference replacement may allocate new IDs only when it represents a new analysis result that the user explicitly accepts.

## 2. Evidence Inputs

Inference may combine:

- timestamped lyric repetition and labels;
- beat and downbeat positions;
- energy boundaries and sustained changes;
- section-aligned sentiment from [Audio Analysis & Subtitles](./audio-analysis-subtitles.md);
- duration and song-form heuristics;
- manual user boundaries and labels.

No single heuristic is authoritative. Manual edits have highest precedence. Confidence is derived deterministically from recorded evidence and MUST NOT be presented as model certainty when evidence is weak.

Lyrics input supports validated timestamped formats such as LRC and structured JSON. Untimed plain lyrics may inform repetition and labels but cannot independently establish precise boundaries.

## 3. Inference Pipeline

The deterministic merge pipeline:

1. normalize and validate evidence;
2. propose lyric/repetition spans;
3. propose form-based labels and ordering;
4. snap candidate boundaries to nearby energy or beat evidence within a bounded threshold;
5. merge compatible candidates;
6. fill or report uncovered ranges according to the configured coverage rule;
7. calculate confidence and warnings;
8. return unconfirmed editable sections.

The pipeline is pure for equivalent inputs and does not mutate audio analysis, lyrics, or existing confirmed sections.

## 4. Editing and Confirmation

Users can rename, reclassify, split, merge, create, delete, and move section boundaries. Every operation validates before commit and is undoable.

- Moving a shared boundary updates adjacent sections atomically.
- Splitting preserves total covered duration and creates stable new identity for the added section.
- Merging requires adjacent sections and records the retained identity policy.
- Manual creation uses an explicit kind/name and valid non-zero range.
- Re-running inference never silently overwrites confirmed or manually edited sections.

Sections must be explicitly confirmed before they become generation input. Confirmation validates the full set and records the analysis/source version. Subsequent editing marks affected confirmation stale until reconfirmed.

## 5. Validation

- Times are finite, non-negative, and within audio duration.
- `startSeconds < endSeconds`.
- IDs are unique.
- Sections do not overlap.
- Ordering is by start time.
- Adjacent boundaries respect the configured tolerance.
- Gaps are either explicitly allowed or surfaced as warnings.
- Confidence is within `[0, 1]`.
- A confirmed set has no blocking validation errors.

Boundary snapping is bounded so it cannot materially rewrite a lyric-supported range. Ambiguous evidence remains visible rather than being hidden by aggressive normalization.

## 6. State and Timeline Presentation

Section state is stored once in the music-video/project domain record, not duplicated across audio metadata, storyboard records, and timeline clips.

The timeline renders a section meta-track from this state. The meta-track is a projection:

- it displays section name, kind, color, confidence state, and boundaries;
- it supports selection and boundary editing;
- it does not create an independent second section record;
- grouping and expansion behavior follow [Timeline](./timeline.md).

The confirmation panel displays evidence, warnings, editing controls, and explicit Confirm/Reconfirm action. Colors are deterministic by kind and meet contrast requirements without relying on color alone.

## 7. Storyboard Integration

[Storyboard](./storyboard.md) may generate only from a valid confirmed section set unless the user explicitly selects a sectionless workflow.

The request carries section IDs, names, kinds, and exact boundaries. The generation prompt preserves those boundaries and can request recurring motifs for repeated sections. Storyboard output references section IDs rather than copying mutable section truth.

## 8. Errors and Recovery

- Parse failures identify format and line/field without discarding existing sections.
- Weak inference returns warnings and editable candidates, not false certainty.
- Invalid manual edits remain uncommitted and identify the violated constraint.
- Stale analysis or audio identity requires reanalysis/reconfirmation.
- Missing audio prevents new inference but does not delete previously stored sections.

Errors and recovery actions use [Problems, Errors & Logging](./problems-errors-logging.md).

## 9. Required Tests

Deterministic tests cover each parser, repetition inference, form heuristics, bounded snapping, merge precedence, confidence, stable IDs, every CRUD operation, overlap/gap validation, stale confirmation, projection behavior, and storyboard request validation.

Browser verification covers lyrics upload, inference, boundary editing, split/merge, confirmation, stale reconfirmation, timeline presentation, and confirmed-section storyboard generation.
