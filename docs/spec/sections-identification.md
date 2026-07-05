# Sections Identification — Operational Spec

**Version:** 1.0
**Status:** Specification
**Last Updated:** 2026-07-04
**Source Plan:** [Section Identification Flow plan](../superpowers/plans/2026-07-03-section-identification-flow.md)

---

## Overview

The sections identification system detects, displays, confirms, and edits song sections to provide storyboard generation and alteration with confirmed section boundaries as first-class creative structure. It combines four evidence sources—repeated/partially repeated lyrics, typical song-form heuristics, audio-energy boundary changes, and optional user-provided lyrics files—into an editable, confirmed section map.

The system MUST require user confirmation or editing of inferred sections before any storyboard generation begins. Confirmed sections are fed into storyboard create/alter LLM calls as hard timing and structure constraints.

---

## Architecture

### Data Flow

1. **Input Sources:**
   - Audio duration (seconds)
   - Optional lyrics array with timing (`LyricLine[]`)
   - Optional energy boundaries from audio analysis (`EnergyBoundary[]`)
   - Optional lyrics file (`.txt`, `.lrc`, `.srt`)

2. **Inference Pipeline:**
   - `inferSectionsFromLyrics` → identify repeated lyric blocks → candidate choruses
   - `inferSongSections` → merge lyrics with song-form skeleton and energy boundaries → complete section set
   - Snap to energy boundaries within ±4 seconds when confidence ≥ 0.65

3. **User Interaction:**
   - Store inferred sections as unconfirmed in `MusicVideoState`
   - Render `SectionMetaTrack` for visual editing (drag boundaries, split, rename)
   - Show `SectionConfirmationPanel` before storyboard generation
   - User confirms or edits sections until valid (no overlaps, valid duration)

4. **Output:**
   - Confirmed sections in `SectionAnalysisResult` with `status: "confirmed"`
   - Sections fed into storyboard generation/alteration LLM prompts as hard constraints

---

## Types and Contracts

### Song Section Kind

```ts
type SongSectionKind =
  | "intro"
  | "verse"
  | "prechorus"
  | "chorus"
  | "bridge"
  | "breakdown"
  | "drop"
  | "solo"
  | "outro"
  | "unknown";
```

MUST cover all major song-form building blocks. `unknown` is a fallback for sections that don't fit standard structure.

### Section Evidence

```ts
interface SectionEvidence {
  kind: "lyric-repetition" | "song-form" | "energy-boundary" | "manual" | "lyrics-file";
  confidence: number;  // 0.0 to 1.0
  note: string;        // human-readable explanation
}
```

MUST track the source of evidence for each section. Multiple evidence kinds indicate stronger confidence.

### EditableSongSection

```ts
interface EditableSongSection {
  id: string;                        // unique section id
  name: string;                      // e.g., "Verse 1", "Chorus 1"
  kind: SongSectionKind;
  startSeconds: number;
  endSeconds: number;
  color: string;                     // hex color for timeline rendering
  confidence: number;                // aggregate confidence (0.0 to 1.0)
  confirmed: boolean;                // true after user confirmation
  evidence: SectionEvidence[];       // ordered by confidence descending
}
```

MUST be immutable after confirmation unless explicitly edited. `endSeconds` MUST be > `startSeconds`. Duration MUST be ≥ 0.1 seconds.

### SectionAnalysisResult

```ts
interface SectionAnalysisResult {
  status: "needs-confirmation" | "confirmed";
  sections: EditableSongSection[];
}
```

MUST be stored in `MusicVideoState` as `sectionAnalysis`. Transitions from `needs-confirmation` → `confirmed` only after user explicitly calls `confirmSections`.

---

## Section Inference

### Lyric Repetition Inference

**Function:** `inferSectionsFromLyrics(lines: LyricLine[], durationSeconds: number): SectionAnalysisResult`

**Algorithm:**
1. Normalize each lyric line: lowercase, remove punctuation, collapse whitespace
2. Filter lines with normalized length > 12 characters (eliminate short fragments)
3. Identify repeated phrases (lines with identical normalized text appearing 2+ times)
4. Create chorus sections centered on repeated lines, padded ±4s within bounds
5. Each section: `confidence: 0.85`, `evidence: [{ kind: "lyric-repetition", ... }]`

