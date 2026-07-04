# New Subtitles Track/Clip Type Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current workaround (subtitles stored as a flat array on Timeline + text clips on a "Captions" track) with a first-class subtitle track type and subtitle clip type that have dedicated rendering, editing, and persistence.

**Architecture:** The current approach stores `Subtitle[]` as a flat list on `Timeline.subtitles` (`packages/core/src/types/timeline.ts:7`) and hijacks `TextClip` via `createTextClip` in `project-store.ts:4883-4933` to show subtitles visually. This makes the two data sources diverge (see the skipped tests at `project-store.test.ts:1628-1644`). The new design introduces a `SubtitleClip` interface, stores it as a real clip on `"subtitle"` tracks, removes the orphaned `Timeline.subtitles` array, and provides a dedicated `SubtitleClipComponent` for the timeline plus an `SubtitleInspectorPanel` for editing.

**Tech Stack:** TypeScript, Zustand stores, Canvas 2D timeline rendering (preview/canvas-renderers.ts), FFmpeg export engine, React inspector panels.

---

## Relevant Source Areas

| Area | Files | Role |
|------|-------|------|
| **Core types** | `packages/core/src/types/timeline.ts` | `Timeline`, `Track`, `Clip`, `Subtitle`, `SubtitleStyle`, `SubtitleWord`, `CaptionAnimationStyle` |
| **Core text** | `packages/core/src/text/subtitle-engine.ts` | `SubtitleEngine` — SRT import/export, style presets, subtitle CRUD on flat array |
| **Core text index** | `packages/core/src/text/index.ts` | Exports subtitle engine and animation renderer |
| **Caption animation** | `packages/core/src/text/caption-animation-renderer.ts` | `renderAnimatedCaption` — word animations (karaoke, typewriter, etc.) |
| **Media types** | `packages/core/src/media/types.ts` | `ProcessedMedia.type` includes `"srt"` |
| **Project types** | `packages/core/src/types/project.ts` | `Project`, `MediaItem` (type includes `"srt"`) |
| **Track Manager** | `packages/core/src/timeline/track-manager.ts` | `createTrack`, `canAcceptMediaType` — already handles `"subtitle"` and `"srt"` |
| **Clip Manager** | `packages/core/src/timeline/clip-manager.ts` | `createClip`, `cloneClip` — works for any track type |
| **Web stores** | `apps/web/src/stores/project-store.ts` | Current `addSubtitle`/`removeSubtitle`/`updateSubtitle` workaround |
| **Store helpers** | `apps/web/src/stores/project/subtitle-helpers.ts` | `parseSRT`, `generateSRT`, `DEFAULT_SUBTITLE_STYLE` |
| **Store helpers** | `apps/web/src/stores/project/types.ts` | `ProjectState` — imports `Subtitle` |
| **Timeline store** | `apps/web/src/stores/timeline-store.ts` | Scrolling, zoom, playhead |
| **Timeline components** | `apps/web/src/components/editor/Timeline.tsx` | Main timeline — renders `TrackLane` for each track |
| **TrackLane** | `apps/web/src/components/editor/timeline/TrackLane.tsx` | Renders clips per track; currently routes subtitle track clips as text clips |
| **ClipComponent** | `apps/web/src/components/editor/timeline/ClipComponent.tsx` | Renders standard video/audio/image clips |
| **TextClipComponent** | `apps/web/src/components/editor/timeline/TextClipComponent.tsx` | Current path for subtitle rendering (hijacked) |
| **Timeline utils** | `apps/web/src/components/editor/timeline/utils.ts` | `getTrackInfo`, `getClipStyle` — already have `"subtitle"` cases |
| **Preview** | `apps/web/src/components/editor/Preview.tsx` | Preview canvas rendering — reads `timeline.subtitles` flat array + text clips on subtitle tracks |
| **Preview canvas** | `apps/web/src/components/editor/preview/canvas-renderers.ts` | `getActiveSubtitles`, `renderSubtitleToCanvas`, `renderStaticSubtitle`, `renderAnimatedSubtitle` |
| **Inspector** | `apps/web/src/components/editor/inspector/AutoCaptionPanel.tsx` | Speech-to-text → `addSubtitle` |
| **Inspector tabs** | `apps/web/src/components/editor/inspector/tabs/AiTab.tsx` | Subtitle generation buttons |
| **Engine store** | `apps/web/src/stores/engine-store.ts` | Lazy-initializes `SubtitleEngine` |
| **Export engine** | `packages/core/src/export/export-engine.ts` | Uses `timeline.subtitles` for duration calculation |
| **Project helpers** | `apps/web/src/stores/project/project-helpers.ts` | `createDefaultTimeline` initializes `subtitles: []` |
| **Tests** | `apps/web/src/stores/project-store.test.ts` | Skipped subtitle tests at lines 1628–1644 |

