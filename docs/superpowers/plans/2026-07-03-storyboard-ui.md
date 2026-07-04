# Storyboard UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a visual storyboard panel to the editor that displays all `StoryboardShot` entries as shot cards, supports selection and editing, and links every realized or imported shot to its storyboard-specialized video clip in the timeline.

**Architecture:** The base panel renders and edits `StoryboardShot` records from `useMusicVideoStore`, while timeline placement is owned by video `Clip` records whose metadata marks them as storyboard shots. Track grouping, expanded/collapsed timeline groups, and the shot metadata meta-track are specified in `2026-07-03-track-grouping-expansion.md`; this plan supplies the panel and selection foundation that grouping consumes. Neural Frames imported scenes must work through the same `metadata.shotId` linkage as generated storyboard shots.

**Tech Stack:** React, Zustand, Vitest, Tailwind CSS, `lucide-react`, `@openreel/music-video-domain`, `framer-motion` (for shot card animation).

---

## Execution contract

- One task = one atomic commit.
- Each task uses TDD: write the failing test, run it and record the expected failure, implement minimum code, run passing test, commit.
- Do not batch unrelated tasks into one commit.
- Storyboard shot records own creative metadata; timeline video clips own placement and specialize into storyboard shots via clip metadata (`metadata.kind = "storyboard-shot"`, `metadata.shotId`).
- Track grouping, group expand/collapse, character/metadata grouping, and expanded timeline shot metadata cards are implemented by `2026-07-03-track-grouping-expansion.md`.
- Storyboard UI communicates with the timeline through shared store state and storyboard clip metadata — no direct timeline DOM manipulation.

## Task index

| Seq | Task | Depends on | Parallel | Commit |
| --- | --- | --- | --- | --- |
| 01 | Register `storyboard` PanelId and default panel state | none | false | `feat: add storyboard panel id to ui store` |
| 02 | Build `ShotCard` component | none | true | `feat: add storyboard shot card component` |
| 03 | Build `StoryboardPanel` component | 01, 02 | false | `feat: add storyboard panel with shot grid` |
| 04 | Wire StoryboardPanel into EditorInterface | 03 | false | `feat: wire storyboard panel into editor layout` |
| 05 | Add toolbar toggle for storyboard panel | 04 | true | `feat: add storyboard toggle to toolbar` |
| 06 | Build `useStoryboardLink` bidirectional hook | 01 | false | `feat: add bidirectional storyboard-timeline linkage` |
| 07 | Add inline shot editing in storyboard panel | 03, 06 | false | `feat: add inline shot editing in storyboard panel` |
| 08 | Add drag-to-reorder shots | 03 | false | `feat: add drag-to-reorder in storyboard panel` |
| 09 | Run end-to-end smoke test | 05, 07, 08 | false | `chore: verify storyboard UI workflow` |

---

## Atomic task plans

### Task 01: Register `storyboard` PanelId and default panel state

**Goal:** Add `"storyboard"` to the `PanelId` type and `DEFAULT_PANELS` so existing `togglePanel`/`setPanelVisible` infrastructure can control visibility.

**Files:**
- Modify: `apps/web/src/stores/ui-store.ts:6-12`

**Reference files:**
- `apps/web/src/stores/ui-store.ts` — `PanelId` type at line 6-12, `DEFAULT_PANELS` at line 206-213

**TDD steps:**
- [ ] Write failing test: Add a store test that toggles the storyboard panel and asserts the visible state changes.
  - Test file: `apps/web/src/stores/ui-store.test.ts`
  - Test: create store, call `togglePanel("storyboard")`, expect `panels.storyboard.visible === true`
- [ ] Run: `pnpm --filter @openreel/web test:run apps/web/src/stores/ui-store.test.ts`
- [ ] Confirm expected red: FAIL because `"storyboard"` is not in the `PanelId` union.
- [ ] Implement the smallest production change:
  ```
  [ui-store.ts#CF63]
  SWAP 6.=12:
  +export type PanelId =
  +  | "mediaLibrary"
  +  | "inspector"
  +  | "effects"
  +  | "audioMixer"
  +  | "colorGrading"
  +  | "subtitles"
  +  | "storyboard";
  ```
  Then append to `DEFAULT_PANELS`:
  ```
  [ui-store.ts#CF63]
  INS.POST 212:
  +  storyboard: { visible: false, width: 400 },
  ```
- [ ] Re-run: `pnpm --filter @openreel/web test:run apps/web/src/stores/ui-store.test.ts` and confirm PASS.
- [ ] Commit: `git add apps/web/src/stores/ui-store.ts apps/web/src/stores/ui-store.test.ts && git commit -m "feat: add storyboard panel id to ui store"`