**Output:** Unconfirmed sections with kind `"chorus"`, sequential names `"Chorus 1"`, `"Chorus 2"`, etc.

**Note:** If no repeated lyrics exist, return empty section array (fallback to song-form skeleton in merge step).

### Song-Form Heuristics

**Function:** `buildSongFormSkeleton(durationSeconds: number): EditableSongSection[]`

**Algorithm for songs > 90s:**

| Section | Boundary |
|---------|----------|
| Intro | 0–8% |
| Verse 1 | 8–25% |
| Prechorus 1 | 25–34% |
| Chorus 1 | 34–50% |
| Verse 2 | 50–64% |
| Chorus 2 | 64–80% |
| Bridge / Breakdown | 80–90% |
| Outro | 90–100% |

For songs ≤ 90s, use simpler skeleton: Intro, Verse, Chorus, Outro.

**Output:** Unconfirmed sections with evidence kind `"song-form"`, confidence `0.70`, sequential names (`"Verse 1"`, `"Verse 2"`, etc.).

### Energy Boundary Snapping

**Function:** `snapSectionsToEnergy(sections: EditableSongSection[], boundaries: EnergyBoundary[], durationSeconds: number): EditableSongSection[]`

**Algorithm:**
- For each section boundary (start and end), search for the nearest energy boundary within ±4 seconds
- If found AND energy boundary confidence ≥ 0.65:
  - Move the section boundary to the energy time
  - Add `{ kind: "energy-boundary", confidence: energy.confidence }` to evidence
- Otherwise, leave section boundary unchanged
- Recalculate aggregate section confidence as the maximum of all evidence confidences

**Output:** Sections with adjusted boundaries and merged evidence.

### Full Merge Pipeline

**Function:** `inferSongSections(input: { durationSeconds, lyrics?, energyBoundaries? }): SectionAnalysisResult`

**Algorithm:**
1. If lyrics provided and have repeated phrases:
   - Use `inferSectionsFromLyrics` result
2. Else:
   - Use `buildSongFormSkeleton`
3. Apply `snapSectionsToEnergy` to snap boundaries to energy
4. Return `{ status: "needs-confirmation", sections: [...] }`

**Contract:**
- MUST return valid sections with no overlaps
- MUST preserve `durationSeconds` bounds
- MUST order sections by `startSeconds` ascending
- MUST assign color based on `SongSectionKind`

---

## Color Palette

Each `SongSectionKind` MUST map to a consistent hex color for timeline rendering:

| Kind | Color |
|------|-------|
| intro | `#64748b` |
| verse | `#3b82f6` |
| prechorus | `#a855f7` |
| chorus | `#f97316` |
| bridge | `#14b8a6` |
| breakdown | `#ef4444` |
| drop | `#22c55e` |
| solo | `#eab308` |
| outro | `#64748b` |
| unknown | `#94a3b8` |

---

## Section CRUD Operations

### setInferredSections

```ts
setInferredSections(openreelProjectId: string, sections: EditableSongSection[]): void
```

- Stores sections under `musicVideoState[projectId].sectionAnalysis.sections`
- Sets `status: "needs-confirmation"`
- All sections have `confirmed: false`
- MUST clear any prior inferred sections

### updateSectionBoundary

```ts
updateSectionBoundary(
  openreelProjectId: string,
  sectionId: string,
  startSeconds: number,
  endSeconds: number
): void
```

- Updates start/end times for one section
- MUST validate: `endSeconds > startSeconds`, no overlap with adjacent sections
- Adds evidence: `{ kind: "manual", confidence: 1.0, note: "User edited boundary" }`
- MUST preserve `confirmed` state

### splitSection

```ts
splitSection(openreelProjectId: string, sectionId: string, splitSeconds: number): void
```

