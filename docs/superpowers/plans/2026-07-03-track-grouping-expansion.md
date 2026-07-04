# Track Grouping and Storyboard Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add expandable timeline track groups and an expanded storyboard metadata meta-track that displays one timeline-aligned card per storyboard shot, while treating storyboard shots as specialized video clips compatible with Neural Frames imports.

**Architecture:** Timeline grouping is derived from existing tracks and clip metadata, not from a parallel timeline model. A `TrackGroup` view model groups storyboard scene clips, character tracks, section/meta tracks, and other metadata tracks; expansion state lives in the UI store. Storyboard shot UI reads `StoryboardShot` metadata through storyboard-specialized video clips (`clip.metadata.shotId`) so Neural Frames imported scene clips and generated storyboard clips share the same path.

**Tech Stack:** TypeScript, React, Zustand, Vitest, Testing Library, Tailwind CSS, `@openreel/core` timeline `Track`/`Clip`, `@openreel/music-video-domain` `StoryboardShot` and Neural Frames import metadata.

---

## File map

- Modify: `packages/music-video-domain/src/types.ts` — add exported storyboard clip metadata and clip-link helper types that describe how a video clip specializes into a storyboard shot without importing `@openreel/core`.
- Modify: `packages/music-video-domain/src/index.ts` — export the new storyboard clip metadata types.
- Create: `apps/web/src/components/editor/timeline/storyboard-clip.ts` — timeline-facing type guards and helpers for `Track`/`Clip` pairs with `metadata.shotId`.
- Create: `apps/web/src/components/editor/timeline/storyboard-clip.test.ts` — verifies Neural Frames clip metadata qualifies as storyboard video clips.
- Modify: `apps/web/src/stores/ui-store.ts` — add track-group expansion state and actions.
- Modify: `apps/web/src/stores/ui-store.test.ts` — cover group expansion state.
- Create: `apps/web/src/components/editor/timeline/track-groups.ts` — pure grouping rules for storyboard, character, section, metadata, audio, and fallback tracks.
- Create: `apps/web/src/components/editor/timeline/track-groups.test.ts` — verifies grouping behavior.
- Create: `apps/web/src/components/editor/timeline/TrackGroupHeader.tsx` — shared expand/collapse header for grouped timeline rows.
- Create: `apps/web/src/components/editor/timeline/TrackGroupHeader.test.tsx` — component tests for toggle and counts.
- Create: `apps/web/src/components/editor/timeline/ShotMetadataMetaTrack.tsx` — timeline-aligned meta-track that renders expanded per-shot cards.
- Create: `apps/web/src/components/editor/timeline/ShotMetadataMetaTrack.test.tsx` — tests collapsed/expanded shot metadata rendering.
- Modify: `apps/web/src/components/editor/Timeline.tsx` — render track groups, group headers, section meta-track, and the shot metadata meta-track.
- Modify: `apps/web/src/components/editor/storyboard/StoryboardPanel.tsx` — select and display shots through storyboard-specialized video clips when clips exist; fall back to `project.shots` only for unrealized/no-timeline projects.
- Modify: `apps/web/src/components/editor/storyboard/StoryboardPanel.test.tsx` — cover Neural Frames imported clips as storyboard shots.

---

## Task index

| Seq | Task | Depends on | Parallel | Commit |
| --- | --- | --- | --- | --- |
| 01 | Formalize storyboard-specialized video clip metadata | none | false | `feat(domain): describe storyboard clip metadata` |
| 02 | Add storyboard clip timeline helpers | 01 | false | `feat(web): identify storyboard video clips` |
| 03 | Add track-group expansion state | none | true | `feat(web): store timeline group expansion` |
| 04 | Implement track grouping rules | 02, 03 | false | `feat(web): group timeline tracks` |
| 05 | Build reusable track group header | 03, 04 | true | `feat(web): add track group header` |
| 06 | Build expanded shot metadata meta-track | 02, 04 | false | `feat(web): add expanded shot metadata track` |
| 07 | Render grouped tracks in Timeline | 04, 05, 06 | false | `feat(web): render grouped timeline tracks` |
| 08 | Integrate StoryboardPanel with storyboard video clips | 02 | true | `feat(web): link storyboard panel to video clips` |
| 09 | Run grouped storyboard integration smoke | 07, 08 | false | `chore: verify grouped storyboard timeline` |

---

## Task 01: Formalize storyboard-specialized video clip metadata

**Goal:** Give all import/generation paths one explicit metadata contract for a video clip that represents a storyboard shot.

**Files:**
- Modify: `packages/music-video-domain/src/types.ts`
- Modify: `packages/music-video-domain/src/index.ts`
- Test: typecheck only; this package already emits type declarations.

- [ ] **Step 1: Read current shot and import metadata fields**

Read:

```bash
packages/music-video-domain/src/types.ts:240-267
packages/music-video-domain/src/adapter.ts:468-484
packages/core/src/types/timeline.ts:57-107
```