**Acceptance criteria:**
- `PanelId` accepts `"storyboard"`.
- `DEFAULT_PANELS.storyboard` has `visible: false` and `width: 400`.
- `togglePanel("storyboard")` toggles visibility.
- No regressions in existing panel IDs.

**Constraints:**
- Do not change any existing PanelId value.
- Do not add any new store actions — reuse `togglePanel`/`setPanelVisible`.

---

### Task 02: Build `ShotCard` component

**Goal:** Create a reusable `ShotCard` component that renders one `StoryboardShot` as a visual card with thumbnail, label, timing, status indicator, and selected state.

**Files:**
- Create: `apps/web/src/components/editor/storyboard/ShotCard.tsx`
- Create: `apps/web/src/components/editor/storyboard/ShotCard.test.tsx`
- Create: `apps/web/src/components/editor/storyboard/index.ts`

**Reference files:**
- `packages/music-video-domain/src/types.ts:242-267` — `StoryboardShot` interface
- `packages/core/src/types/timeline.ts:189-237` — clip types for timeline metadata
- `apps/web/src/components/editor/inspector/SceneMetadataInspector.tsx` — existing inspector that reads shot data

**TDD steps:**
- [ ] Write failing test: Add component tests for ShotCard:
  - Renders shot label and index
  - Shows "unrealized" badge when `outputs` is empty
  - Shows "complete" badge when last attempt status is "complete"
  - Applies selected styling when `selected` prop is true
  - Calls `onClick` on card click
  - Renders `referenceImageUrl` as thumbnail when present
  - Falls back to a gradient placeholder when no thumbnail URL
- [ ] Run: `pnpm --filter @openreel/web test:run apps/web/src/components/editor/storyboard/ShotCard.test.tsx`
- [ ] Confirm expected red: FAIL because ShotCard does not exist.
- [ ] Implement the smallest production change:
  ```tsx
  // ShotCard.tsx
  import type { StoryboardShot } from "@openreel/music-video-domain";
  import { cn } from "@openreel/ui/lib/utils";
  
  export interface ShotCardProps {
    shot: StoryboardShot;
    selected?: boolean;
    onClick?: () => void;
    onDoubleClick?: () => void;
  }
  
  export function ShotCard({ shot, selected, onClick, onDoubleClick }: ShotCardProps) {
    const status = shot.outputs.length > 0
      ? shot.outputs[shot.outputs.length - 1].status
      : "unrealized";
    const label = shot.label || `Shot ${shot.index + 1}`;
    const duration = shot.endSeconds - shot.startSeconds;
    const hasThumbnail = !!shot.referenceImageUrl;
  
    return (
      <div
        data-testid={`shot-card-${shot.id}`}
        className={cn(
          "group relative rounded-lg border overflow-hidden cursor-pointer transition-all",
          "hover:border-accent hover:shadow-md",
          selected
            ? "border-accent ring-1 ring-accent shadow-md"
            : "border-border",
        )}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        role="button"
        tabIndex={0}
        aria-selected={selected}
      >
        {/* Thumbnail */}
        <div className="aspect-video bg-gradient-to-br from-muted/30 to-muted/60 flex items-center justify-center overflow-hidden">
          {hasThumbnail ? (
            <img
              src={shot.referenceImageUrl}
              alt={label}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="text-muted-foreground text-2xl font-bold opacity-30">
              {shot.index + 1}
            </div>
          )}
        </div>
  
        {/* Info bar */}
        <div className="p-2 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium truncate">{label}</span>
            <span className={cn(
              "text-[10px] px-1.5 py-0.5 rounded-full capitalize",
              status === "complete" ? "bg-green-100 text-green-700" :
              status === "failed" ? "bg-red-100 text-red-700" :
              status === "processing" ? "bg-blue-100 text-blue-700" :
              "bg-muted text-muted-foreground",
            )}>
              {status}
            </span>
          </div>
          <div className="text-[10px] text-muted-foreground">
            {shot.startSeconds.toFixed(1)}s &ndash; {shot.endSeconds.toFixed(1)}s
            <span className="ml-1">({duration.toFixed(1)}s)</span>
          </div>
          <p className="text-[10px] text-muted-foreground line-clamp-2 leading-tight">
            {shot.prompt}
          </p>
        </div>
      </div>
    );
  }
  ```
- [ ] Re-run: `pnpm --filter @openreel/web test:run apps/web/src/components/editor/storyboard/ShotCard.test.tsx` and confirm PASS.
- [ ] Commit: `git add apps/web/src/components/editor/storyboard/ && git commit -m "feat: add storyboard shot card component"`