---

## Task 1 — Core domain model: `SubtitleClip` type and track migration

**Objective:** Define a first-class `SubtitleClip` interface, add it to the `Track.clips` system, deprecate the flat `Timeline.subtitles` array, and ensure `"subtitle"` tracks accept `SubtitleClip` instances as their clips.

### Files to create
- `packages/core/src/types/subtitle-clip.ts` — new `SubtitleClip` interface

### Files to modify
| File | Change |
|------|--------|
| `packages/core/src/types/timeline.ts` | Add `"subtitle-clip"` to the `Clip` discriminated union; optionally mark `Timeline.subtitles` as deprecated |
| `packages/core/src/types/index.ts` | Re-export `SubtitleClip` |
| `packages/core/src/timeline/track-manager.ts` | Verify `canAcceptMediaType` handles `"srt"` → `"subtitle"`; add `canAcceptClipType` if needed |
| `packages/core/src/timeline/clip-manager.ts` | Ensure `createClip` can produce `SubtitleClip` by media type |

### Detailed steps

**1a — Define `SubtitleClip` interface**

```typescript
// packages/core/src/types/subtitle-clip.ts
import type { SubtitleStyle, CaptionAnimationStyle, SubtitleWord } from "./timeline";
import type { Clip } from "./timeline";

export interface SubtitleClip extends Clip {
  readonly type: "subtitle-clip";
  /** The SRT caption text (may contain \n for multi-line) */
  readonly text: string;
  /** Style override for this subtitle */
  readonly style: SubtitleStyle;
  /** Per-word timing data for animated captions */
  readonly words?: SubtitleWord[];
  /** Caption animation style (karaoke, typewriter, etc.) */
  readonly animationStyle?: CaptionAnimationStyle;
  /** Source media ID if imported from an SRT media item */
  readonly sourceMediaId?: string;
}
```

This extends `Clip` and borrows the fields from the existing `Subtitle` interface but makes them part of the clip model. The `mediaId` field inherited from `Clip` can point to the SRT media item in the media library, or empty for manually created subtitles.

**1b — Update Track type (timeline.ts)**

The `Track.type` union already includes `"subtitle"`. No change needed there. But the `Clip` type union should include `SubtitleClip`. In `packages/core/src/types/timeline.ts`, find the `Clip` interface (lines 70–107) and add a `type` discriminant:

```
// Inside Clip interface, add:
readonly type?: "video-clip" | "audio-clip" | "image-clip" | "subtitle-clip";
```

Create a discriminated union type `AnyClip = Clip | SubtitleClip` and use it where `Clip[]` is referenced in `Track.clips`.

Alternatively, keep `Clip` as the base and add an optional `subtitleData?: SubtitleClipData` field — this avoids the union complexity. **Recommended approach:** Keep `Clip` as-is and attach subtitle-specific data to a new `subtitleData` property (matching the pattern of `Clip.metadata` + `Clip.emphasisAnimation`):

```typescript
// Inside Clip interface, after line 106:
readonly subtitleData?: SubtitleClipData;
```

