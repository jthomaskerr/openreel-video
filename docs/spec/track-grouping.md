# Track Grouping — Operational Spec

**Document Version:** 1.0
**Date:** 2026-07-04
**Status:** Complete Operational Spec
**Reference Plan:** [Track Grouping Expansion plan](../superpowers/plans/2026-07-03-track-grouping-expansion.md)

---

## Overview

This specification defines the timeline track grouping system that organizes video, metadata, and audio tracks into logical groups (storyboard, characters, sections, metadata, audio, and fallback) with expand/collapse UI controls. Grouping is derived from track properties and clip metadata without modifying the timeline's internal track data or project serialization.

---

## 1. Architecture Principles

### 1.1 Grouping Model

- Track grouping is a **view-layer concern only**. It MUST NOT mutate `Track` data, clip metadata, or project files.
- Grouping is **derived synchronously** from existing track and clip metadata using pure functions (`groupTimelineTracks`).
- Expansion state is **stored in the UI store** (Zustand), not in project data.
- Storyboard clips are specialized video clips with explicit metadata (`kind: "storyboard-shot"`) that link to `StoryboardShot` creative records.

### 1.2 Data Separation

- **`StoryboardShot`** (in `@openreel/music-video-domain`): Owns creative metadata (label, prompt, reference images, generated assets, validation).
- **`Clip` with `StoryboardClipMetadata`** (in `@openreel/core` timeline): Owns placement, timing, and track assignment on the timeline.
- **`Track`**: Continues to be the fundamental timeline unit; storyboard and non-storyboard video tracks remain in the same model.

---

## 2. Timeline Group Identifiers and Labels

### 2.1 TimelineGroupId Type

```
TimelineGroupId = "storyboard"
                | "characters"
                | "sections"
                | "metadata"
                | "audio"
                | `track:${string}`
```

### 2.2 Group Definitions

| Group ID | Label | Kind | Default Expanded | Membership Rules |
|----------|-------|------|------------------|------------------|
| `storyboard` | Storyboard | storyboard | ✓ | Video tracks containing one or more clips with `metadata.kind === "storyboard-shot"` |
| `characters` | Characters | characters | ✗ | Metadata or video tracks matching `name.toLowerCase().startsWith("character:")` OR containing clips with `metadata.kind === "continuity_note"` |
| `sections` | Sections | sections | ✓ | Tracks named exactly "Sections" (case-insensitive) OR tracks containing clips with `metadata.kind === "section"` |
| `metadata` | Metadata | metadata | ✗ | Metadata-type tracks NOT matching section or character rules |
| `audio` | Audio | audio | ✓ | Audio-type tracks |
| `track:${id}` | Track name | single | ✓ | Ungrouped video tracks (fallback) |

---

## 3. Grouping Rules and Classification

### 3.1 Classification Logic

The grouping algorithm MUST process tracks in order and apply the following classification rules in sequence:

1. **Storyboard Track Detection:** A video track IS a storyboard track if ANY clip in that track has `metadata.kind === "storyboard-shot"` and passes the storyboard clip validation (see § 3.3).

2. **Character Track Detection:** A metadata or any-type track IS a character track if:
   - The track name starts with `"character:"` (case-insensitive comparison), OR
   - ANY clip in that track has `metadata.kind === "continuity_note"`

3. **Section Track Detection:** A metadata-type track IS a section track if:
   - The track name equals `"Sections"` (case-insensitive), OR
   - ANY clip in that track has `metadata.kind === "section"`

4. **Metadata Track Detection:** A metadata-type track that did NOT match character or section rules is a metadata track.

5. **Audio Track Detection:** An audio-type track is an audio track.

6. **Fallback Ungrouped Tracks:** Video tracks that are NOT storyboard tracks are grouped individually as single-track groups with ID `track:${trackId}`.

### 3.2 Group Ordering

Groups MUST appear in the timeline in this order:
1. Storyboard (if present)
2. Characters (if present)
3. Sections (if present)
4. Metadata (if present)
5. Audio (if present)
6. Fallback single-track groups (in the order they appear in the timeline)

### 3.3 Storyboard Clip Validation

A clip qualifies as a storyboard clip if and only if:
- Track type is `"video"`
- `clip.metadata` exists and is a record
- `clip.metadata.kind === "storyboard-shot"`
- `clip.metadata.shotId` is a string
- `clip.metadata.shotIndex` is a number
- `clip.metadata.label` is a string
- `clip.metadata.prompt` is a string
- `clip.metadata.source` is one of: `"neuralframes"`, `"storyboard-generation"`, `"manual"`