**Acceptance criteria:**
- ShotCard renders shot index, label, time range, duration, and prompt.
- Shows status badge derived from `outputs[last].status` or "unrealized".
- Applies selected visual state when `selected` is true.
- Shows `referenceImageUrl` thumbnail when present, fallback gradient otherwise.
- All props are optional except `shot`.
- Calls `onClick`/`onDoubleClick` callbacks.

**Constraints:**
- Pure presentational component — no store access or side effects.
- No animation library dependency — plain Tailwind transitions only.
- Compact layout (<200px wide ideal) to fit in a grid.

---

### Task 03: Build `StoryboardPanel` component

**Goal:** Create the `StoryboardPanel` that reads `shots` from `useMusicVideoStore`, renders them in a responsive grid using `ShotCard`, and supports selection state.

**Files:**
- Create: `apps/web/src/components/editor/storyboard/StoryboardPanel.tsx`
- Create: `apps/web/src/components/editor/storyboard/StoryboardPanel.test.tsx`
- Modify: `apps/web/src/components/editor/storyboard/index.ts` — re-export

**Reference files:**
- `apps/web/src/stores/music-video-store.ts:36-74` — MusicVideoState interface
- `apps/web/src/components/editor/inspector/LogPanel.tsx` — simple panel layout pattern
- `apps/web/src/components/editor/panels/EffectsTransitionsPanel.tsx` — search/filter panel pattern

**TDD steps:**
- [ ] Write failing test: Add component tests for StoryboardPanel:
  - Shows empty state when no shots exist
  - Renders one ShotCard per shot in the project
  - Clicking a card calls `selectShot` on the store
  - Shows shot count in header
  - Supports a "Select All" / "Deselect All" button that calls `selectAllShots`
  - `onClose` prop renders a close/X button
- [ ] Run: `pnpm --filter @openreel/web test:run apps/web/src/components/editor/storyboard/StoryboardPanel.test.tsx`
- [ ] Confirm expected red: FAIL because StoryboardPanel does not exist.
- [ ] Implement the smallest production change:
  ```tsx
  // StoryboardPanel.tsx
  import { useCallback, useMemo } from "react";
  import { useMusicVideoStore } from "../../../stores/music-video-store";
  import { useProjectStore } from "../../../stores/project-store";
  import { ShotCard } from "./ShotCard";
  import { ScrollArea } from "@openreel/ui";
  import { X, Film, CheckSquare, Square } from "lucide-react";

  interface Props {
    openreelProjectId: string;
    onClose?: () => void;
  }

  export function StoryboardPanel({ openreelProjectId, onClose }: Props) {
    const project = useMusicVideoStore((s) => s.projects[openreelProjectId]);
    const { selectShot, selectAllShots } = useMusicVideoStore();
    const shots = project?.shots ?? [];
    const allSelected = shots.length > 0 && shots.every((s) => s.selected);

    const handleToggleSelectAll = useCallback(() => {
      selectAllShots(openreelProjectId, !allSelected);
    }, [openreelProjectId, allSelected, selectAllShots]);

    const handleShotClick = useCallback((shotId: string) => {
      // Click toggles single selection (deselects others)
      selectShot(openreelProjectId, shotId, true);
    }, [openreelProjectId, selectShot]);

    if (shots.length === 0) {
      return (
        <div className="flex items-center justify-center h-full p-8" data-testid="storyboard-empty">
          <div className="text-center opacity-50">
            <Film className="w-8 h-8 mx-auto mb-2" />
            <p className="text-sm">No storyboard shots</p>
            <p className="text-xs mt-1">Import a Neural Frames storyboard or use AI generation to create shots.</p>
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col h-full" data-testid="storyboard-panel">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Film className="w-4 h-4" />
            <span className="text-sm font-medium">Storyboard</span>
            <span className="text-xs text-muted-foreground">({shots.length} shots)</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleToggleSelectAll}
              className="p-1 hover:bg-muted rounded text-xs flex items-center gap-1"
              title={allSelected ? "Deselect all" : "Select all"}
            >
              {allSelected ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
            </button>
            {onClose && (
              <button onClick={onClose} className="p-1 hover:bg-muted rounded">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Shot grid */}
        <ScrollArea className="flex-1">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 p-3">
            {shots
              .sort((a, b) => a.index - b.index)
              .map((shot) => (
                <ShotCard
                  key={shot.id}
                  shot={shot}
                  selected={shot.selected}
                  onClick={() => handleShotClick(shot.id)}
                />
              ))}
          </div>
        </ScrollArea>
      </div>
    );
  }
  ```