Where `SubtitleClipData` holds text/style/animation — avoids breaking all existing clip consumers.

**1c — Deprecate Timeline.subtitles**

In `packages/core/src/types/timeline.ts`, add a JSDoc `@deprecated` annotation to `Timeline.subtitles` (line 7) and change the default in `project-helpers.ts:16` to `subtitles: []`. All new code reads subtitle data from clips on `"subtitle"` tracks.

### Verification

```bash
# TypeScript compilation
cd packages/core && npx tsc --noEmit
# Run existing core tests
npx vitest run --reporter verbose packages/core/src/timeline/
npx vitest run --reporter verbose packages/core/src/text/
```

---

## Task 2 — `SubtitleClipManager` and clip CRUD on subtitle tracks

**Objective:** Provide a dedicated factory and manager for subtitle clips so the store can create, update, and remove them with proper undo/redo support.

### Files to create
- `packages/core/src/timeline/subtitle-clip-manager.ts`

### Files to modify
| File | Change |
|------|--------|
| `packages/core/src/timeline/index.ts` | Export new manager |
| `packages/core/src/index.ts` | Re-export (already exports `./timeline`) |

### Detailed steps

**2a — SubtitleClipManager class**

```typescript
// packages/core/src/timeline/subtitle-clip-manager.ts
export interface CreateSubtitleClipParams {
  trackId: string;
  text: string;
  startTime: number;
  duration?: number;
  style?: Partial<SubtitleStyle>;
  animationStyle?: CaptionAnimationStyle;
  words?: SubtitleWord[];
  mediaId?: string;
}

export class SubtitleClipManager {
  createClip(params: CreateSubtitleClipParams, tracks: Track[]): { track: Track; clip: SubtitleClip } | { error: string };
  updateText(tracks: Track[], clipId: string, text: string): Track[];
  updateStyle(tracks: Track[], clipId: string, style: Partial<SubtitleStyle>): Track[];
  updateTiming(tracks: Track[], clipId: string, startTime: number, duration: number): Track[];
  removeClip(tracks: Track[], clipId: string): Track[];
  getClipAtTime(tracks: Track[], time: number): SubtitleClip | null;
  getClipsInRange(tracks: Track[], startTime: number, endTime: number): SubtitleClip[];
  importSRTToTrack(tracks: Track[], trackId: string, srtContent: string): { tracks: Track[]; errors: string[] };
  exportSRTFromTrack(tracks: Track[], trackId: string): string;
}
```

The key difference from the existing `SubtitleEngine` is that this operates on `tracks[]` (finding the subtitle track and managing its clips) rather than on the flat `timeline.subtitles` array.

### Verification

```bash
cd packages/core && npx vitest run --reporter verbose packages/core/src/timeline/subtitle-clip-manager.test.ts
```

---

## Task 3 — Migrate `project-store.ts` subtitle actions from flat array to subtitle clips

**Objective:** Rewrite `addSubtitle`, `removeSubtitle`, `updateSubtitle` (and the related `importSRT`, `exportSRT`, `applySubtitleStylePreset`) to operate on `SubtitleClip` instances on `"subtitle"` tracks instead of `timeline.subtitles` + text clip workaround.

### Files to modify
| File | Change |
|------|--------|
| `apps/web/src/stores/project-store.ts` | Rewrite subtitle action implementations (lines 4878–5048); remove text clip creation workaround |
| `apps/web/src/stores/project/subtitle-helpers.ts` | Update helpers to work with clips; keep `parseSRT`/`generateSRT` |
| `apps/web/src/stores/project/types.ts` | Ensure `SubtitleClip` imported |
| `apps/web/src/stores/project/index.ts` | Re-export updated helpers |

### Detailed steps

**3a — Rewrite `addSubtitle`**

Current implementation (lines 4883–4933):
1. Finds/creates a `"text"` or `"subtitle"` track named "Captions"
2. Calls `createTextClip` to create a `TextClip`