- Finds section by `id`, splits at `splitSeconds`
- Creates two new sections with new IDs
- Left section: `startSeconds` to `splitSeconds`
- Right section: `splitSeconds` to original `endSeconds`
- Both inherit parent kind, color; names become sequential (e.g., `"Verse 1"` → `"Verse 1"`, `"Verse 2"`)
- Both marked unconfirmed with evidence: `{ kind: "manual", confidence: 1.0, note: "Split from..." }`

### renameSection

```ts
renameSection(
  openreelProjectId: string,
  sectionId: string,
  kind: SongSectionKind,
  name: string
): void
```

- Updates section's `kind` and `name`
- Updates `color` to match new `kind`
- Adds evidence: `{ kind: "manual", confidence: 1.0 }`
- Allows user to override inferred kind (e.g., change chorus to bridge)

### confirmSections

```ts
confirmSections(openreelProjectId: string): void
```

- Sets all sections `confirmed: true`
- Sets `sectionAnalysis.status: "confirmed"`
- MUST reject if:
  - No sections exist
  - Any sections overlap
  - Any section has `endSeconds <= startSeconds`
- MUST preserve evidence and boundaries from prior edits

---

## UI Components

### SectionMetaTrack

**File:** `apps/web/src/components/editor/timeline/SectionMetaTrack.tsx`

**Props:**

```ts
interface SectionMetaTrackProps {
  sections: EditableSongSection[];
  pixelsPerSecond: number;
  onBoundaryDrag: (sectionId: string, edge: "start" | "end", timeSeconds: number) => void;
  onSplit: (sectionId: string, timeSeconds: number) => void;
  onRename: (sectionId: string, kind: SongSectionKind, name: string) => void;
}
```

**Behavior:**

- Renders as a 28px-high horizontal track above normal timeline lanes
- Each section as a colored block with section name label inside
- Start/end drag handles on section edges; drag updates boundary via `onBoundaryDrag`
- Right-click context menu or inline split button at timeline cursor; triggers `onSplit`
- Click section name or dropdown to change kind/name; triggers `onRename`
- Section names follow sequential convention: `"Verse 1"`, `"Verse 2"`, `"Chorus 1"`, `"Bridge"`, etc.

**Visibility:** Rendered above timeline track lanes ONLY when active music-video project has `sectionAnalysis.sections.length > 0`.

### SectionConfirmationPanel

**File:** `apps/web/src/components/editor/storyboard/SectionConfirmationPanel.tsx`

**Props:**

```ts
interface SectionConfirmationPanelProps {
  sections: EditableSongSection[];
  onConfirmed: (confirmedSections: EditableSongSection[]) => void;
  onCancel: () => void;
}
```

**Behavior:**

- Displays section list sorted by `startSeconds`
- For each section:
  - Color swatch (section color)
  - Name and kind (editable via dropdown for kind)
  - Timing display: `HH:MM:SS – HH:MM:SS`
  - Evidence badges: `lyrics`, `energy`, `song-form`, `manual` (up to 3 shown, with "+N more" tooltip)
  - Confidence percentage (as bar or number)
- "Confirm sections" button at bottom
  - Disabled if any sections overlap, have zero/negative duration, or section count is 0
  - Enabled otherwise
- "Cancel" button to close without confirming
- On "Confirm", call `onConfirmed` and transition panel (close or proceed)

**Validation:**
- MUST reject overlapping sections
- MUST reject sections with `endSeconds <= startSeconds`
- MUST allow renaming/changing kind inline

---

## Lyrics File Support

### File Formats

**`.txt` (plain text):**
- One lyric per line
- Optionally prefixed with timing: `[HH:MM:SS] Lyric text`
- If no timing, assume 10 lines per minute (rough estimation)

**`.lrc` (LRC format):**
- Standard format: `[MM:SS.ms] Lyric text`
- Example: `[00:32.00] We rise up tonight`
- Parse milliseconds and convert to seconds

**`.srt` (SRT subtitle format):**
- Standard format: index, timing line, text
- Extract start/end times, join multiple text lines
- Example:
  ```
  1
  00:00:32,000 --> 00:00:40,500
  We rise up tonight
  ```

### Parse Function