- [ ] Re-run: `pnpm --filter @openreel/web test:run apps/web/src/components/editor/storyboard/StoryboardPanel.test.tsx` and confirm PASS.
- [ ] Commit: `git add apps/web/src/components/editor/storyboard/ && git commit -m "feat: add storyboard panel with shot grid"`

**Acceptance criteria:**
- Panel reads `shots` from `useMusicVideoStore` by `openreelProjectId`.
- Shows empty state component when shots array is empty.
- Renders responsive grid of ShotCards sorted by `shot.index`.
- Clicking a card calls `selectShot` (single-select: deselects others).
- Select All / Deselect All toggle calls `selectAllShots`.
- Close button renders when `onClose` prop is provided.
- Shot count displayed in header.

**Constraints:**
- Read `openreelProjectId` from props (not from URL/router).
- No direct timeline manipulation — pure read-only + store actions.
- Grid uses Tailwind responsive columns (`grid-cols-2 sm:grid-cols-3 md:grid-cols-4`).

---

### Task 04: Wire StoryboardPanel into EditorInterface

**Goal:** Render `StoryboardPanel` inside `EditorInterface` when `panels.storyboard.visible` is true, positioned in the timeline band alongside the AudioMixer.

**Files:**
- Modify: `apps/web/src/components/editor/EditorInterface.tsx`
- Modify: `apps/web/src/stores/ui-store.ts` — export the `useProjectStore`'s project ID from the editor

**Reference files:**
- `apps/web/src/components/editor/EditorInterface.tsx:537-546` — AudioMixer rendering pattern
- `apps/web/src/stores/ui-store.ts` — `panels`, `setPanelVisible`
- `apps/web/src/stores/music-video-store.ts` — `activeProjectId`

**TDD steps:**
- [ ] Write failing test: Add component tests for EditorInterface:
  - StoryboardPanel is NOT rendered when `panels.storyboard.visible` is false (default).
  - StoryboardPanel IS rendered when `panels.storyboard.visible` is true.
  - StoryboardPanel's `onClose` calls `setPanelVisible("storyboard", false)`.
- [ ] Run: `pnpm --filter @openreel/web test:run apps/web/src/components/editor/EditorInterface.test.tsx`
- [ ] Confirm expected red: FAIL because StoryboardPanel is not imported/rendered in EditorInterface.
- [ ] Implement the smallest production change:

  **Step A — Import:**
  ```tsx
  // At top of EditorInterface.tsx, add import
  import { StoryboardPanel } from "./storyboard";
  ```

  **Step B — Resolve `openreelProjectId`:**
  The editor needs the music-video project ID. Add a selector for the active project ID:
  ```tsx
  // Inside EditorInterface component, add:
  const openreelProjectId = useMusicVideoStore((s) => s.activeProjectId);
  ```

  **Step C — Render alongside AudioMixer** (after line 546 in the timeline band):
  ```tsx
  {panels.storyboard?.visible && (
    <div className="shrink-0 border-b border-border">
      <PanelErrorBoundary name="Storyboard">
        <StoryboardPanel
          openreelProjectId={openreelProjectId ?? ""}
          onClose={() => setPanelVisible("storyboard", false)}
        />
      </PanelErrorBoundary>
    </div>
  )}
  ```
- [ ] Re-run: `pnpm --filter @openreel/web test:run apps/web/src/components/editor/EditorInterface.test.tsx` and confirm PASS.
- [ ] Commit: `git add apps/web/src/components/editor/EditorInterface.tsx apps/web/src/components/editor/storyboard/ && git commit -m "feat: wire storyboard panel into editor layout"`

**Acceptance criteria:**
- StoryboardPanel renders above timeline when toggled on.
- StoryboardPanel is not rendered by default.
- Close button in StoryboardPanel hides the panel.
- No layout shift when panel is hidden.

**Constraints:**
- Do not change the grid layout of EditorInterface — only add the conditional render block.
- Do not import or render StoryboardPanel in any other component.
- Handle `openreelProjectId` being null gracefully (render empty state).

---

### Task 05: Add toolbar toggle for storyboard panel

**Goal:** Add a toolbar button in `Toolbar.tsx` that toggles storyboard panel visibility.

**Files:**
- Modify: `apps/web/src/components/editor/Toolbar.tsx`

**Reference files:**
- `apps/web/src/components/editor/Toolbar.tsx` — existing toolbar buttons and their layout
- `apps/web/src/stores/ui-store.ts` — `togglePanel`, `panels.storyboard`

**TDD steps:**
- [ ] Write failing test: Add a toolbar test:
  - Toolbar renders a storyboard toggle button.
  - Clicking the button calls `togglePanel("storyboard")`.
  - Button shows active/highlighted state when `panels.storyboard.visible` is true.