---

## 4. Storyboard Clip Metadata Contract

### 4.1 StoryboardClipMetadata

Clips in video tracks that represent storyboard shots MUST carry metadata conforming to this interface:

```ts
interface StoryboardClipMetadata {
  // Marks a timeline video clip as the clip-level specialization of a StoryboardShot.
  kind: "storyboard-shot";

  // Foreign key to the StoryboardShot in the project.shots array.
  shotId: string;

  // Index of the shot within the storyboard sequence (for ordering).
  shotIndex: number;

  // Human-readable short name for the shot (e.g., "Opening", "Chorus A").
  label: string;

  // Generation prompt or description.
  prompt: string;

  // Optional reference image URL for the shot.
  referenceImageUrl?: string;

  // Array of generated or imported asset IDs associated with this shot.
  generatedAssetIds: string[];

  // Source of the shot definition: "neuralframes", "storyboard-generation", or "manual".
  source: "neuralframes" | "storyboard-generation" | "manual";

  // Optional record of the import source system (e.g., "neuralframes" for AI imports).
  importSource?: string;

  // Optional import system record ID.
  importId?: string;
}
```

### 4.2 StoryboardClipLink

A helper type that binds a clip-to-shot relationship for querying:

```ts
interface StoryboardClipLink {
  clipId: string;
  trackId: string;
  shotId: string;
  startSeconds: number;
  endSeconds: number;
}
```

### 4.3 StoryboardClipSource

Discriminates the origin of a storyboard-shot clip:

```ts
type StoryboardClipSource = "neuralframes" | "storyboard-generation" | "manual";
```

---

## 5. UI Store: Timeline Group Expansion State

### 5.1 UIState Extensions

The Zustand UI store MUST expose group expansion state and control actions:

```ts
interface UIState {
  // Persistent record of expanded/collapsed state per TimelineGroupId.
  timelineGroupExpansion: Record<string, boolean>;

  // Set expanded state for a group. Unknown groups default to expanded on next query.
  setTimelineGroupExpanded: (groupId: TimelineGroupId, expanded: boolean) => void;

  // Toggle the current expanded state of a group.
  toggleTimelineGroupExpanded: (groupId: TimelineGroupId) => void;

  // Read the current expanded state. Defaults to true if unknown.
  isTimelineGroupExpanded: (groupId: TimelineGroupId) => boolean;
}
```

### 5.2 Default Expansion State

When the store initializes, it SHOULD set these defaults:

| Group ID | Default |
|----------|---------|
| `storyboard` | expanded (true) |
| `characters` | collapsed (false) |
| `sections` | expanded (true) |
| `metadata` | collapsed (false) |
| `audio` | expanded (true) |
| `track:*` | expanded (true) |

### 5.3 Persistence Scope

- Expansion state MUST NOT be serialized to project files.
- Expansion state MAY be persisted to localStorage or session storage for user convenience (out of scope for this spec; implementation detail).
- Expanding/collapsing a group MUST NOT modify any timeline `Track`, `Clip`, or `StoryboardShot` data.

---

## 6. TrackGroupHeader Component

### 6.1 Purpose

A presentational header row that appears above each track group in the timeline. It MUST NOT import or depend on the UI store; its state is passed via props.

### 6.2 Interface

```ts
interface TrackGroupHeaderProps {
  label: string;              // e.g., "Characters", "Storyboard"
  trackCount: number;         // Number of tracks in the group
  clipCount: number;          // Total clips across all tracks in the group
  expanded: boolean;          // Current expansion state
  onToggle: () => void;       // Callback when user clicks expand/collapse
}
```

### 6.3 Rendering Requirements

- MUST display a chevron icon (right when collapsed, down when expanded) to indicate state.
- MUST display the group label.
- MUST display singular/plural counts: `"1 track"` or `"N tracks"`, `"1 clip"` or `"N clips"`.
- MUST be an accessible button with `aria-label` indicating the action: e.g., `"Collapse Characters"` or `"Expand Storyboard"`.
- SHOULD have a minimum height of 8 (Tailwind `h-8`) and subtle background color (e.g., `bg-muted/35`).
- SHOULD highlight on hover.
- Font weight MAY be increased when expanded to provide visual feedback.

### 6.4 Accessibility