Expected observations:
- `StoryboardShot` owns creative metadata: label, prompt, reference images, generated assets, outputs.
- Timeline `Clip` has open `metadata` and no dedicated subtype.
- Neural Frames scene clips already set `metadata.shotId`, `metadata.shotIndex`, `metadata.prompt`, `metadata.referenceImageUrl`, and `metadata.importSource = "neuralframes"`.

- [ ] **Step 2: Add explicit metadata contract**

Append after `StoryboardShot` in `packages/music-video-domain/src/types.ts`:

```ts
export type StoryboardClipSource = "neuralframes" | "storyboard-generation" | "manual";

export interface StoryboardClipMetadata {
  /** Marks a timeline video clip as the clip-level specialization of a StoryboardShot. */
  kind: "storyboard-shot";
  shotId: string;
  shotIndex: number;
  label: string;
  prompt: string;
  referenceImageUrl?: string;
  generatedAssetIds: string[];
  source: StoryboardClipSource;
  importSource?: string;
  importId?: string;
}

export interface StoryboardClipLink {
  clipId: string;
  trackId: string;
  shotId: string;
  startSeconds: number;
  endSeconds: number;
}
```

- [ ] **Step 3: Update Neural Frames import metadata to mark clips**

Update `buildSceneClipMetadata` in `packages/music-video-domain/src/adapter.ts` so its returned object includes the new marker while preserving existing keys:

```ts
function buildSceneClipMetadata(shot: StoryboardShot, referenceImageUrl: string | null): Record<string, unknown> {
  return {
    kind: "storyboard-shot",
    text: shot.prompt,
    importSource: "neuralframes",
    importId: shot.id,
    source: "neuralframes",
    linkedShotIds: [shot.id],
    linkedGeneratedAssetIds: [],
    label: shot.label,
    color: "#4da8ff",
    prompt: shot.prompt,
    shotId: shot.id,
    shotIndex: shot.index,
    generatedAssetIds: [],
    referenceImageUrl: referenceImageUrl ?? undefined,
  };
}
```

- [ ] **Step 4: Export types**

Update `packages/music-video-domain/src/index.ts` using the existing export pattern:

```ts
export type { StoryboardClipMetadata, StoryboardClipLink, StoryboardClipSource } from "./types.js";
```

- [ ] **Step 5: Run typecheck**

Run:

```bash
pnpm --filter @openreel/music-video-domain typecheck
```

Expected: PASS.

**Acceptance:**
- Storyboard shot clips have an explicit metadata marker: `kind: "storyboard-shot"`.
- Neural Frames imported scene clips use that marker.
- Existing `metadata.shotId` consumers remain compatible.

---

## Task 02: Add storyboard clip timeline helpers

**Goal:** Identify storyboard-specialized video clips from a `Track`/`Clip` pair and join them back to `StoryboardShot` records.

**Files:**
- Create: `apps/web/src/components/editor/timeline/storyboard-clip.ts`
- Create: `apps/web/src/components/editor/timeline/storyboard-clip.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/web/src/components/editor/timeline/storyboard-clip.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Clip, Track } from "@openreel/core";
import type { StoryboardShot } from "@openreel/music-video-domain";
import { getStoryboardClipMetadata, isStoryboardVideoClip, joinStoryboardClipToShot } from "./storyboard-clip";

const baseClip: Clip = {
  id: "clip-1",
  mediaId: "media-1",
  trackId: "track-scenes",
  startTime: 12,
  duration: 4,
  inPoint: 0,
  outPoint: 4,
  effects: [],
  audioEffects: [],
  transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1 },
  volume: 1,
  keyframes: [],
  metadata: {
    kind: "storyboard-shot",
    shotId: "shot-1",
    shotIndex: 0,
    label: "Shot 1",
    prompt: "A singer under blue light",
    generatedAssetIds: [],
    source: "neuralframes",
    importSource: "neuralframes",
    referenceImageUrl: "/ref.png",
  },
};

const videoTrack: Track = {
  id: "track-scenes",
  type: "video",
  name: "Neural Frames Scenes",
  clips: [baseClip],
  transitions: [],
  locked: false,
  hidden: false,
  muted: false,
  solo: false,
};

describe("storyboard clip helpers", () => {
  it("recognizes Neural Frames scene clips as storyboard video clips", () => {
    expect(isStoryboardVideoClip(videoTrack, baseClip)).toBe(true);
    expect(getStoryboardClipMetadata(baseClip)?.shotId).toBe("shot-1");
  });

  it("rejects metadata clips even when they contain a shotId", () => {
    const metadataTrack = { ...videoTrack, type: "metadata" as const };
    expect(isStoryboardVideoClip(metadataTrack, baseClip)).toBe(false);
  });

  it("joins a storyboard clip to the matching StoryboardShot", () => {
    const shot: StoryboardShot = {
      id: "shot-1",
      index: 0,
      label: "Shot 1",
      startSeconds: 12,
      endSeconds: 16,
      prompt: "A singer under blue light",
      model: "nf",
      resolution: "1920x1080",
      aspectRatio: "16:9",
      includeMainAudio: true,
      referenceAssetIds: [],
      generatedAssetIds: [],
      referenceImageUrl: "/ref.png",
      validation: { valid: true, warnings: [], errors: [] },
      outputs: [],
      selected: false,
    };

    expect(joinStoryboardClipToShot(baseClip, [shot])?.shot.id).toBe("shot-1");
  });
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
pnpm --filter @openreel/web test:run apps/web/src/components/editor/timeline/storyboard-clip.test.ts
```