- [ ] Run: `pnpm --filter @openreel/web test:run apps/web/src/components/editor/Toolbar.test.tsx`
- [ ] Confirm expected red: FAIL because toolbar has no storyboard button.
- [ ] Implement the smallest production change:
  ```tsx
  // Inside Toolbar, add the button in an appropriate section
  import { LayoutPanelTop } from "lucide-react";
  // ... in the render section with other panel toggle buttons:
  <ToolbarButton
    icon={LayoutPanelTop}
    label="Storyboard"
    active={panels.storyboard?.visible}
    onClick={() => togglePanel("storyboard")}
  />
  ```
  (Adjust to match the existing `ToolbarButton` or button pattern actually used in Toolbar.)
- [ ] Re-run: `pnpm --filter @openreel/web test:run apps/web/src/components/editor/Toolbar.test.tsx` and confirm PASS.
- [ ] Commit: `git add apps/web/src/components/editor/Toolbar.tsx && git commit -m "feat: add storyboard toggle to toolbar"`

**Acceptance criteria:**
- Toolbar has a clickable storyboard toggle button with an icon.
- Clicking shows/hides the storyboard panel.
- Button visually indicates when storyboard panel is visible.
- No regressions in other toolbar buttons.

**Constraints:**
- Use existing `ToolbarButton` pattern / icon button component (look for how AudioMixer and other panels are toggled).
- Button label = "Storyboard", icon = `LayoutPanelTop` from lucide-react.

---

### Task 06: Build `useStoryboardLink` bidirectional hook

**Goal:** Create a React hook that synchronizes shot selection with timeline clip selection bidirectionally:
- **Timeline → Storyboard:** When a clip with `metadata.shotId` is selected in the UI store, select the matching shot in the music-video store.
- **Storyboard → Timeline:** When a shot is selected (via `selectShot`), find the corresponding timeline clip and select it.

**Files:**
- Create: `apps/web/src/components/editor/storyboard/useStoryboardLink.ts`
- Create: `apps/web/src/components/editor/storyboard/useStoryboardLink.test.ts`

**Reference files:**
- `apps/web/src/stores/ui-store.ts` — `selectedItems`, `select`, `SelectionItem`
- `apps/web/src/stores/music-video-store.ts` — `selectShot`, `shots`
- `apps/web/src/stores/project-store.ts` — `project.timeline.tracks[].clips[].metadata.shotId`
- `apps/web/src/features/music-video/timeline/place-generated-asset.ts:67-71` — clip metadata stores `shotId`

**TDD steps:**
- [ ] Write failing test: Add a hook test:
  - When hook mounts and a clip with `metadata.shotId = "shot-1"` is selected in UI store, `selectShot("shot-1", true)` is called in music-video store.
  - When `shots[0].selected` becomes true in music-video store, the hook finds the clip with matching `metadata.shotId` and calls `uiStore.select()` with that clip's trackId and clipId.
  - Hook handles missing shotId gracefully (no crash, no selection).
  - Hook cleans up subscriptions on unmount.
- [ ] Run: `pnpm --filter @openreel/web test:run apps/web/src/components/editor/storyboard/useStoryboardLink.test.ts`
- [ ] Confirm expected red: FAIL because useStoryboardLink does not exist.
- [ ] Implement the smallest production change:
  ```tsx
  // useStoryboardLink.ts
  import { useEffect, useRef } from "react";
  import { useUIStore } from "../../../stores/ui-store";
  import { useMusicVideoStore } from "../../../stores/music-video-store";
  import { useProjectStore } from "../../../stores/project-store";

  /**
   * Bidirectional sync between shot selection and timeline clip selection.
   * - Timeline → Storyboard: selected clip with metadata.shotId selects the shot.
   * - Storyboard → Timeline: selected shot selects the matching timeline clip.
   *
   * Uses refs to prevent infinite loops: each direction checks whether the
   * other side already has the correct state before dispatching.
   */
  export function useStoryboardLink(openreelProjectId: string) {
    const project = useProjectStore((s) => s.project);
    const selectedItems = useUIStore((s) => s.selectedItems);
    const select = useUIStore((s) => s.select);
    const { selectShot, projects } = useMusicVideoStore();
    const mvProject = projects[openreelProjectId];
    const shots = mvProject?.shots ?? [];

    // Track last action to prevent cycles
    const lastAction = useRef<"fromTimeline" | "fromStoryboard" | null>(null);

    // Direction 1: Timeline selection → shot selection
    useEffect(() => {
      const clipItem = selectedItems.find(
        (item) => item.type === "clip" || item.type === "subtitle",
      );
      if (!clipItem) return;

      // Find the clip in the timeline
      for (const track of project.timeline.tracks) {
        const clip = track.clips.find((c) => c.id === clipItem.itemId);
        if (clip?.metadata?.shotId) {
          const shotId = clip.metadata.shotId as string;
          const shot = shots.find((s) => s.id === shotId);
          if (shot && !shot.selected) {
            lastAction.current = "fromTimeline";
            selectShot(openreelProjectId, shotId, true);
          }
          break;
        }
      }
    }, [selectedItems, project.timeline.tracks, shots, selectShot, openreelProjectId]);

    // Direction 2: Shot selection → timeline clip selection
    useEffect(() => {
      const selectedShot = shots.find((s) => s.selected);
      if (!selectedShot) return;

      // Find a timeline clip with matching shotId
      for (const track of project.timeline.tracks) {
        for (const clip of track.clips) {
          if (clip.metadata?.shotId === selectedShot.id) {
            lastAction.current = "fromStoryboard";
            select({ type: "clip", itemId: clip.id, trackId: track.id });
            return;
          }
        }
      }
    }, [shots, project.timeline.tracks, select, openreelProjectId]);
  }
  ```