- The toggle button MUST have an `aria-label` like `"{expanded ? 'Collapse' : 'Expand'} ${label}"`.
- The header MUST be keyboard-navigable via Tab and Enter/Space.

---

## 7. ShotMetadataMetaTrack Component

### 7.1 Purpose

A special timeline meta-track that displays storyboard shot metadata in two densities:

- **Expanded:** Full shot cards with title, prompt, reference image, timing, and output count.
- **Collapsed:** Compact label strip showing only shot titles.

The meta-track MUST render only for the `storyboard` group and only when that group is expanded or collapsed with the compact labels still visible.

### 7.2 Interface

```ts
interface ShotMetadataMetaTrackProps {
  shots: StoryboardClipWithShot[];  // Array of joined clip-shot pairs
  durationSeconds: number;          // Total timeline duration for percentage calculations
  expanded: boolean;                // Expansion state from UI store
}
```

### 7.3 StoryboardClipWithShot Type

```ts
interface StoryboardClipWithShot {
  clip: Clip;                       // The video clip from the timeline
  track: Track;                     // The owning video track
  shot: StoryboardShot;             // The linked storyboard shot record
  metadata: StoryboardClipMetadata;  // Validated metadata from clip.metadata
}
```

### 7.4 Rendering Behavior

#### 7.4.1 Expanded Mode

When `expanded === true`:
- MUST render the meta-track with height `h-32` (128px).
- MUST position each shot as an absolutely-positioned card within the track.
- Each card MUST show:
  - Reference image (56×56px, object-cover) or a placeholder (`"No ref"`).
  - Shot label (title) or fallback label.
  - Prompt text (truncated to 3 lines), rendered with inline character/reference pills per `inspector-shell.md` §3.8 (Character Pills in Prompt Fields) — truncation MUST NOT fall back to plain text.
  - Timing as `"HH:MM:SS–HH:MM:SS"` or decimal seconds format.
  - Generated asset count: `"1 output"` or `"N outputs"`.
- Cards MUST be positioned by clip start time and sized by clip duration as percentages of total timeline duration.
- Cards SHOULD have rounded borders, shadow, and appropriate padding for readability.

#### 7.4.2 Collapsed Mode

When `expanded === false`:
- MUST render the meta-track with height `h-7` (28px).
- MUST position each shot as a compact label-only card.
- Each card MUST show only the shot label, truncated to fit its width.
- Cards SHOULD use a muted background color.
- Cards SHOULD use smaller font (e.g., `text-[10px]`).

#### 7.4.3 Positioning

- Card horizontal position: `left = (clip.startTime / durationSeconds) * 100%`
- Card width: `width = (clip.duration / durationSeconds) * 100%`
- Positions MUST be clamped to `[0%, 100%]` to prevent overflow.

### 7.5 Ordering

- Shots MUST be rendered in order of `clip.startTime` (ascending).
- If two clips start at the same time, sort by `metadata.shotIndex` (ascending).

---

## 8. Track Grouping Function

### 8.1 groupTimelineTracks

A pure, synchronous function that derives a list of `TimelineTrackGroup` from a flat array of tracks:

```ts
function groupTimelineTracks(tracks: readonly Track[]): TimelineTrackGroup[]
```

### 8.2 TimelineTrackGroup Interface

```ts
interface TimelineTrackGroup {
  id: TimelineGroupId;                    // Unique group identifier
  kind: "storyboard" | "characters" | "sections" | "metadata" | "audio" | "single";
  label: string;                           // Human-readable label
  tracks: Track[];                         // Member tracks in original order
  defaultExpanded: boolean;                // Recommended initial expansion state
}
```

### 8.3 Algorithm

1. Iterate through all input tracks in order.
2. Classify each track using the rules in § 3.1.
3. Accumulate tracks into buckets: `storyboard`, `characters`, `sections`, `metadata`, `audio`, `fallback`.
4. For each non-empty bucket, create a `TimelineTrackGroup` with the group ID, kind, label, and member tracks.
5. For each track in `fallback`, create a single-track group with ID `track:${trackId}`.
6. Return groups in the order specified in § 3.2.
7. Omit empty groups (groups with zero tracks).

### 8.4 Properties

- **Idempotent:** Multiple calls with the same track array MUST produce identical group arrays.
- **Order-preserving:** Tracks within a group MUST maintain their original order from the input array.
- **Pure:** The function MUST NOT modify any input or have side effects.

---

## 9. Storyboard Clip Helpers

### 9.1 Helper Functions