Expected: FAIL because `storyboard-clip.ts` does not exist.

- [ ] **Step 3: Implement helpers**

Create `apps/web/src/components/editor/timeline/storyboard-clip.ts`:

```ts
import type { Clip, Track } from "@openreel/core";
import type { StoryboardClipMetadata, StoryboardShot } from "@openreel/music-video-domain";

export interface StoryboardClipWithShot {
  clip: Clip;
  track: Track;
  shot: StoryboardShot;
  metadata: StoryboardClipMetadata;
}

export function getStoryboardClipMetadata(clip: Clip): StoryboardClipMetadata | null {
  const metadata = clip.metadata;
  if (!metadata || metadata.kind !== "storyboard-shot") return null;
  if (typeof metadata.shotId !== "string") return null;
  if (typeof metadata.shotIndex !== "number") return null;
  if (typeof metadata.label !== "string") return null;
  if (typeof metadata.prompt !== "string") return null;
  return {
    kind: "storyboard-shot",
    shotId: metadata.shotId,
    shotIndex: metadata.shotIndex,
    label: metadata.label,
    prompt: metadata.prompt,
    referenceImageUrl: typeof metadata.referenceImageUrl === "string" ? metadata.referenceImageUrl : undefined,
    generatedAssetIds: Array.isArray(metadata.generatedAssetIds) ? metadata.generatedAssetIds.filter((id): id is string => typeof id === "string") : [],
    source: metadata.source === "storyboard-generation" || metadata.source === "manual" ? metadata.source : "neuralframes",
    importSource: typeof metadata.importSource === "string" ? metadata.importSource : undefined,
    importId: typeof metadata.importId === "string" ? metadata.importId : undefined,
  };
}

export function isStoryboardVideoClip(track: Track, clip: Clip): boolean {
  return track.type === "video" && getStoryboardClipMetadata(clip) !== null;
}

export function joinStoryboardClipToShot(clip: Clip, shots: readonly StoryboardShot[]): { clip: Clip; shot: StoryboardShot; metadata: StoryboardClipMetadata } | null {
  const metadata = getStoryboardClipMetadata(clip);
  if (!metadata) return null;
  const shot = shots.find((candidate) => candidate.id === metadata.shotId);
  return shot ? { clip, shot, metadata } : null;
}

export function collectStoryboardClipShots(tracks: readonly Track[], shots: readonly StoryboardShot[]): StoryboardClipWithShot[] {
  return tracks.flatMap((track) =>
    track.clips.flatMap((clip) => {
      if (!isStoryboardVideoClip(track, clip)) return [];
      const joined = joinStoryboardClipToShot(clip, shots);
      return joined ? [{ track, ...joined }] : [];
    }),
  ).sort((a, b) => a.clip.startTime - b.clip.startTime || a.metadata.shotIndex - b.metadata.shotIndex);
}
```

- [ ] **Step 4: Run passing test**

Run:

```bash
pnpm --filter @openreel/web test:run apps/web/src/components/editor/timeline/storyboard-clip.test.ts
```

Expected: PASS.

**Acceptance:**
- Neural Frames scene clips qualify as storyboard video clips.
- Metadata-only clips do not qualify.
- The helper joins clips to `StoryboardShot` by `metadata.shotId`.

---

## Task 03: Add track-group expansion state

**Goal:** Store expanded/collapsed state per logical timeline group without changing project data.

**Files:**
- Modify: `apps/web/src/stores/ui-store.ts`
- Modify: `apps/web/src/stores/ui-store.test.ts`

- [ ] **Step 1: Write failing store test**

Add to `apps/web/src/stores/ui-store.test.ts`:

```ts
it("tracks timeline group expansion state", () => {
  const store = createUIStoreForTest();

  expect(store.getState().isTimelineGroupExpanded("storyboard")).toBe(true);

  store.getState().setTimelineGroupExpanded("storyboard", false);
  expect(store.getState().isTimelineGroupExpanded("storyboard")).toBe(false);

  store.getState().toggleTimelineGroupExpanded("storyboard");
  expect(store.getState().isTimelineGroupExpanded("storyboard")).toBe(true);
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
pnpm --filter @openreel/web test:run apps/web/src/stores/ui-store.test.ts
```

Expected: FAIL because timeline group expansion actions do not exist.

- [ ] **Step 3: Add UI store state and actions**

Add to the UI store types:

```ts
export type TimelineGroupId = "storyboard" | "characters" | "sections" | "metadata" | "audio" | `track:${string}`;

interface UIState {
  timelineGroupExpansion: Record<string, boolean>;
  setTimelineGroupExpanded: (groupId: TimelineGroupId, expanded: boolean) => void;
  toggleTimelineGroupExpanded: (groupId: TimelineGroupId) => void;
  isTimelineGroupExpanded: (groupId: TimelineGroupId) => boolean;
}
```

Add to the store initializer:

```ts
timelineGroupExpansion: {
  storyboard: true,
  characters: false,
  sections: true,
  metadata: false,
  audio: true,
},
setTimelineGroupExpanded: (groupId, expanded) =>
  set((state) => ({
    timelineGroupExpansion: { ...state.timelineGroupExpansion, [groupId]: expanded },
  })),
toggleTimelineGroupExpanded: (groupId) =>
  set((state) => ({
    timelineGroupExpansion: {
      ...state.timelineGroupExpansion,
      [groupId]: !(state.timelineGroupExpansion[groupId] ?? true),
    },
  })),
isTimelineGroupExpanded: (groupId) => get().timelineGroupExpansion[groupId] ?? true,
```

- [ ] **Step 4: Run passing test**

Run:

```bash
pnpm --filter @openreel/web test:run apps/web/src/stores/ui-store.test.ts
```

Expected: PASS.

**Acceptance:**
- Expansion state defaults are deterministic.
- Unknown groups default to expanded.
- Store actions do not touch persisted project/timeline data.

---

## Task 04: Implement track grouping rules

**Goal:** Derive logical track groups from timeline tracks, preserving track order inside each group.

**Files:**
- Create: `apps/web/src/components/editor/timeline/track-groups.ts`
- Create: `apps/web/src/components/editor/timeline/track-groups.test.ts`

- [ ] **Step 1: Write failing grouping tests**

Create `apps/web/src/components/editor/timeline/track-groups.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Track } from "@openreel/core";
import { groupTimelineTracks } from "./track-groups";

function track(id: string, type: Track["type"], name: string): Track {
  return { id, type, name, clips: [], transitions: [], locked: false, hidden: false, muted: false, solo: false };
}

describe("groupTimelineTracks", () => {
  it("groups storyboard, character, section, metadata, audio, and fallback tracks", () => {
    const tracks: Track[] = [
      { ...track("scenes", "video", "Neural Frames Scenes"), clips: [{ id: "c1", mediaId: "m1", trackId: "scenes", startTime: 0, duration: 4, inPoint: 0, outPoint: 4, effects: [], audioEffects: [], transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1 }, volume: 1, keyframes: [], metadata: { kind: "storyboard-shot", shotId: "s1", shotIndex: 0, label: "Shot 1", prompt: "Prompt", generatedAssetIds: [], source: "neuralframes" } }] },
      track("char-lead", "metadata", "Character: Lead"),
      track("sections", "metadata", "Sections"),
      track("loras", "metadata", "LoRAs"),
      track("audio", "audio", "Main Audio"),
      track("vfx", "video", "B-roll"),
    ];

    expect(groupTimelineTracks(tracks).map((group) => group.id)).toEqual([
      "storyboard",
      "characters",
      "sections",
      "metadata",
      "audio",
      "track:vfx",
    ]);
  });
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
pnpm --filter @openreel/web test:run apps/web/src/components/editor/timeline/track-groups.test.ts
```

Expected: FAIL because `track-groups.ts` does not exist.

- [ ] **Step 3: Implement grouping rules**

Create `apps/web/src/components/editor/timeline/track-groups.ts`:

```ts
import type { Track } from "@openreel/core";
import type { TimelineGroupId } from "../../../stores/ui-store";
import { isStoryboardVideoClip } from "./storyboard-clip";

export type TimelineTrackGroupKind = "storyboard" | "characters" | "sections" | "metadata" | "audio" | "single";

export interface TimelineTrackGroup {
  id: TimelineGroupId;
  kind: TimelineTrackGroupKind;
  label: string;
  tracks: Track[];
  defaultExpanded: boolean;
}

function isCharacterTrack(track: Track): boolean {
  return track.name.toLowerCase().startsWith("character:") || track.clips.some((clip) => clip.metadata?.kind === "continuity_note");
}

function isSectionTrack(track: Track): boolean {
  return track.name.toLowerCase() === "sections" || track.clips.some((clip) => clip.metadata?.kind === "section");
}

function isStoryboardTrack(track: Track): boolean {
  return track.type === "video" && track.clips.some((clip) => isStoryboardVideoClip(track, clip));
}

function makeGroup(id: TimelineGroupId, kind: TimelineTrackGroupKind, label: string, tracks: Track[], defaultExpanded: boolean): TimelineTrackGroup | null {
  return tracks.length > 0 ? { id, kind, label, tracks, defaultExpanded } : null;
}

export function groupTimelineTracks(tracks: readonly Track[]): TimelineTrackGroup[] {
  const storyboard: Track[] = [];
  const characters: Track[] = [];
  const sections: Track[] = [];
  const metadata: Track[] = [];
  const audio: Track[] = [];
  const fallback: Track[] = [];

  for (const track of tracks) {
    if (isStoryboardTrack(track)) storyboard.push(track);
    else if (isCharacterTrack(track)) characters.push(track);
    else if (isSectionTrack(track)) sections.push(track);
    else if (track.type === "metadata") metadata.push(track);
    else if (track.type === "audio") audio.push(track);
    else fallback.push(track);
  }

  return [
    makeGroup("storyboard", "storyboard", "Storyboard", storyboard, true),
    makeGroup("characters", "characters", "Characters", characters, false),
    makeGroup("sections", "sections", "Sections", sections, true),
    makeGroup("metadata", "metadata", "Metadata", metadata, false),
    makeGroup("audio", "audio", "Audio", audio, true),
    ...fallback.map((track) => makeGroup(`track:${track.id}`, "single", track.name, [track], true)),
  ].filter((group): group is TimelineTrackGroup => group !== null);
}
```