- [ ] Re-run: `pnpm --filter @openreel/web test:run apps/web/src/components/editor/storyboard/useStoryboardLink.test.ts` and confirm PASS.
- [ ] Commit: `git add apps/web/src/components/editor/storyboard/useStoryboardLink.ts apps/web/src/components/editor/storyboard/useStoryboardLink.test.ts && git commit -m "feat: add bidirectional storyboard-timeline linkage"`

**Acceptance criteria:**
- Selecting a timeline clip that has `metadata.shotId` selects the corresponding storyboard shot.
- Selecting a storyboard shot selects the corresponding timeline clip.
- No infinite loop between the two directions.
- Graceful no-op when no matching shot/clip exists.
- Hook does not crash when `openreelProjectId` is empty or projects are missing.

**Constraints:**
- Use Zustand `subscribe` / selector subscriptions — no polling or intervals.
- Guard against infinite loops with a `lastAction` ref.
- Only runs when `openreelProjectId` is non-empty.

---

### Task 07: Add inline shot editing in storyboard panel

**Goal:** Add inline editing to the StoryboardPanel — clicking a shot's label or prompt opens an editable field. The panel also gets a "Reveal in Timeline" action on each shot.

**Files:**
- Modify: `apps/web/src/components/editor/storyboard/ShotCard.tsx` — add edit mode for label/prompt
- Modify: `apps/web/src/components/editor/storyboard/StoryboardPanel.tsx` — add inline edit handlers, reveal-in-timeline action
- Modify: `apps/web/src/components/editor/storyboard/StoryboardPanel.test.tsx`
- Modify: `apps/web/src/components/editor/storyboard/ShotCard.test.tsx`

**Reference files:**
- `apps/web/src/stores/music-video-store.ts:149-157` — `patchShot` method
- `apps/web/src/components/editor/storyboard/useStoryboardLink.ts` — shot-to-timeline link

**TDD steps:**
- [ ] Write failing test: Update ShotCard and StoryboardPanel tests:
  - ShotCard: double-clicking the label enters edit mode with an input field.
  - ShotCard: blurring or pressing Enter commits the edit and calls `onLabelChange`.
  - StoryboardPanel: editing a shot label calls `patchShot` with the new label.
  - StoryboardPanel: each card has a "Reveal in Timeline" context menu item or button.
- [ ] Run: `pnpm --filter @openreel/web test:run apps/web/src/components/editor/storyboard/ShotCard.test.tsx apps/web/src/components/editor/storyboard/StoryboardPanel.test.tsx`
- [ ] Confirm expected red: FAIL because editing props don't exist yet.
- [ ] Implement the smallest production changes:

  **ShotCard changes:**
  - Add `onLabelChange?: (label: string) => void` and `onPromptChange?: (prompt: string) => void` props.
  - When `onLabelChange` is provided, double-clicking the label text swaps to an `<input>`.
  - Pressing Enter or blurring calls `onLabelChange` and returns to text view.
  - Pressing Escape cancels without saving.

  **StoryboardPanel changes:**
  - Import `patchShot` from `useMusicVideoStore`.
  - Wire `onLabelChange` → `patchShot(id, { label })`.
  - Add a "Reveal in Timeline" button on each card (click calls the timeline link from `useStoryboardLink`).
- [ ] Re-run: `pnpm --filter @openreel/web test:run apps/web/src/components/editor/storyboard/ShotCard.test.tsx apps/web/src/components/editor/storyboard/StoryboardPanel.test.tsx` and confirm PASS.
- [ ] Commit: `git add apps/web/src/components/editor/storyboard/ShotCard.tsx apps/web/src/components/editor/storyboard/StoryboardPanel.tsx && git commit -m "feat: add inline shot editing in storyboard panel"`