#### 9.1.1 getStoryboardClipMetadata(clip: Clip): StoryboardClipMetadata | null

Extracts and validates storyboard metadata from a clip. Returns null if the clip does not qualify as a storyboard clip (see § 3.3).

#### 9.1.2 isStoryboardVideoClip(track: Track, clip: Clip): boolean

Returns true if the track is a video track AND the clip passes storyboard validation. Useful for filtering during grouping and collection.

#### 9.1.3 joinStoryboardClipToShot(clip: Clip, shots: readonly StoryboardShot[]): StoryboardClipWithShot | null

Finds the matching `StoryboardShot` by `metadata.shotId` and returns a joined record, or null if no match is found.

#### 9.1.4 collectStoryboardClipShots(tracks: readonly Track[], shots: readonly StoryboardShot[]): StoryboardClipWithShot[]

Collects all storyboard clip-shot pairs from the timeline in ascending order by clip start time, then by shot index.

### 9.2 Module

These helpers MUST be exported from a new module `apps/web/src/components/editor/timeline/storyboard-clip.ts`.

---

## 10. Timeline Component Integration

### 10.1 Render Pipeline

The `Timeline` component MUST:

1. **Compute groups:** Derive `TimelineTrackGroup[]` from `timeline.tracks` using `groupTimelineTracks`.
2. **Collect storyboard clips:** Gather `StoryboardClipWithShot[]` from the timeline and project shots using `collectStoryboardClipShots`.
3. **For each group:**
   - Render a `TrackGroupHeader` with:
     - `label`: from group
     - `trackCount`: group.tracks.length
     - `clipCount`: sum of all clips in the group
     - `expanded`: from `useUIStore().isTimelineGroupExpanded(group.id)`
     - `onToggle`: calls `useUIStore().toggleTimelineGroupExpanded(group.id)`
   - If `group.kind === "storyboard"` and expanded is true:
     - Render `ShotMetadataMetaTrack` with storyboard clip shots
   - If expanded:
     - Render all tracks in the group using the existing track-row rendering logic

### 10.2 Testing Requirements

- MUST include tests that verify:
  - Group headers render in the correct order.
  - Collapsing a group hides its child tracks.
  - Expanding a group shows child tracks.
  - The storyboard meta-track appears when the storyboard group is expanded.
  - Existing clip rendering inside groups remains unchanged.

---

## 11. StoryboardPanel Integration

### 11.1 Shot Selection Source

The `StoryboardPanel` component MUST prioritize storyboard clip-shot pairs as the source of truth for shot ordering:

1. Collect storyboard clip-shot pairs from the active timeline using `collectStoryboardClipShots`.
2. If clip-shot pairs exist (length > 0):
   - Use the shots from the pairs, in their order.
3. Else:
   - Fall back to `project.shots` sorted by `index` (ascending).

### 11.2 Selection Action

When a user selects a shot in the storyboard panel:
- MUST call `selectShot(projectId, shot.id, true)` to mark the shot as selected in the project.
- MAY also select the owning clip in the timeline store if such functionality is available (optional for this spec).

### 11.3 Neural Frames Import Compatibility

- Clips imported from Neural Frames MUST carry `metadata.kind = "storyboard-shot"`.
- The storyboard panel MUST treat Neural Frames imported clips and manually-created storyboard clips identically.
- The panel's UI and ordering MUST update reactively when clips are added, removed, or reordered in the timeline.

---

## 12. Data Flow and Constraints

### 12.1 No Mutation of Track or Project Data

- Expanding/collapsing groups MUST NOT modify `Track` objects, `Clip` metadata, or project files.
- Grouping state is entirely view-layer; any persistence is to the UI store only.

### 12.2 Clip-Level Metadata Not Stored

- `StoryboardClipMetadata` is stored within `clip.metadata` as key-value pairs.
- The `kind: "storyboard-shot"` marker is the key discriminator that identifies storyboard clips.
- No new clip subtypes or timeline data structures are introduced.

### 12.3 Backward Compatibility

- Existing `metadata.shotId` (without `kind: "storyboard-shot"`) MAY be accepted during migration:
  - Type guards can fallback: `metadata.importSource === "neuralframes" && typeof metadata.shotId === "string"`
  - This is a temporary allowance; new imports MUST write the explicit `kind: "storyboard-shot"` marker.

### 12.4 Storyboard Shot Remains Unchanged