New implementation:
1. Finds/creates a `"subtitle"` track named "Captions" (remove the `t.type === "text"` fallback)
2. Calls `SubtitleClipManager.createClip` to create a real `SubtitleClip`
3. Uses the project store's clip add mechanism (not the TitleEngine)

**3b — Rewrite `removeSubtitle`**

Current: filters `project.timeline.subtitles` array and the text clips separately.
New: removes the `SubtitleClip` from its track using `SubtitleClipManager.removeClip`. Since the clip is now stored as a real clip on a track, standard `removeClip` from the existing `ClipManager` can be used.

**3c — Rewrite `updateSubtitle`**

Current: maps over `project.timeline.subtitles` array.
New: delegates to `SubtitleClipManager.updateText` or `updateStyle` which operate on track clips.

**3d — Rewrite `importSRT` and `exportSRT`**

`importSRT` (lines 4978–5008): Currently calls `SubtitleEngine.importSRT` which appends to `timeline.subtitles[]`, then creates text clips. New: delegates to `SubtitleClipManager.importSRTToTrack` which creates `SubtitleClip` instances directly on a subtitle track.

`exportSRT` (lines 5009–5015): Currently calls `SubtitleEngine.exportSRT(timeline)`. New: delegates to `SubtitleClipManager.exportSRTFromTrack` which reads subtitle clips from the track.

**3e — Rewrite `applySubtitleStylePreset`**

Currently calls `SubtitleEngine.applyStylePreset` on `timeline.subtitles`. New: iterates over all `SubtitleClip` instances on subtitle tracks and updates their style.

### Verification

```bash
cd apps/web && npx vitest run --reporter verbose src/stores/project-store.test.ts
# Previously skipped subtitle tests should pass now
```

---

## Task 4 — Timeline UI: `SubtitleClipComponent` for subtitle track lanes

**Objective:** Create a dedicated visual component for subtitle clips on the timeline, showing the text content inline and replacing the current TextClipComponent path.

### Files to create
- `apps/web/src/components/editor/timeline/SubtitleClipComponent.tsx`

### Files to modify
| File | Change |
|------|--------|
| `apps/web/src/components/editor/timeline/TrackLane.tsx` | Add rendering branch for `SubtitleClip` on `"subtitle"` tracks |
| `apps/web/src/components/editor/timeline/index.ts` | Export new component |

### Detailed steps

**4a — SubtitleClipComponent**

A React component that:
- Displays the subtitle text (truncated) on the clip block, similar to `TextClipComponent` but styled differently (rose palette, subtitle icon, `"S"` badge)
- Shows a speaker/music note icon for animated captions
- Supports trim handles (left/right edge drag) for timing adjustment
- Supports click-to-select
- Shows multi-line text preview when tall enough
- Context menu: delete, split, change style preset

```typescript
// SubtitleClipComponent.tsx — pattern follows TextClipComponent.tsx
interface SubtitleClipComponentProps {
  clip: SubtitleClip;
  pixelsPerSecond: number;
  isSelected: boolean;
  onSelect: (clipId: string, addToSelection: boolean) => void;
  onTrim: (clipId: string, edge: "left" | "right", newTime: number) => void;
  onMoveClip?: (clipId: string, newStartTime: number) => void;
}
```

**4b — Update TrackLane**

In `TrackLane.tsx` (lines 228–320), add a rendering branch before the text clips section:

```typescript
// After line 243, add:
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
      />
    ))}
```

Also ensure trim callbacks are wired in `Timeline.tsx` (line 1167–1173) — add `"subtitle"` to the trim-enabled track types: `track.type === "video" || track.type === "image" || track.type === "audio" || track.type === "subtitle"`.

### Verification

```bash
cd apps/web && npx vitest run --reporter verbose src/components/editor/timeline/
# Visual: open the app and add subtitles via SRT import; verify they render as subtitle clips
```

---

## Task 5 — Preview rendering: route subtitle clips to existing subtitle canvas renderers