**Function:** `parseLyricsFile(content: string, filename: string): LyricLine[]`

**Algorithm:**
1. Detect format from filename extension or content pattern
2. Extract `{ startSeconds, endSeconds?, text }` for each line
3. If `endSeconds` missing (e.g., `.txt` without timing), estimate 2–3 seconds per phrase or use next line's start
4. Filter empty/whitespace-only lines
5. Return array sorted by `startSeconds`

**Contract:**
- MUST return valid `LyricLine[]` with `startSeconds ≥ 0`
- MUST handle files with no timing info gracefully
- MUST handle mixed-format files (best effort)

---

## Integration with Storyboard Generation

### GenerateStoryboardDialog

**File:** `apps/web/src/components/editor/storyboard/GenerateStoryboardDialog.tsx`

**Changes:**

- Add optional file input for lyrics file (`.txt`, `.lrc`, `.srt`)
- On file selection:
  - Parse lyrics via `parseLyricsFile`
  - Call `inferSongSections` with lyrics
  - Store result in `sectionAnalysis` (unconfirmed)
  - Display `SectionConfirmationPanel` before proceeding
- MUST require at least one confirmed section before submitting storyboard generation
- If no sections exist, show message: "Confirm song sections before generating storyboard"
- Pass `confirmedSections: EditableSongSection[]` in generation request payload

### StoryboardPanel

**File:** `apps/web/src/components/editor/storyboard/StoryboardPanel.tsx`

**Changes:**

- Add "Upload lyrics" action in storyboard configuration pane (after generation)
- Allow user to upload/parse lyrics file
- Offer two options:
  - Merge with existing sections (preserve manual edits, add new evidence)
  - Replace all sections (re-run inference)
- Store updated sections in `sectionAnalysis`

---

## Orchestrator Route Validation

### POST /api/tools/generate-storyboard

**File:** `apps/orchestrator/src/routes/storyboard.ts`

**Request Body:**

```ts
interface StoryboardGenerationRequest {
  // ... existing fields ...
  confirmedSections: EditableSongSection[];
}
```

**Validation:**

```ts
if (!body.confirmedSections?.length || body.confirmedSections.some((section) => !section.confirmed)) {
  res.status(400).json({ error: "Confirm song sections before generating storyboard" });
  return;
}
```

MUST reject any request with unconfirmed or missing sections.

### Prompt Integration

**File:** `apps/orchestrator/src/prompts/storyboard-generation.ts`

**Change:**

Add section block to user prompt:

```
## Song Sections

${sections.map((s) => `- ${s.name} (${s.kind}): ${Math.round(s.startSeconds)}s–${Math.round(s.endSeconds)}s`).join('\n')}

You must preserve the provided section boundaries. Create shots that start/end inside these sections unless explicitly instructed otherwise. Chorus sections should usually contain repeated visual motifs or returning imagery.
```

**Contract:** The LLM MUST respect section boundaries in generated storyboard shots.

---

## State Storage

### MusicVideoState Extension

**File:** `apps/web/src/stores/music-video-store.ts`

**Structure:**

```ts
interface MusicVideoProject {
  // ... existing fields ...
  sectionAnalysis?: SectionAnalysisResult;
}

interface MusicVideoState {
  // ... existing actions ...
  setInferredSections: (projectId: string, sections: EditableSongSection[]) => void;
  updateSectionBoundary: (projectId: string, sectionId: string, startSeconds: number, endSeconds: number) => void;
  splitSection: (projectId: string, sectionId: string, splitSeconds: number) => void;
  renameSection: (projectId: string, sectionId: string, kind: SongSectionKind, name: string) => void;
  confirmSections: (projectId: string) => void;
}
```

**Persistence:** Confirmed sections MUST be persisted to project file so reloading preserves user edits and confirmations.

---

## Validation and Constraints

### Section Validity

A section is **valid** if:
1. `id` is non-empty unique string
2. `name` is non-empty string
3. `kind` is one of `SongSectionKind`
4. `startSeconds` ≥ 0
5. `endSeconds` > `startSeconds`
6. `endSeconds - startSeconds` ≥ 0.1 (minimum 100ms duration)
7. `color` is valid hex code (e.g., `#rrggbb`)
8. `confidence` is in [0.0, 1.0]
9. `evidence` is non-empty array