- `StoryboardShot` records (in `project.shots`) are NOT modified by this spec.
- The only new relationship is the clip-to-shot link via `metadata.shotId` and the explicit `kind: "storyboard-shot"` marker.

---

## 13. Error Handling and Edge Cases

### 13.1 Missing Storyboard Shots

If a clip has `metadata.shotId = "shot-x"` but no `StoryboardShot` with ID `"shot-x"` exists in `project.shots`:
- The clip STILL qualifies as a storyboard clip (classification is independent of shot existence).
- The storyboard group STILL renders with the clip.
- `joinStoryboardClipToShot` returns null; the clip is not included in the meta-track.
- Timeline rendering MUST be robust to this mismatch (continue rendering other clips).

### 13.2 Empty Groups

Groups with zero tracks MUST NOT render (must be omitted from the final group list).

### 13.3 Duration Calculations

When the timeline duration is 0 or very small, percentage calculations MUST not produce infinity or invalid percentages:
- Clamp duration to a minimum of 0.001 seconds for division.
- Clamp resulting percentages to `[0, 100]`.

### 13.4 Malformed Metadata

If a clip's metadata is present but incomplete (e.g., missing `shotIndex`):
- The clip MUST NOT qualify as a storyboard clip.
- The clip MAY still be rendered as a regular video clip (if in a video track).

---

## 14. Testing and Verification

### 14.1 Unit Tests

- **storyboard-clip.test.ts:**
  - Recognize Neural Frames scene clips as storyboard video clips.
  - Reject metadata-only clips even with `shotId`.
  - Join clips to matching `StoryboardShot` records.
  - Handle missing shots gracefully.

- **track-groups.test.ts:**
  - Group storyboard, character, section, metadata, audio, and fallback tracks.
  - Preserve track order within groups.
  - Omit empty groups.
  - Classify character tracks by name prefix and continuity metadata.

- **ui-store.test.ts:**
  - Track group expansion state.
  - Default expansion state matches specification.
  - Unknown groups default to expanded.

- **TrackGroupHeader.test.tsx:**
  - Render label, track count, clip count.
  - Render chevron icon (right when collapsed, down when expanded).
  - Call `onToggle` when clicked.
  - Provide accessible `aria-label`.

- **ShotMetadataMetaTrack.test.tsx:**
  - Render expanded shot cards with title, prompt, reference image, timing, output count.
  - Render collapsed label-only cards.
  - Position cards correctly by clip timing.
  - Handle missing reference images.

### 14.2 Integration Tests

- **Timeline.track-groups.test.tsx:**
  - Render group headers in correct order.
  - Collapse a group and verify child tracks disappear.
  - Expand a group and verify child tracks appear.
  - Render storyboard meta-track when storyboard group is expanded.
  - Verify clip rendering remains unchanged inside expanded groups.

- **GroupedStoryboardTimeline.e2e.test.tsx:**
  - Full integration: storyboard clips, character tracks, section tracks, metadata tracks.
  - Verify group headers, expansion control, and meta-track rendering.
  - Verify StoryboardPanel displays the same shot ordering as the timeline.

### 14.3 Acceptance Criteria

All tests listed above MUST pass. Specific acceptance criteria:
- Neural Frames imported scene clips drive timeline meta-track cards and storyboard panel ordering.
- Track groups expand/collapse without altering track or clip data.
- Character and metadata tracks are grouped separately.
- Storyboard shots remain editable creative records; their timeline representation is a specialized video clip.

---

## 15. Type Definitions and Exports

### 15.1 Type Exports from @openreel/music-video-domain

```ts
export type { StoryboardClipMetadata, StoryboardClipLink, StoryboardClipSource };
```

### 15.2 Type Exports from apps/web/src/stores/ui-store.ts

```ts
export type TimelineGroupId;
export interface UIState {
  timelineGroupExpansion: Record<string, boolean>;
  setTimelineGroupExpanded: (groupId: TimelineGroupId, expanded: boolean) => void;
  toggleTimelineGroupExpanded: (groupId: TimelineGroupId) => void;
  isTimelineGroupExpanded: (groupId: TimelineGroupId) => boolean;
}
```

### 15.3 Type Exports from apps/web/src/components/editor/timeline/track-groups.ts

```ts
export type TimelineTrackGroupKind;
export interface TimelineTrackGroup;
export function groupTimelineTracks(tracks: readonly Track[]): TimelineTrackGroup[];
```

### 15.4 Type Exports from apps/web/src/components/editor/timeline/storyboard-clip.ts