- [ ] **Step 4: Run passing test**

Run:

```bash
pnpm --filter @openreel/web test:run apps/web/src/components/editor/timeline/track-groups.test.ts
```

Expected: PASS.

**Acceptance:**
- Storyboard video clips group separately from ordinary video tracks.
- Character continuity tracks group together.
- Metadata tracks group together unless they are section tracks.
- Ungrouped tracks remain visible as single-track groups.

---

## Task 05: Build reusable track group header

**Goal:** Add a small timeline row header that toggles group expansion and shows track/clip counts.

**Files:**
- Create: `apps/web/src/components/editor/timeline/TrackGroupHeader.tsx`
- Create: `apps/web/src/components/editor/timeline/TrackGroupHeader.test.tsx`

- [ ] **Step 1: Write failing component tests**

Create `apps/web/src/components/editor/timeline/TrackGroupHeader.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TrackGroupHeader } from "./TrackGroupHeader";

describe("TrackGroupHeader", () => {
  it("renders label, track count, clip count, and toggles expansion", () => {
    const onToggle = vi.fn();

    render(<TrackGroupHeader label="Characters" trackCount={3} clipCount={8} expanded={false} onToggle={onToggle} />);

    expect(screen.getByText("Characters")).toBeInTheDocument();
    expect(screen.getByText("3 tracks")).toBeInTheDocument();
    expect(screen.getByText("8 clips")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /expand characters/i }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
pnpm --filter @openreel/web test:run apps/web/src/components/editor/timeline/TrackGroupHeader.test.tsx
```

Expected: FAIL because component does not exist.

- [ ] **Step 3: Implement component**

Create `apps/web/src/components/editor/timeline/TrackGroupHeader.tsx`:

```tsx
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@openreel/ui/lib/utils";

interface TrackGroupHeaderProps {
  label: string;
  trackCount: number;
  clipCount: number;
  expanded: boolean;
  onToggle: () => void;
}

export function TrackGroupHeader({ label, trackCount, clipCount, expanded, onToggle }: TrackGroupHeaderProps) {
  const Icon = expanded ? ChevronDown : ChevronRight;
  return (
    <div className="flex items-center h-8 border-b border-border bg-muted/35 text-xs">
      <button
        type="button"
        aria-label={`${expanded ? "Collapse" : "Expand"} ${label}`}
        onClick={onToggle}
        className={cn("flex items-center gap-2 h-full px-2 min-w-48 text-left hover:bg-muted", expanded && "font-medium")}
      >
        <Icon className="h-3.5 w-3.5" />
        <span>{label}</span>
      </button>
      <div className="flex items-center gap-2 text-muted-foreground">
        <span>{trackCount === 1 ? "1 track" : `${trackCount} tracks`}</span>
        <span>{clipCount === 1 ? "1 clip" : `${clipCount} clips`}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run passing test**

Run:

```bash
pnpm --filter @openreel/web test:run apps/web/src/components/editor/timeline/TrackGroupHeader.test.tsx
```

Expected: PASS.

**Acceptance:**
- Header toggles expansion with accessible labels.
- Header displays group counts.
- Header is presentational and does not import store state.

---

## Task 06: Build expanded shot metadata meta-track

**Goal:** Render a storyboard meta-track that can collapse into labels or expand into timeline-aligned shot cards with title, prompt, reference images, section/status, and generated-output count.

**Files:**
- Create: `apps/web/src/components/editor/timeline/ShotMetadataMetaTrack.tsx`
- Create: `apps/web/src/components/editor/timeline/ShotMetadataMetaTrack.test.tsx`

- [ ] **Step 1: Write failing component tests**

Create `apps/web/src/components/editor/timeline/ShotMetadataMetaTrack.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { StoryboardClipWithShot } from "./storyboard-clip";
import { ShotMetadataMetaTrack } from "./ShotMetadataMetaTrack";