**Objective:** The Preview component currently renders subtitles from two sources: (1) `project.timeline.subtitles` flat array and (2) text clips on `"subtitle"` tracks. After the migration, all subtitle data lives in `SubtitleClip` instances on tracks. Route these through the existing `getActiveSubtitles`/`renderSubtitleToCanvas` pipeline.

### Files to modify
| File | Change |
|------|--------|
| `apps/web/src/components/editor/Preview.tsx` | Remove reading from `project.timeline.subtitles`; read from subtitle track clips instead |
| `apps/web/src/components/editor/preview/canvas-renderers.ts` | Add `getActiveSubtitlesFromClips` or modify existing; keep `renderSubtitleToCanvas` |

### Detailed steps

**5a — Update `Preview.tsx`**

- Remove the `allSubtitles` memo from line 787 that reads `project.timeline.subtitles`
- Replace with a memo that extracts `SubtitleClip` data from all `"subtitle"` tracks:

```typescript
const subtitleClips = useMemo(() => {
  return project.timeline.tracks
    .filter((t) => t.type === "subtitle")
    .flatMap((t) => t.clips)
    .filter(isSubtitleClip);
}, [project.timeline.tracks]);
```

- Update every call site (there are about 10 in Preview.tsx) to pass `subtitleClips` instead of `allSubtitles` to `getActiveSubtitles` / `renderSubtitleToCanvas`.

**5b — Update canvas-renderers.ts**

The existing `getActiveSubtitles` (line 1602) expects `Subtitle[]` — it checks `currentTime >= sub.startTime && currentTime < sub.endTime`. For `SubtitleClip`, the timing is `clip.startTime` and `clip.startTime + clip.duration`. Add a conversion function or a new `getActiveSubtitleClips`:

```typescript
export const getActiveSubtitleClips = (
  clips: SubtitleClip[],
  currentTime: number,
): SubtitleClip[] => {
  return clips.filter((clip) =>
    currentTime >= clip.startTime && currentTime < clip.startTime + clip.duration
  );
};
```

The `renderSubtitleToCanvas` function expects a `Subtitle` object — since `SubtitleClip` has the same fields (`text`, `style`, `words`, `animationStyle`), either create an overload or extract a common `SubtitleRenderData` type.

### Verification

```bash
cd apps/web && npx vitest run --reporter verbose src/components/editor/preview/canvas-renderers.test.ts
# Visual: play back a timeline with subtitles; verify they appear at correct times
```

---

## Task 6 — Export rendering: include subtitle clip rendering during video export

**Objective:** Ensure the `ExportEngine` renders subtitles from subtitle track clips during video export.

### Files to modify
| File | Change |
|------|--------|
| `packages/core/src/export/export-engine.ts` | Update duration calculation (line 1395–1400) to consider subtitle track clips; add subtitle rendering to frame pipeline |

### Detailed steps

**6a — Duration calculation**

Update lines 1395–1400 to compute max end time from subtitle track clips:

```typescript
// Instead of timeline.subtitles, iterate subtitle tracks:
for (const track of timeline.tracks) {
  if (track.type === "subtitle") {
    for (const clip of track.clips) {
      const end = clip.startTime + clip.duration;
      if (end > maxEndTime) maxEndTime = end;
    }
  }
}
```

**6b — Frame rendering**

The export engine's frame rendering loop already uses the same canvas rendering pipeline as the preview. If the preview is updated in Task 5, the export path will automatically pick up subtitles from clips. Verify the export path uses the same `renderSubtitleToCanvas` calls or has its own subtitle rendering — if separate, update it to read from track clips.

Search for `renderSubtitleToCanvas` or `getActiveSubtitles` references in `packages/core/src/export/` — if none exist, the export path relies on the preview rendering and no change is needed beyond Task 5.

### Verification

```bash
cd packages/core && npx vitest run --reporter verbose src/export/export-engine.test.ts
# Export a test project with subtitle clips; verify subtitles appear in output video
```