**Acceptance criteria:**
- Shot label is inline-editable (double-click to edit, Enter/blur to save, Escape to cancel).
- Shot prompt is inline-editable (same interaction).
- Changes persist via `patchShot` to the music-video-store.
- "Reveal in Timeline" button on each card selects the matching timeline clip.
- Keyboard navigation: Tab between editable fields.

**Constraints:**
- Editing should be compact — use a small input, not a full textarea for label.
- Prompt editing can use a small textarea (2-3 lines) for better ergonomics.
- Do not add a modal or dialog — inline editing only.

---

### Task 08: Add drag-to-reorder shots

**Goal:** Support drag-and-drop reordering of shot cards in the StoryboardPanel. Reordering updates `shot.index` values in the music-video-store.

**Files:**
- Modify: `apps/web/src/components/editor/storyboard/StoryboardPanel.tsx`
- Modify: `apps/web/src/components/editor/storyboard/StoryboardPanel.test.tsx`
- Create: `apps/web/src/components/editor/storyboard/DraggableShotCard.tsx`
- Create: `apps/web/src/components/editor/storyboard/DraggableShotCard.test.tsx`

**Reference files:**
- `apps/web/src/stores/music-video-store.ts:55-56` — `setShots` method
- `packages/music-video-domain/src/types.ts:242-267` — `StoryboardShot.index`

**TDD steps:**
- [ ] Write failing test: Add drag-reorder tests:
  - Dragging a shot card above another swaps their index values.
  - After reorder, `setShots` is called with updated indices.
  - The grid re-renders in the new order.
  - Drag visual feedback (opacity change on dragged card).
- [ ] Run: `pnpm --filter @openreel/web test:run apps/web/src/components/editor/storyboard/DraggableShotCard.test.tsx apps/web/src/components/editor/storyboard/StoryboardPanel.test.tsx`
- [ ] Confirm expected red: FAIL because drag support does not exist.
- [ ] Implement the smallest production change:

  **Strategy:** Use the HTML Drag and Drop API (no third-party library) to keep deps minimal:
  - `DraggableShotCard` wraps `ShotCard` with `draggable="true"` and `onDragStart`/`onDragEnd`.
  - `StoryboardPanel` uses `onDragOver` and `onDrop` on the grid container to detect position and reorder.
  - On drop: compute new index order, call `setShots` with updated `index` values.

  ```tsx
  // DraggableShotCard.tsx (outline)
  export function DraggableShotCard({ shot, onReorder, ...props }) {
    const handleDragStart = (e: React.DragEvent) => {
      e.dataTransfer.setData("text/plain", shot.id);
      e.dataTransfer.effectAllowed = "move";
    };
    return (
      <div draggable onDragStart={handleDragStart} {...props}>
        <ShotCard shot={shot} {...props} />
      </div>
    );
  }
  ```

  In `StoryboardPanel`, add drop handling:
  - `onDragOver`: prevent default, compute drop indicator.
  - `onDrop`: read dragged shot ID, find insertion point, re-index all shots, call `setShots`.
- [ ] Re-run: `pnpm --filter @openreel/web test:run apps/web/src/components/editor/storyboard/DraggableShotCard.test.tsx apps/web/src/components/editor/storyboard/StoryboardPanel.test.tsx` and confirm PASS.
- [ ] Commit: `git add apps/web/src/components/editor/storyboard/ && git commit -m "feat: add drag-to-reorder in storyboard panel"`

**Acceptance criteria:**
- Shot cards are draggable with visual feedback.
- Dropping a card reorders shots and updates `index` values atomically.
- After reorder, the grid reflects the new order.
- Undo works through the music-video-store's existing persistence (no undo action required — shots are re-indexed immediately).

**Constraints:**
- Use native HTML Drag and Drop API — no `react-beautiful-dnd`, `dnd-kit`, or similar.
- Reorder persists to the store immediately (no save button).
- Drop zones should be large enough for easy targeting (use the gap between cards or the drop indicator).
- Do not add reorder animation beyond native drag opacity changes.

---

### Task 09: Run end-to-end smoke test

**Goal:** Verify the full storyboard UI workflow end to end — panel visibility, shot rendering, selection, editing, reorder, and timeline linkage.

**Files:**
- Create: `apps/web/src/components/editor/storyboard/StoryboardPanel.e2e.test.tsx`

**Reference files:**
- All prior tasks' files