const item = {
  track: { id: "track-scenes", type: "video", name: "Neural Frames Scenes", clips: [], transitions: [], locked: false, hidden: false, muted: false, solo: false },
  clip: { id: "clip-1", mediaId: "media-1", trackId: "track-scenes", startTime: 10, duration: 5, inPoint: 0, outPoint: 5, effects: [], audioEffects: [], transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1 }, volume: 1, keyframes: [], metadata: {} },
  metadata: { kind: "storyboard-shot", shotId: "shot-1", shotIndex: 0, label: "Opening", prompt: "Blue stage lights", referenceImageUrl: "/ref.png", generatedAssetIds: ["asset-1"], source: "neuralframes" },
  shot: { id: "shot-1", index: 0, label: "Opening", startSeconds: 10, endSeconds: 15, prompt: "Blue stage lights", model: "nf", resolution: "1920x1080", aspectRatio: "16:9", includeMainAudio: true, referenceAssetIds: [], generatedAssetIds: ["asset-1"], referenceImageUrl: "/ref.png", validation: { valid: true, warnings: [], errors: [] }, outputs: [], selected: false },
} satisfies StoryboardClipWithShot;

describe("ShotMetadataMetaTrack", () => {
  it("renders expanded shot cards with metadata", () => {
    render(<ShotMetadataMetaTrack shots={[item]} durationSeconds={60} expanded />);

    expect(screen.getByText("Opening")).toBeInTheDocument();
    expect(screen.getByText("Blue stage lights")).toBeInTheDocument();
    expect(screen.getByAltText("Opening reference")).toHaveAttribute("src", "/ref.png");
    expect(screen.getByText("1 output")).toBeInTheDocument();
  });

  it("renders compact labels when collapsed", () => {
    render(<ShotMetadataMetaTrack shots={[item]} durationSeconds={60} expanded={false} />);

    expect(screen.getByText("Opening")).toBeInTheDocument();
    expect(screen.queryByText("Blue stage lights")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
pnpm --filter @openreel/web test:run apps/web/src/components/editor/timeline/ShotMetadataMetaTrack.test.tsx
```

Expected: FAIL because component does not exist.

- [ ] **Step 3: Implement meta-track**

Create `apps/web/src/components/editor/timeline/ShotMetadataMetaTrack.tsx`:

```tsx
import type { StoryboardClipWithShot } from "./storyboard-clip";

interface ShotMetadataMetaTrackProps {
  shots: StoryboardClipWithShot[];
  durationSeconds: number;
  expanded: boolean;
}

function pct(value: number, durationSeconds: number): string {
  return `${Math.max(0, Math.min(100, (value / Math.max(durationSeconds, 0.001)) * 100))}%`;
}

export function ShotMetadataMetaTrack({ shots, durationSeconds, expanded }: ShotMetadataMetaTrackProps) {
  return (
    <div className={expanded ? "relative h-32 border-b border-border bg-background" : "relative h-7 border-b border-border bg-background"} data-testid="shot-metadata-meta-track">
      {shots.map(({ clip, shot, metadata }) => {
        const left = pct(clip.startTime, durationSeconds);
        const width = pct(clip.duration, durationSeconds);
        const label = shot.label || metadata.label || `Shot ${shot.index + 1}`;
        const outputCount = shot.generatedAssetIds.length;
        return (
          <article
            key={clip.id}
            className={expanded ? "absolute top-2 bottom-2 overflow-hidden rounded-md border border-border bg-card p-2 shadow-sm" : "absolute top-1 bottom-1 overflow-hidden rounded border border-border bg-muted/70 px-1 text-[10px]"}
            style={{ left, width }}
            data-testid={`shot-metadata-card-${shot.id}`}
          >
            {expanded ? (
              <div className="grid h-full grid-cols-[56px_1fr] gap-2">
                {shot.referenceImageUrl || metadata.referenceImageUrl ? (
                  <img src={shot.referenceImageUrl ?? metadata.referenceImageUrl} alt={`${label} reference`} className="h-14 w-14 rounded object-cover" />
                ) : (
                  <div className="h-14 w-14 rounded bg-muted text-center text-[10px] leading-[3.5rem] text-muted-foreground">No ref</div>
                )}
                <div className="min-w-0 space-y-1">
                  <div className="truncate text-xs font-medium">{label}</div>
                  <p className="line-clamp-3 text-[11px] leading-snug text-muted-foreground">{shot.prompt || metadata.prompt}</p>
                  <div className="flex gap-2 text-[10px] text-muted-foreground">
                    <span>{clip.startTime.toFixed(1)}s–{(clip.startTime + clip.duration).toFixed(1)}s</span>
                    <span>{outputCount === 1 ? "1 output" : `${outputCount} outputs`}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="truncate leading-5">{label}</div>
            )}
          </article>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run passing test**

Run:

```bash
pnpm --filter @openreel/web test:run apps/web/src/components/editor/timeline/ShotMetadataMetaTrack.test.tsx
```

Expected: PASS.

**Acceptance:**
- Expanded state shows title, prompt, reference image, timing, and output count for each shot.
- Collapsed state keeps a compact label strip.
- Cards align horizontally to the owning video clip start/duration.
- The component receives prepared storyboard clip data and does not query stores.

---

## Task 07: Render grouped tracks in Timeline

**Goal:** Replace flat timeline track rendering with group headers, expanded/collapsed groups, and a storyboard shot metadata row for the storyboard group.

**Files:**
- Modify: `apps/web/src/components/editor/Timeline.tsx`
- Modify: existing Timeline tests near this component, or create `apps/web/src/components/editor/Timeline.track-groups.test.tsx` if no focused test exists.

- [ ] **Step 1: Write failing Timeline test**

Add a test that renders a timeline with:
- a Neural Frames scene video track containing one `kind: "storyboard-shot"` clip,
- two character metadata tracks,
- one section metadata track,
- one LoRA metadata track.

Assert:
- group headers `Storyboard`, `Characters`, `Sections`, `Metadata` render;
- collapsing `Characters` hides its child tracks;
- expanding `Storyboard` shows `shot-metadata-meta-track`;
- collapsing `Storyboard` keeps the compact shot labels visible.

Run:

```bash
pnpm --filter @openreel/web test:run apps/web/src/components/editor/Timeline.track-groups.test.tsx
```

Expected: FAIL because Timeline still renders flat tracks.

- [ ] **Step 2: Wire grouping helpers into Timeline**

In `Timeline.tsx`, compute groups before rendering track rows:

```tsx
const groups = useMemo(() => groupTimelineTracks(timeline.tracks), [timeline.tracks]);
const { isTimelineGroupExpanded, toggleTimelineGroupExpanded } = useUIStore();
const storyboardClipShots = useMemo(
  () => collectStoryboardClipShots(timeline.tracks, musicVideoProject?.shots ?? []),
  [timeline.tracks, musicVideoProject?.shots],
);
```

Render each group with:

```tsx
{groups.map((group) => {
  const expanded = isTimelineGroupExpanded(group.id);
  const clipCount = group.tracks.reduce((sum, track) => sum + track.clips.length, 0);
  return (
    <div key={group.id} data-testid={`timeline-group-${group.id}`}>
      <TrackGroupHeader
        label={group.label}
        trackCount={group.tracks.length}
        clipCount={clipCount}
        expanded={expanded}
        onToggle={() => toggleTimelineGroupExpanded(group.id)}
      />
      {group.kind === "storyboard" && (
        <ShotMetadataMetaTrack
          shots={storyboardClipShots}
          durationSeconds={timeline.duration}
          expanded={expanded}
        />
      )}
      {expanded && group.tracks.map((track) => renderTrackRow(track))}
    </div>
  );
})}
```

Use the existing track-row rendering function/body. Do not rewrite clip rendering in this task.

- [ ] **Step 3: Run passing Timeline test**

Run:

```bash
pnpm --filter @openreel/web test:run apps/web/src/components/editor/Timeline.track-groups.test.tsx
```

Expected: PASS.

**Acceptance:**
- Timeline groups render in derived order.
- Expansion state controls child track visibility.
- Storyboard group always renders the shot metadata meta-track; expansion changes card density.
- Existing clip rendering stays unchanged inside expanded groups.

---

## Task 08: Integrate StoryboardPanel with storyboard video clips

**Goal:** Make the storyboard panel display the same shot ordering and selection targets as the storyboard-specialized video clips created by Neural Frames import and future storyboard generation.

**Files:**
- Modify: `apps/web/src/components/editor/storyboard/StoryboardPanel.tsx`
- Modify: `apps/web/src/components/editor/storyboard/StoryboardPanel.test.tsx`

- [ ] **Step 1: Write failing panel test**

Add a test to `StoryboardPanel.test.tsx`:

```tsx
it("orders Neural Frames imported storyboard shots by timeline clip start", () => {
  const project = makeMusicVideoProject({
    shots: [makeShot({ id: "shot-b", index: 1, label: "Second" }), makeShot({ id: "shot-a", index: 0, label: "First" })],
  });
  const timeline = makeTimeline({
    tracks: [
      makeTrack({
        id: "nf-scenes",
        type: "video",
        name: "Neural Frames Scenes",
        clips: [
          makeClip({ id: "clip-a", startTime: 0, metadata: { kind: "storyboard-shot", shotId: "shot-a", shotIndex: 0, label: "First", prompt: "First prompt", generatedAssetIds: [], source: "neuralframes" } }),
          makeClip({ id: "clip-b", startTime: 8, metadata: { kind: "storyboard-shot", shotId: "shot-b", shotIndex: 1, label: "Second", prompt: "Second prompt", generatedAssetIds: [], source: "neuralframes" } }),
        ],
      }),
    ],
  });

  renderStoryboardPanel({ project, timeline });

  expect(screen.getAllByTestId(/shot-card-/).map((node) => node.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("First"), expect.stringContaining("Second")]));
});
```

Adjust helper names to the existing test factory style in `StoryboardPanel.test.tsx`.

- [ ] **Step 2: Run failing test**

Run:

```bash
pnpm --filter @openreel/web test:run apps/web/src/components/editor/storyboard/StoryboardPanel.test.tsx
```

Expected: FAIL because StoryboardPanel only sorts `project.shots` by `shot.index` and ignores timeline clip order.

- [ ] **Step 3: Use storyboard clips as primary source when present**

In `StoryboardPanel.tsx`, collect storyboard clip-shot pairs from the active timeline. Use them for order and click selection when present:

```tsx
const storyboardClipShots = useMemo(
  () => collectStoryboardClipShots(timeline?.tracks ?? [], shots),
  [timeline?.tracks, shots],
);
const displayedShots = storyboardClipShots.length > 0
  ? storyboardClipShots.map((item) => item.shot)
  : [...shots].sort((a, b) => a.index - b.index);
```

Keep `selectShot(openreelProjectId, shot.id, true)` as the shot selection action. If the existing timeline store exposes clip selection, also select the owning clip when `storyboardClipShots` contains a matching item; do not add a new cross-store action in this task.

- [ ] **Step 4: Run passing panel tests**

Run:

```bash
pnpm --filter @openreel/web test:run apps/web/src/components/editor/storyboard/StoryboardPanel.test.tsx
```

Expected: PASS.

**Acceptance:**
- Neural Frames imported scene clips drive storyboard ordering when present.
- Projects without timeline storyboard clips still render `project.shots`.
- Shot selection remains keyed by `StoryboardShot.id`.

---

## Task 09: Run grouped storyboard integration smoke

**Goal:** Verify the whole grouped storyboard timeline behavior end to end.

**Files:**
- Create: `apps/web/src/components/editor/timeline/GroupedStoryboardTimeline.e2e.test.tsx`

- [ ] **Step 1: Add integration smoke test**

Create an integration test with:
- a project containing two `StoryboardShot` records produced by Neural Frames import;
- a timeline containing a `Neural Frames Scenes` video track with two storyboard-specialized clips;
- two character metadata tracks;
- one section meta-track;
- one LoRA metadata track.

Test flow:
1. Render the editor timeline.
2. Assert `Storyboard`, `Characters`, `Sections`, and `Metadata` group headers exist.
3. Assert the storyboard meta-track shows both shot labels.
4. Expand Storyboard and assert each shot card shows label, prompt, and reference image.
5. Collapse Characters and assert character child tracks disappear.
6. Open StoryboardPanel and assert it displays the same two shots in timeline order.

- [ ] **Step 2: Run smoke test**

Run:

```bash
pnpm --filter @openreel/web test:run apps/web/src/components/editor/timeline/GroupedStoryboardTimeline.e2e.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run focused regression set**

Run:

```bash
pnpm --filter @openreel/web test:run apps/web/src/components/editor/timeline/storyboard-clip.test.ts apps/web/src/components/editor/timeline/track-groups.test.ts apps/web/src/components/editor/timeline/ShotMetadataMetaTrack.test.ts apps/web/src/components/editor/storyboard/StoryboardPanel.test.tsx
```

Expected: PASS.

**Acceptance:**
- Storyboard clips imported from Neural Frames drive timeline meta-track cards and storyboard panel ordering.
- Track groups expand/collapse without altering track or clip data.
- Character and metadata tracks are grouped separately.
- Storyboard shots remain editable creative records, but their timeline representation is a specialized video clip with `metadata.kind = "storyboard-shot"` and `metadata.shotId`.

---

## Dependencies and integration notes

- This plan updates the storyboard UI plan (`2026-07-03-storyboard-ui.md`) by replacing the flat shot-grid-first timeline integration with a grouped timeline and storyboard clip source of truth.
- This plan depends on Neural Frames import metadata from `packages/music-video-domain/src/adapter.ts`; Task 01 makes that metadata explicit with `kind: "storyboard-shot"`.
- This plan complements the section identification flow (`2026-07-03-section-identification-flow.md`): section meta-track rows should participate in the `sections` group, while storyboard shot metadata cards may display `shot.sectionId` when present.
- This plan does not replace `StoryboardShot`. It formalizes the timeline clip specialization: `StoryboardShot` owns creative metadata, and a video `Clip` with `StoryboardClipMetadata` owns placement on the timeline.

## Risks and decisions

1. **Package boundaries:** `@openreel/core` should not import `@openreel/music-video-domain`. The shared metadata shape lives in the domain package; web-only type guards apply it to core `Clip` values.
2. **Existing Neural Frames imports:** Existing imported projects may have `metadata.shotId` without `metadata.kind = "storyboard-shot"`. The type guard can temporarily accept `metadata.importSource === "neuralframes" && typeof metadata.shotId === "string"` during migration if persisted fixtures require it, but new imports must write the explicit marker.
3. **Collapsed storyboard group:** Collapsing the Storyboard group hides raw video tracks but keeps the compact shot metadata strip visible so shot timing is still navigable.
4. **Grouping is view state:** Expanding/collapsing groups must not mutate timeline `Track` data or project serialization.