---

## Task 7 — Inspector: `SubtitleInspectorPanel` for editing subtitle clips

**Objective:** Provide a dedicated inspector panel for selecting and editing subtitle clip properties (text, style, timing, animation).

### Files to create
- `apps/web/src/components/editor/inspector/SubtitleInspectorPanel.tsx`

### Files to modify
| File | Change |
|------|--------|
| `apps/web/src/components/editor/inspector/InspectorTabs.tsx` | Add subtitle tab routing when a subtitle clip is selected |
| `apps/web/src/components/editor/inspector/index.ts` | Export new panel |
| `apps/web/src/components/editor/inspector/tabs/AnimateTab.tsx` | Add subtitle animation controls |
| `apps/web/src/components/editor/inspector/tabs/StyleTab.tsx` | Add subtitle style controls |

### Detailed steps

**7a — SubtitleInspectorPanel**

A React component that displays when a `SubtitleClip` is selected:

```
┌─────────────────────────────┐
│ Subtitle                     │
│ ┌─────────────────────────┐ │
│ │ [Text editor textarea]  │ │
│ └─────────────────────────┘ │
│ Style Preset: [▼ Default  ] │
│ Font: [Family ▼] Size: [24] │
│ Color: [■ white]            │
│ BG: [■ black 75%]           │
│ Position: [● bottom ○ center ○ top] │
│ Anim: [▼ None    ]          │
│ ┌──────────────────┐        │
│ │   Timeline: 0.5s  │        │
│ │ [  ████████░░░  ] │        │
│ └──────────────────┘        │
│ [Delete] [Split] [Apply SRT]│
└─────────────────────────────┘
```

Fields:
- Text editor (textarea) — multi-line subtitle text
- Style preset dropdown — reuses `SUBTITLE_STYLE_PRESETS` from core
- Font family, size, color, background color, position
- Animation style selector — reuses `CaptionAnimationStyle` from core
- Timing preview (non-editable here; trim via timeline)
- Split button, delete button, export-to-SRT button

**7b — Wire into InspectorTabs**

In `InspectorTabs.tsx`, detect when the selected clip is a `SubtitleClip` and render `SubtitleInspectorPanel` instead of (or in addition to) the standard clip panels.

**7c — Update AutoCaptionPanel**

The existing `AutoCaptionPanel.tsx` currently calls `addSubtitle` (the workaround). After migration, it should call the new `addSubtitleClip` action. No layout change needed.

### Verification

```bash
cd apps/web && npx vitest run --reporter verbose src/components/editor/inspector/
# Visual: select a subtitle clip in the timeline; verify inspector shows subtitle editing panel
```

---

## Task 8 — Persistence: handle subtitle clip serialization in project saves/loads

**Objective:** Ensure subtitle clips are properly serialized and deserialized in project files (JSON storage) and survive auto-save/load cycles.

### Files to modify
| File | Change |
|------|--------|
| `apps/web/src/services/auto-save.ts` | Verify subtitle clip data is serialized |
| `packages/core/src/types/project.ts` | Ensure `SubtitleClip` fields are included in the Project JSON shape |

### Detailed steps

**8a — Verify serialization**

`SubtitleClip` extends `Clip` so all standard Clip fields (`id`, `mediaId`, `trackId`, `startTime`, `duration`, etc.) are automatically serialized. The new `subtitleData` field (or the `SubtitleClip`-specific fields) must be included in JSON serialization. Check that:

1. `JSON.stringify` on a project containing subtitle clips includes all subtitle data
2. `JSON.parse` on a saved project reconstructs subtitle clips correctly
3. The `autoSaveManager` (in `auto-save.ts`) already serializes `project.timeline.tracks` — no additional change needed if `subtitleData` is on the clip object

**8b — Migration path for existing projects**

Projects saved with the old flat `timeline.subtitles` + text clip approach need a one-time migration. Add a migration check in `loadProject` in `project-store.ts`:

```typescript
// On project load, migrate old subtitle format
if (timeline.subtitles && timeline.subtitles.length > 0) {
  const subtitleTrack = ensureSubtitleTrack(timeline);
  for (const sub of timeline.subtitles) {
    subtitleTrack.clips.push(createSubtitleClipFromSubtitle(sub, subtitleTrack.id));
  }
  timeline.subtitles = []; // Clear deprecated field
}
```

### Verification

```bash
# Save a project with subtitle clips, reload it, verify subtitles persist
cd apps/web && npx vitest run --reporter verbose src/stores/project-store.test.ts
# Verify migration: load a fixture with old subtitle format; confirm it migrates
```

---

## Task 9 — Remove orphaned `Timeline.subtitles` array and clean up

**Objective:** Once all consumers have been migrated to subtitle clips on tracks, remove the `subtitles` field from `Timeline`, and delete any dead code.

### Files to modify
| File | Change |
|------|--------|
| `packages/core/src/types/timeline.ts` | Remove `readonly subtitles: Subtitle[];` from `Timeline` interface |
| `packages/core/src/text/subtitle-engine.ts` | Remove methods that operate on `timeline.subtitles` array (or deprecate them); keep `parseSRT`/`exportSRT` as utility functions |
| `apps/web/src/stores/project/project-helpers.ts` | Remove `subtitles: []` from `createDefaultTimeline` |
| `apps/web/src/stores/project-store.ts` | Remove `removeSubtitle`/`updateSubtitle` that filter flat array; keep `addSubtitle` (rewritten) and `getSubtitle` (redirect to `SubtitleClipManager`) |
| `apps/web/src/stores/project/subtitle-helpers.ts` | Update `addSubtitleToProject`/`removeSubtitleFromProject`/`updateSubtitleInProject` to work with clips |

### Verification

```bash
cd packages/core && npx tsc --noEmit
cd apps/web && npx tsc --noEmit
npx vitest run --reporter verbose
```

---

## Task 10 — Tests

**Objective:** Enable the skipped subtitle tests and add new coverage for subtitle clip operations.

### Files to modify
| File | Change |
|------|--------|
| `apps/web/src/stores/project-store.test.ts` | Un-skip and update tests at lines 1628–1644; add tests for add/remove/update subtitle clips, SRT import/export |
| `apps/web/src/test/export-integration.test.ts` | Un-skip and update tests at lines 298–309 |
| `packages/core/src/timeline/subtitle-clip-manager.test.ts` | New file: unit tests for `SubtitleClipManager` |

### Test cases per file

**project-store.test.ts subtitle block:**
- `addSubtitle creates a SubtitleClip on a subtitle track, not a text clip`
- `addSubtitle finds existing Captions track`
- `addSubtitle creates a Captions track if none exists`
- `removeSubtitle removes the clip from the track`
- `updateSubtitle updates text, timing, and style on the clip`
- `importSRT creates SubtitleClips from valid SRT content`
- `importSRT returns errors for malformed SRT`
- `exportSRT generates valid SRT from subtitle clips`
- `applySubtitleStylePreset updates style on all subtitle clips`
- `getSubtitle returns the correct SubtitleClip by ID`
- `SubtitleClip style presets are applied correctly`

**export-integration.test.ts:**
- `Subtitle clips are rendered during export with correct timing`

**subtitle-clip-manager.test.ts:**
- `createClip validates startTime >= 0`
- `createClip validates endTime > startTime`
- `createClip assigns unique id and defaults`
- `updateText finds clip by id and updates text`
- `updateStyle merges partial style`
- `updateTiming validates constraints`
- `removeClip removes only the targeted clip`
- `getClipAtTime finds correct clip`
- `getClipsInRange returns clips overlapping range`
- `importSRTToTrack creates clips from valid SRT`
- `importSRTToTrack returns errors for invalid entries`
- `exportSRTFromTrack generates valid SRT from clips`