### Overlap Detection

Sections **overlap** if `section_i.endSeconds > section_j.startSeconds` AND `section_i.startSeconds < section_j.endSeconds` for any `i ≠ j`.

Confirmation MUST reject overlapping sections.

### Snap Distance

Energy boundary snapping applies only when:
- `|energyBoundary.timeSeconds - sectionBoundary| <= 4.0` seconds
- `energyBoundary.confidence >= 0.65`

---

## Error Handling

### Parsing Errors

- Invalid lyrics file format: log warning, return empty array, show toast: "Could not parse lyrics file"
- Malformed JSON in API response: return error to user with message: "Section analysis failed; please try again"

### State Errors

- Attempting `confirmSections` with overlapping sections: prevent action, show validation error in panel
- Missing sections during generation: show form error: "Please add and confirm at least one section"

### Recovery

- If section inference hangs > 30s: timeout and show "Analysis took too long; using default sections"
- If section edits conflict with concurrent changes: use last-write-wins merge strategy

---

## Testing Expectations

### Unit Tests

**Domain (`packages/music-video-domain/src/sections.test.ts`):**
- Lyric normalization and repetition detection
- Song-form skeleton generation for various durations (< 90s, 90s, 300s, 600s)
- Energy boundary snapping within/outside ±4s window
- Section merging and naming (sequential Verse 1, Verse 2, etc.)

**Store (`apps/web/src/stores/music-video-store.test.ts`):**
- `setInferredSections` stores and marks unconfirmed
- `updateSectionBoundary` validates and updates
- `splitSection` creates two sections with correct bounds
- `renameSection` changes kind and color
- `confirmSections` rejects overlapping/invalid sections

**Components:**
- `SectionMetaTrack` renders colored blocks, drag handles, split/rename handlers
- `SectionConfirmationPanel` shows evidence badges, disables confirm button on invalid state

### Integration Tests

- Import audio + optional lyrics → infer sections → confirm → generate storyboard
- Drag section boundary on meta-track → updates store
- Split section → creates two with correct ids and names
- Rename section → updates kind and color
- Manual edit + confirm → sections persisted to project file

---

## Edge Cases and TODOs

### TODO: Lyric Synchronization

- If lyrics file includes timing and audio analysis detects different durations, how to align?
- Consider stretch/warp lyrics to match detected audio duration.

### TODO: Manual Section Creation

- Allow user to create sections from scratch (not just infer)?
- Panel should have "Add Section" button if needed.

### TODO: Section Metadata

- Future: attach reference assets, color themes, or visual motifs per section?

### TODO: Confidence Calculation

- Currently max of evidence confidences; consider weighted average based on evidence reliability?

---

## Accessibility

- Section meta-track MUST be keyboard-navigable (Tab through sections, arrow keys to adjust boundaries)
- Evidence badges MUST have tooltips explaining abbreviations (`lyrics`, `energy`, etc.)
- Color palette SHOULD have sufficient contrast for colorblind users (consider adding icons/patterns in addition to color)
- Section names MUST be read by screen readers

---

## Performance

- Section inference SHOULD complete in < 1 second for audio up to 30 minutes
- Rendering 100+ sections in meta-track SHOULD maintain 60 FPS
- Snapping calculations SHOULD not block UI (consider debouncing or Web Worker for large section sets)

---

## References

- Implementation Plan: [Section Identification Flow plan](../superpowers/plans/2026-07-03-section-identification-flow.md)
- Related Audio Analysis Plan: [Audio Analysis & Selection plan](../superpowers/plans/2026-07-03-audio-analysis-and-selection.md)
- Related Generate Storyboard Plan: [Generate Storyboard Tool plan](../superpowers/plans/2026-07-03-generate-storyboard-tool.md)
- Related Alter Storyboard Plan: [Alter Storyboard Tool plan](../superpowers/plans/2026-07-03-alter-storyboard-tool.md)