**Integration test steps:**
- [ ] Write an integration test that:
  1. Creates a mock project with 3 storyboard shots via the music-video-store.
  2. Opens the storyboard panel (sets `panels.storyboard.visible = true`).
  3. Asserts 3 ShotCard components are rendered in index order.
  4. Clicks the second shot — asserts `selectShot` was called and selected visual state changed.
  5. Double-clicks the shot label, edits text, presses Enter — asserts `patchShot` was called with new label.
  6. Asserts that selecting a timeline clip with `metadata.shotId` results in the corresponding shot being selected.
  7. Drags and drops a shot card — asserts the shot order changed.
  8. Closes the panel — asserts `panels.storyboard.visible` is false.
- [ ] Run: `pnpm --filter @openreel/web test:run apps/web/src/components/editor/storyboard/StoryboardPanel.e2e.test.tsx`
- [ ] Confirm PASS.
- [ ] Commit: `git add apps/web/src/components/editor/storyboard/StoryboardPanel.e2e.test.tsx && git commit -m "chore: verify storyboard UI workflow"`

**Acceptance criteria:**
- Full integration test passes covering all prior tasks' acceptance criteria.
- No flaky assertions — each step verifies a specific state change.

**Constraints:**
- The test must not depend on actual browser APIs for drag-and-drop; use `fireEvent.dragStart`, `fireEvent.dragOver`, `fireEvent.drop` from `@testing-library/react`.
- Mock `useMusicVideoStore` and `useProjectStore` for deterministic testing.
- Do not test the actual DragEvent dataTransfer — test the resulting store calls.

---

## File catalog

### New files

| File | Purpose |
| --- | --- |
| `apps/web/src/components/editor/storyboard/index.ts` | Barrel exports |
| `apps/web/src/components/editor/storyboard/ShotCard.tsx` | Shot card presentational component |
| `apps/web/src/components/editor/storyboard/ShotCard.test.tsx` | ShotCard unit tests |
| `apps/web/src/components/editor/storyboard/StoryboardPanel.tsx` | Main storyboard panel |
| `apps/web/src/components/editor/storyboard/StoryboardPanel.test.tsx` | StoryboardPanel unit tests |
| `apps/web/src/components/editor/storyboard/StoryboardPanel.e2e.test.tsx` | Integration smoke test |
| `apps/web/src/components/editor/storyboard/useStoryboardLink.ts` | Bidirectional selection hook |
| `apps/web/src/components/editor/storyboard/useStoryboardLink.test.ts` | Hook unit tests |
| `apps/web/src/components/editor/storyboard/DraggableShotCard.tsx` | Drag-wrapper around ShotCard |
| `apps/web/src/components/editor/storyboard/DraggableShotCard.test.tsx` | Draggable card tests |

### Modified files

| File | Change |
| --- | --- |
| `apps/web/src/stores/ui-store.ts` | Add `"storyboard"` to `PanelId` (line 6-12); add default panel state (after line 212) |
| `apps/web/src/components/editor/EditorInterface.tsx` | Import and conditionally render `StoryboardPanel` in timeline band |
| `apps/web/src/components/editor/Toolbar.tsx` | Add storyboard toggle button |
| `apps/web/src/stores/ui-store.test.ts` | Add storyboard panel toggle test |
| `apps/web/src/components/editor/EditorInterface.test.tsx` | Add storyboard panel rendering tests |

## Risks and unresolved decisions

1. **openreelProjectId resolution:** The editor currently doesn't have a direct `openreelProjectId` in its state. The plan resolves it via `useMusicVideoStore.activeProjectId`. If that value isn't populated before the editor mounts, the storyboard panel shows its empty state silently. A fallback: resolve from the URL route params or the project store's project metadata. Confirm the activeProjectId lifecycle during implementation.

2. **Drag and drop browser compatibility:** Using native HTML Drag and Drop API limits touch-screen support. If mobile/tablet storyboard reordering is required, a follow-up can add pointer-event-based drag. This plan considers desktop reordering acceptable for v1.

3. **Shot ↔ clip matching contract:** The linkage hook matches through storyboard-specialized video clip metadata (`clip.metadata.kind = "storyboard-shot"` and `clip.metadata.shotId`). Neural Frames import already creates scene clip metadata with `shotId`; `2026-07-03-track-grouping-expansion.md` formalizes the marker and makes imported scenes, generated storyboard shots, and the expanded shot metadata meta-track use the same contract.

4. **Panel layout:** The storyboard panel renders in the timeline band (above the timeline tracks). If the timeline already has AudioMixer visible, panels stack vertically. This is consistent with the existing pattern. If the user wants storyboard as a side panel (replacing media or inspector), that's a future layout option.