### Verification

```bash
cd apps/web && npx vitest run --reporter verbose src/stores/project-store.test.ts
cd apps/web && npx vitest run --reporter verbose src/test/export-integration.test.ts
cd packages/core && npx vitest run --reporter verbose src/timeline/subtitle-clip-manager.test.ts
```

---

## Task 11 — SRT file drop: create subtitle track and clips when dropping SRT files

**Objective:** When a user drops an SRT file onto the timeline, create a new subtitle track with subtitle clips instead of treating it as a generic media clip.

### Files to modify
| File | Change |
|------|--------|
| `apps/web/src/components/editor/Timeline.tsx` | `handleDropOnEmpty` and `handleDropMedia` — detect `"srt"` media type and route to subtitle track creation |
| `apps/web/src/components/editor/timeline/TrackLane.tsx` | `handleDrop` — detect SRT drops and route to subtitle |

### Detailed steps

**11a — Detect SRT media type on drop**

In `Timeline.tsx` or `TrackLane.tsx`, when `data.mediaId` references a `MediaItem` with `type: "srt"`:

```typescript
const mediaItem = project.mediaLibrary.items.find(m => m.id === data.mediaId);
if (mediaItem?.type === "srt") {
  // Parse SRT content and create subtitle clips on a subtitle track
  const content = await mediaItem.blob.text();
  await importSRT(content);
  return;
}
```

**11b — Ensure proper track routing**

If the user drops an SRT onto an existing subtitle track, add clips there. If dropped on the empty area or a non-subtitle track, create a new subtitle track.

### Verification

```bash
# Manual: drag an .srt file onto the timeline; verify a subtitle track is created with clips
```

---

## Risks and Open Decisions

| Risk | Mitigation |
|------|-----------|
| **Breaking change**: existing saved projects with the old `timeline.subtitles` data will lose subtitles without a migration. | Add a one-time migration in `loadProject` (Task 8b). Keep the `Subtitle`→`SubtitleClip` conversion lossless. |
| **Clip union complexity**: adding a `SubtitleClip` type to the `Clip` union means all `Clip` consumers need to handle it. | Use the `subtitleData?: SubtitleClipData` optional property pattern on `Clip` instead. Existing code that doesn't know about subtitle data just sees a regular `Clip`. |
| **Preview rendering duplication**: both old flat array and new track clips render simultaneously during migration. | Tight task ordering: Task 5 (preview migration) must not start before Task 3 (store migration). Add an intermediate state where both sources are rendered (they should produce identical results). |
| **SubtitleEngine dual-maintenance**: the engine operates on the flat array and will have a parallel `SubtitleClipManager`. | After Task 9 (cleanup), deprecate the original `SubtitleEngine` methods that take a `Timeline` parameter. Move `parseSRT`/`exportSRT` to standalone utility functions shared by both. |
| **Text clip ↔ subtitle clip confusion**: existing text clips on "Captions" tracks won't auto-migrate. | Detect old text clips on `"subtitle"` tracks during project load and convert them to `SubtitleClip` instances. Remove the `t.type === "text"` fallback in `addSubtitle`. |

---

## Execution Order Summary

```
Task 1 (Core types)        ─┐
Task 2 (ClipManager)       ─┤  Parallel (independent)
                             │
Task 3 (Store migration)    ◄┤  Depends on 1, 2
Task 4 (Timeline UI)        ◄┤  Depends on 1
Task 5 (Preview rendering)  ◄┤  Depends on 1, 3
Task 6 (Export rendering)   ◄┤  Depends on 1, 5
Task 7 (Inspector panel)    ◄┤  Depends on 1, 3
Task 8 (Persistence)        ◄┤  Depends on 1, 3
Task 9 (Cleanup)            ◄┤  Depends on 3, 5, 8
Task 10 (Tests)             ◄┤  Throughout, finalize after 9
Task 11 (SRT file drop)     ◄┤  Depends on 3, 4
```
