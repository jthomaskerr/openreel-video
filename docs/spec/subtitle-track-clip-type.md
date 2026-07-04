# Subtitle Track/Clip Type Operational Specification

**Version:** 1.0  
**Status:** Specification (Implementation planned)  
**Last Updated:** 2026-07-04  
**Source Plan:** `docs/superpowers/plans/2026-07-03-subtitle-track-clip-type.md`

---

## Executive Summary

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

## 1. Domain Model

### 1.1 SubtitleClip Type

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

### 1.2 Track and Timeline Integration

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

## 2. Subtitle Clip Management

### 2.1 SubtitleClipManager

**File:** `packages/core/src/timeline/subtitle-clip-manager.ts` (NEW)

The `SubtitleClipManager` provides factory, CRUD, and bulk operations for subtitle clips on tracks.

#### 2.1.1 Creation

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

## 3. Store Actions and Persistence

### 3.1 Project Store Subtitle Actions

**Files Modified:**
- `apps/web/src/stores/project-store.ts`
- `apps/web/src/stores/project/subtitle-helpers.ts`
- `apps/web/src/stores/project/types.ts`

**Changes:**

All subtitle operations MUST be rewritten to delegate to `SubtitleClipManager` and operate on clips on `"subtitle"` tracks, not the flat `timeline.subtitles` array.

#### 3.1.1 addSubtitle

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

#### 3.1.2 removeSubtitle

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

#### 3.1.3 updateSubtitle

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

#### 3.1.4 importSRT

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

#### 3.1.5 exportSRT

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

#### 3.1.6 applySubtitleStylePreset

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

### 3.2 Backward Compatibility and Migration

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

## 4. Timeline UI Components

### 4.1 SubtitleClipComponent

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

### 4.2 Timeline Track Integration

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

### 4.3 Timeline Trim Enablement

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

## 5. Preview Rendering

### 5.1 Preview Component Updates

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

### 5.2 Canvas Renderer Updates

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

## 6. Export Rendering

### 6.1 Export Engine Integration

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

## 7. Inspector UI

### 7.1 SubtitleInspectorPanel

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

### 7.2 Inspector Tab Integration

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

### 7.3 Auto-Caption Panel Update

**File:** `apps/web/src/components/editor/inspector/AutoCaptionPanel.tsx` (MODIFIED)

Update the speech-to-text caption generation button to use the new `addSubtitle` action (which now creates subtitle clips instead of text clips). No UI changes needed, only ensure the action delegation is updated.

---

## 8. Serialization and Persistence

### 8.1 Project JSON Serialization

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

### 8.2 Migration on Project Load

**File:** `apps/web/src/stores/project-store.ts`

See **Section 3.2 Backward Compatibility and Migration** above. The `migrateSubtitles()` function runs on every `loadProject()` call to detect and convert the old flat subtitle format.

---

## 9. SRT File Drop Handling

### 9.1 Drag-and-Drop Integration

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

## 10. Testing Strategy

### 10.1 Unit Tests

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

### 10.2 Integration Tests

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

### 10.3 UI Component Tests

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

## 11. Migration and Deprecation Timeline

### 11.1 Phase 1: New Subtitle Clips (Current)

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

### 11.2 Phase 2: Deprecation (v2.x)

**Actions:**
- Remove auto-migration code (projects with old format rejected)
- Remove `TextClip` fallback on subtitle tracks
- Add warnings if code tries to access `timeline.subtitles`

### 11.3 Phase 3: Cleanup (v3.x)

**Actions:**
- Remove `Timeline.subtitles` field
- Remove deprecated methods from `SubtitleEngine`
- Remove any dead code references

---

## 12. Constraints and Assumptions

### 12.1 Functional Constraints

| Constraint | Rationale |
|-----------|-----------|
| Subtitle clips MUST have `startTime >= 0` | Negative time is invalid |
| Subtitle clips MUST have `duration > 0` | Zero/negative duration makes no sense |
| Clip text MAY contain `\n` for multi-line | Standard newline handling |
| Clips on same track SHOULD NOT overlap | TODO: Clarify overlap handling (allow? merge? warn?) |
| SubtitleClipManager works with tracks[] array | Stateless, pure functions for undo/redo |
| SRT import creates clips at extracted timings | Do NOT reposition based on track location |

### 12.2 API Boundaries

| Boundary | Constraint |
|----------|-----------|
| `SubtitleClipManager` | Operates on `Track[]` array; returns updated array or error object |
| Store actions | Delegate to manager; maintain undo/redo; notify subscribers |
| Timeline component | Renders clips; delegates trim/move to store |
| Preview canvas | Reads clips from tracks; uses existing subtitle renderers |
| Inspector | Edits clip properties via store actions; no direct clip mutation |

### 12.3 Assumptions

- `SubtitleStyle` and `CaptionAnimationStyle` types are stable and reusable
- `SRT` file format follows RFC 6597 (or similar standard)
- Subtitle tracks are not meant for audio content (dedicated "audio" track type exists)
- Export engine uses the same canvas rendering as preview (or is updated in parallel)

---

## 13. Open Questions and TODOs

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

## 14. File Change Summary

### New Files
- `packages/core/src/types/subtitle-clip.ts`
- `packages/core/src/timeline/subtitle-clip-manager.ts`
- `apps/web/src/components/editor/timeline/SubtitleClipComponent.tsx`
- `apps/web/src/components/editor/inspector/SubtitleInspectorPanel.tsx`
- `packages/core/src/timeline/subtitle-clip-manager.test.ts` (test)

### Modified Files
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

### Removed/Deprecated
- `Timeline.subtitles` field (deprecated; removed in Phase 3)
- `createTextClip` workaround for subtitles (redirect to `SubtitleClipManager`)
- Orphaned test skip markers

---

## Appendix A: Type Definitions

### A.1 SubtitleClipData (optional pattern)

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

### A.2 Helper Functions

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

## Appendix B: References

**Source Plan:** `/docs/superpowers/plans/2026-07-03-subtitle-track-clip-type.md`

**Related Specs:**
- (TBD) Track and Clip Architecture spec
- (TBD) Export Engine spec

**Standards:**
- SRT format: RFC 6597 (WebVTT) or de facto SRT standard
- JSON serialization: Standard JSON conventions
- React component patterns: Project conventions (TBD reference)

---

**End of Specification**

*This document is a living specification. Updates and clarifications MAY be added as implementation progresses. All changes MUST be tracked in the header and in ADR records.*