```ts
export interface StoryboardClipWithShot;
export function getStoryboardClipMetadata(clip: Clip): StoryboardClipMetadata | null;
export function isStoryboardVideoClip(track: Track, clip: Clip): boolean;
export function joinStoryboardClipToShot(clip: Clip, shots: readonly StoryboardShot[]): StoryboardClipWithShot | null;
export function collectStoryboardClipShots(tracks: readonly Track[], shots: readonly StoryboardShot[]): StoryboardClipWithShot[];
```

---

## 16. Implementation Notes and Gotchas

### 16.1 Package Boundaries

- `@openreel/core` MUST NOT import `@openreel/music-video-domain`.
- Shared metadata shapes live in the domain package.
- Type guards and helpers that apply the metadata to core `Clip` values live in the web app layer.

### 16.2 Existing Neural Frames Imports

- Existing imported projects may have `metadata.shotId` without `metadata.kind = "storyboard-shot"`.
- Type guards MAY accept a fallback: `metadata.importSource === "neuralframes" && typeof metadata.shotId === "string"` during migration.
- New imports MUST write the explicit `kind: "storyboard-shot"` marker.

### 16.3 Collapsed Storyboard Group

- Collapsing the storyboard group MUST hide the raw video tracks.
- The compact shot metadata strip MUST remain visible so shot timing is navigable.
- This is achieved by rendering the `ShotMetadataMetaTrack` in both expanded and collapsed modes.

### 16.4 Store Dependencies

- `Timeline.tsx` MUST import `useUIStore()` to read and control group expansion state.
- `TrackGroupHeader.tsx` MUST accept expansion state as a prop; it does NOT import the store.
- This keeps the header component reusable and testable without store mocks.

---

## 17. Future Extensions

The following capabilities are out of scope but anticipated:

- **Drag-and-drop reordering** of tracks between groups or within groups.
- **Nested grouping** of metadata tracks (e.g., characters > lead, characters > background).
- **Persistent expansion state** to localStorage or per-project settings.
- **Group filtering** or search to hide irrelevant tracks.
- **Storyboard shot editing** directly from timeline cards (currently edit-only in StoryboardPanel).

---

## Appendix A: Example Timeline Structure

```
Project: Music Video
Timeline:
  ├─ Track Group: Storyboard (expanded)
  │   ├─ TrackGroupHeader: "Storyboard", 1 track, 3 clips
  │   ├─ ShotMetadataMetaTrack: (expanded cards showing all 3 shots)
  │   └─ Video Track: "Neural Frames Scenes"
  │       ├─ Clip: "shot-1" (0–4s, storyboard-shot)
  │       ├─ Clip: "shot-2" (4–8s, storyboard-shot)
  │       └─ Clip: "shot-3" (8–12s, storyboard-shot)
  ├─ Track Group: Characters (collapsed)
  │   ├─ TrackGroupHeader: "Characters", 2 tracks, 4 clips
  │   └─ [Tracks hidden]
  ├─ Track Group: Audio (expanded)
  │   ├─ TrackGroupHeader: "Audio", 1 track, 1 clip
  │   └─ Audio Track: "Main Audio"
  │       └─ Clip: "audio-1" (0–12s)
  └─ Track Group: Metadata (collapsed)
      ├─ TrackGroupHeader: "Metadata", 1 track, 2 clips
      └─ [Tracks hidden]
```

---

## Appendix B: Glossary

| Term | Definition |
|------|-----------|
| **TimelineGroupId** | A unique identifier for a logical track group: `"storyboard"`, `"characters"`, etc., or `track:${id}` for single-track fallback groups. |
| **TimelineTrackGroup** | A view model that groups related tracks with metadata about the group (label, kind, member tracks). |
| **StoryboardClipMetadata** | Metadata on a video clip that marks it as a timeline specialization of a `StoryboardShot`. |
| **StoryboardClipWithShot** | A record that joins a video clip, its track, its metadata, and the linked `StoryboardShot`. |
| **Meta-track** | A special timeline row that displays non-audio, non-video content (e.g., shot metadata cards, section boundaries). |
| **Expansion State** | UI state stored in Zustand that tracks which groups are expanded vs. collapsed. |

---

## Document History

- **v1.0 (2026-07-04):** Initial operational specification written from the [Track Grouping Expansion plan](../superpowers/plans/2026-07-03-track-grouping-expansion.md). Covers all grouping rules, component contracts, data flow, and testing requirements.

