# Asset Management UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining gaps between `docs/spec/asset-management-ux.md` and the actual Assets panel implementation: add the `Recently Added` and `Unused` smart buckets, add a `createdAt` field to `MediaItem` so recency-based bucketing and sorting are possible, add explicit sort controls, and add multi-select + batch operations (batch tag/group/delete) to the asset browser. Existing density modes, tag/type/status buckets, search, drag-to-timeline, inline rename, and per-item context menu already match spec and are treated as **Implemented & Correct** below — no rework proposed for those.

**Architecture:** `AssetsPanel.tsx` owns panel-level UI state (search, view mode, groupBy, selection); `AssetBuckets.tsx` is a pure, presentation-only bucket computer/renderer driven by props. The existing `GroupBy` union (`"none" | "tag" | "type" | "status"`) is the extension point for new bucket kinds; `computeBuckets` is the single place bucket logic lives. Multi-select re-uses the existing generic `useUIStore` selection primitives (`select`, `selectMultiple`, `deselect`, `isSelected`) that already support `addToSelection`, so no new selection store is needed — `AssetsPanel` just needs to wire shift/ctrl-click and a batch action bar into what the store already exposes.

**Tech Stack:** TypeScript, React, Zustand (`useProjectStore`, `useUIStore`), Vitest, Testing Library, Tailwind CSS, `@openreel/core` `MediaItem`/`MediaLibrary` types.

---

## Spec Requirement Evaluation

Evidence gathered against `apps/web/src/components/editor/AssetsPanel.tsx`, `apps/web/src/components/editor/AssetBuckets.tsx`, `apps/web/src/components/editor/asset-manager/AssetDetailShared.tsx`, `apps/web/src/stores/ui-store.ts`, and `packages/core/src/types/project.ts`.

| Spec Requirement | Status | Evidence |
| --- | --- | --- |
| Density modes (large/small/list) | **Implemented & Correct** | `MediaViewMode = "large" \| "small" \| "list"`, view-mode toggle buttons `AssetsPanel.tsx:1266-1284`, grid/list rendering branch in `AssetBuckets.tsx` `gridClass` (`viewMode === "list"` vs grid). |
| Bucket: All Assets | **Implemented & Correct** | `groupBy: "none"` renders a single flat bucket (`computeBuckets` `case "none"`, `AssetBuckets.tsx:112-113`). |
| Bucket: Videos / Audio / Images | **Implemented & Correct** | `groupBy: "type"` iterates `["video","audio","image","srt"]` and buckets by `item.type` (`AssetBuckets.tsx:139-149`). Note: spec only mentions Video/Audio/Image; `srt` (subtitles) is an implementation addition beyond spec, not a gap. |
| Bucket: By tag | **Implemented & Correct** | `groupBy: "tag"` builds one bucket per unique `item.tags` value plus an "Untagged" bucket (`AssetBuckets.tsx:120-136`). |
| Bucket: By group | **Not Implemented** | `MediaItem.group` exists (`packages/core/src/types/project.ts:72`) and is editable via `MetadataEditor` (`AssetDetailShared.tsx:97-116`), but `GroupBy` union has no `"group"` variant and `computeBuckets` has no case for it — grouping by `item.group` is not selectable in the UI. Currently `groupBy` options are `none | tag | type | status` only (`AssetsPanel.tsx` Select items, ~line 1291-1300). |
| Bucket: Recently Added (last 24h by `createdAt`) | **Not Implemented** | `MediaItem` has no `createdAt` field at all (`packages/core/src/types/project.ts:31-73` — confirmed absent; only `Composition`/other types have `createdAt`, e.g. `types/composition.ts:253,290`). Spec explicitly calls out "needs new field" — this is a known, spec-acknowledged gap, not a regression. |
| Bucket: Unused (media not on any timeline track) | **Not Implemented** | No cross-reference logic between `mediaLibrary.items` and timeline `Clip.mediaId` usage exists in `AssetBuckets.tsx` or `AssetsPanel.tsx`; `computeBuckets` only reasons about the flat `MediaItem[]` list, never the project's tracks/clips. |
| Bucket: Status (extra, not in spec's bucket table but present) | **Implemented & Correct** (bonus) | `groupBy: "status"` buckets by Normal/Pending/Error/Placeholder (`AssetBuckets.tsx:151-159`). Not a gap since it's additive to spec, but noted for completeness in Step 3's new bucket wiring (grouping select already has 4 slots; new entries append, not replace). |
| Search across name/title/description/tags/group | **Implemented & Correct** | `filteredItems` in `AssetsPanel.tsx` (~line 990-1005) and the redundant filter inside `computeBuckets` (`AssetBuckets.tsx:105-113`) both check `name`, `title`, `description`, `tags`, `group`. |
| Sort controls (by name/date/size/duration) | **Not Implemented** | No sort state, no sort comparator, no sort UI control anywhere in `AssetsPanel.tsx` — items render in `mediaLibrary.items` array order (import order) within each bucket, unsorted. Grep for `sortBy`/`Sort` in the file returns no matches. |
| Drag-to-timeline | **Implemented & Correct** | `onDragStart` sets `application/json` payload with `mediaId` and calls `useUIStore.getState().startDrag(...)` (`AssetsPanel.tsx` `MediaThumbnailRow.handleDragStart`, ~line 660-666). |
| Double-click / button "Add to Timeline" | **Implemented & Correct** | `onDoubleClick` and explicit hover-overlay button both call `onAddToTimeline` → `addClipToNewTrack` (`AssetsPanel.tsx` `MediaThumbnail`, multiple call sites). |
| Inline rename | **Partially Implemented — Divergent** | Rename exists but uses a blocking `window.prompt(...)` (`AssetsPanel.tsx` `onRenameRef`, ~line 1170-1175), not true inline (in-place, no-modal) editing. Functionally covers the requirement (user can rename an asset) but diverges from a typical "inline rename" UX expectation (double-click name → edit in place). Reachable via context menu ("Rename") in both grid and list views. |
| Batch operations (multi-select + bulk tag/group/delete) | **Not Implemented** | `useUIStore` already has generic multi-select primitives (`select(item, addToSelection)`, `selectMultiple`, `deselect`, `isSelected`, `clearSelection` — `ui-store.ts:293-344`) and `selectedItemIds` is already computed and passed through to `AssetBuckets`/`MediaThumbnailRow` for single-item highlight (`AssetsPanel.tsx` `selectedItemIds` memo). However: (a) no click handler in `MediaThumbnailRow.handleSelect` passes `addToSelection` based on shift/ctrl modifier — `handleSelect` always calls `select({ type: "clip", id: item.id })` with default `addToSelection = false` (single-select only); (b) there is no batch action bar / toolbar that appears when `selectedItemIds.size > 1`; (c) there are no batch mutation actions (`updateMediaMetadata` is only ever called with a single `id` from `MetadataEditor`, no bulk variant exists in `project-store.ts`). |
| Asset detail / metadata editor (title, description, tags, group) | **Implemented & Correct** | `MetadataEditor` component fully implements title/description/tags/group editing with save/dirty-check (`AssetDetailShared.tsx:16-100`). |
| Version history / "Set Current" | **Implemented & Correct** (beyond spec scope, not a gap) | `VersionList` + `assetGroupId`/`isCurrent` fields fully implemented (`AssetDetailShared.tsx:245-305`, `project.ts:52,54`). Not required by this spec section but confirms the asset data model already supports richer metadata than buckets currently expose. |
| Missing/placeholder asset handling (relink) | **Implemented & Correct** (beyond spec scope) | "Show Only Missing Assets" filter + "Relink from Folder" flow fully implemented (`AssetsPanel.tsx` ~line 1330-1360). Out of scope for this plan. |

**Summary of genuine gaps requiring implementation:** (1) `createdAt` field on `MediaItem`, (2) `Recently Added` bucket, (3) `Unused` bucket, (4) `By group` bucket, (5) sort controls, (6) multi-select via shift/ctrl-click, (7) batch action bar with bulk tag/group/delete.

---

## File map

- Modify: `packages/core/src/types/project.ts` — add `readonly createdAt?: number` to `MediaItem`.
- Modify: `apps/web/src/stores/project-store.ts` — stamp `createdAt` on import (`importMedia`); add `bulkUpdateMediaMetadata` and `bulkDeleteMedia` actions.
- Modify: `apps/web/src/stores/project-store.test.ts` — cover `createdAt` stamping and new bulk actions.
- Modify: `apps/web/src/components/editor/AssetBuckets.tsx` — extend `GroupBy` union with `"date" | "group"`, add `Recently Added`/`Unused`/`By group` bucket logic, accept `usedMediaIds` prop for the Unused bucket.
- Modify: `apps/web/src/components/editor/AssetBuckets.test.tsx` (create if absent) — cover new bucket kinds.
- Modify: `apps/web/src/components/editor/AssetsPanel.tsx` — add sort control + comparator, compute `usedMediaIds` from timeline tracks/clips, wire shift/ctrl-click multi-select into `MediaThumbnailRow.handleSelect`, add batch action bar (bulk delete / bulk tag / bulk group) shown when `selectedItemIds.size > 1`.
- Modify: `apps/web/src/components/editor/AssetsPanel.test.tsx` (create if absent) — cover sort, Unused bucket, multi-select, batch bar.

---

## Task index

| Seq | Task | Depends on | Parallel | Commit |
| --- | --- | --- | --- | --- |
| 01 | Add `createdAt` to `MediaItem` and stamp on import | none | true | `feat(core): add createdAt to MediaItem` |
| 02 | Add sort controls to Assets panel | none | true | `feat(web): add asset sort controls` |
| 03 | Add `By group`, `Recently Added`, `Unused` buckets | 01 | false | `feat(web): add group/recency/unused asset buckets` |
| 04 | Add multi-select (shift/ctrl-click) | none | true | `feat(web): add multi-select to asset browser` |
| 05 | Add batch action bar (bulk delete/tag/group) | 04 | false | `feat(web): add batch asset operations` |

---

## Task 01: Add `createdAt` to `MediaItem` and stamp on import

**Files:**
- Modify: `packages/core/src/types/project.ts`
- Modify: `apps/web/src/stores/project-store.ts`
- Modify: `apps/web/src/stores/project-store.test.ts`

**Steps:**

- [ ] **Step 1: Add the field**

```typescript
// packages/core/src/types/project.ts — inside MediaItem interface
/** Timestamp (ms since epoch) when this media item was imported/created. Optional for backward-compat with existing saved projects. */
readonly createdAt?: number;
```

- [ ] **Step 2: Stamp on import**

Find where `importMedia` constructs the new `MediaItem` in `apps/web/src/stores/project-store.ts` and add `createdAt: Date.now()` to the constructed object.

- [ ] **Step 3: Backward-compat for existing projects**

Do not backfill `createdAt` for already-saved items on load — leave `undefined` for pre-existing items so "Recently Added" naturally excludes them (correct behavior: they weren't recently added). No migration needed.

- [ ] **Step 4: Test**

```bash
cd apps/web && npx vitest run src/stores/project-store.test.ts
```

Add/extend a test asserting a freshly imported `MediaItem` has a `createdAt` within a small delta of `Date.now()`.

- [ ] **Step 5: Typecheck + commit**

```bash
cd packages/core && npx tsc --noEmit
cd ../../apps/web && npx tsc --noEmit
git add packages/core/src/types/project.ts apps/web/src/stores/project-store.ts apps/web/src/stores/project-store.test.ts
git commit -m "feat(core): add createdAt to MediaItem"
```

---

## Task 02: Add sort controls to Assets panel

**Files:**
- Modify: `apps/web/src/components/editor/AssetsPanel.tsx`

**Steps:**

- [ ] **Step 1: Add sort state**

```typescript
type SortBy = "name" | "date" | "size" | "duration";
const [sortBy, setSortBy] = useState<SortBy>("name");
const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
```

- [ ] **Step 2: Add a sort comparator and apply before bucketing**

Sort `filteredItems` (or pass `sortBy`/`sortDir` down to `AssetBuckets` and sort within each bucket after `computeBuckets`, whichever preserves bucket grouping — sorting within each bucket's `items` array is preferable so grouping and sort compose correctly). Comparator:

```typescript
function compareItems(a: MediaItem, b: MediaItem, sortBy: SortBy, dir: "asc" | "desc"): number {
  const mult = dir === "asc" ? 1 : -1;
  switch (sortBy) {
    case "name": return mult * a.name.localeCompare(b.name);
    case "date": return mult * ((a.createdAt ?? 0) - (b.createdAt ?? 0));
    case "size": return mult * ((a.metadata?.fileSize ?? 0) - (b.metadata?.fileSize ?? 0));
    case "duration": return mult * ((a.metadata?.duration ?? 0) - (b.metadata?.duration ?? 0));
  }
}
```

- [ ] **Step 3: Add UI control**

Add a `Select` next to the existing `groupBy` `Select` in the media tab toolbar (`AssetsPanel.tsx` ~line 1287-1301), following the same styling pattern (`h-8 text-xs bg-background-tertiary border-border`). Include a direction-toggle icon button (asc/desc) reusing the existing icon-button pattern used for collapse/expand-all.

- [ ] **Step 4: Test**

Add a test asserting items render in the selected sort order for each `sortBy` value (name, date, size, duration) in both directions.

- [ ] **Step 5: Verify + commit**

```bash
cd apps/web && npx tsc --noEmit && npx vitest run src/components/editor/AssetsPanel.test.tsx
git add apps/web/src/components/editor/AssetsPanel.tsx apps/web/src/components/editor/AssetsPanel.test.tsx
git commit -m "feat(web): add asset sort controls"
```

---

## Task 03: Add `By group`, `Recently Added`, `Unused` buckets

**Files:**
- Modify: `apps/web/src/components/editor/AssetBuckets.tsx`
- Modify: `apps/web/src/components/editor/AssetsPanel.tsx`

**Steps:**

- [ ] **Step 1: Extend `GroupBy` union**

```typescript
// AssetBuckets.tsx
export type GroupBy = "none" | "tag" | "type" | "status" | "group" | "smart";
```
(Using `"smart"` as one combined mode for Recently Added + Unused + All, since these are cross-cutting "smart buckets" per spec rather than a partition of every item like tag/type/status. Alternative: add `"recent"` and `"unused"` as toggle filters instead of `GroupBy` modes if product intent is "quick filter buttons" rather than a groupBy dropdown entry — confirm which UX the spec's table implies before implementing; the spec lists these as rows in the same `Bucket` table as tag/type/group, so treating them as additional `GroupBy` values matching the existing dropdown pattern is the most consistent implementation of the spec's literal wording.)

- [ ] **Step 2: Implement `By group` case**

```typescript
case "group": {
  const groupSet = new Set<string>();
  for (const item of filtered) if (item.group) groupSet.add(item.group);
  const buckets: BucketDef[] = [];
  const ungrouped = filtered.filter((i) => !i.group);
  if (ungrouped.length > 0) buckets.push({ id: "group-ungrouped", label: "Ungrouped", items: ungrouped });
  for (const group of [...groupSet].sort()) {
    const groupItems = filtered.filter((i) => i.group === group);
    if (groupItems.length > 0) buckets.push({ id: `group-${group}`, label: group, items: groupItems });
  }
  return buckets;
}
```
(Mirrors the existing `case "tag"` pattern exactly.)

- [ ] **Step 3: Implement `Recently Added` + `Unused` as part of `"smart"` case**

Add a new `usedMediaIds: ReadonlySet<string>` prop to `AssetBucketsProps` (computed by the caller from all timeline tracks' clips' `mediaId`s — see Step 4).

```typescript
case "smart": {
  const buckets: BucketDef[] = [];
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const recent = filtered.filter((i) => (i.createdAt ?? 0) >= dayAgo);
  if (recent.length > 0) buckets.push({ id: "smart-recent", label: "Recently Added", items: recent });
  const unused = filtered.filter((i) => !usedMediaIds.has(i.id));
  if (unused.length > 0) buckets.push({ id: "smart-unused", label: "Unused", items: unused });
  buckets.push({ id: "smart-all", label: "All Assets", items: filtered });
  return buckets;
}
```

- [ ] **Step 4: Compute `usedMediaIds` in `AssetsPanel.tsx`**

```typescript
const usedMediaIds = useMemo(() => {
  const ids = new Set<string>();
  for (const track of project.timeline.tracks) {
    for (const clip of track.clips) {
      if (clip.mediaId) ids.add(clip.mediaId);
    }
  }
  return ids;
}, [project.timeline.tracks]);
```
Verify the actual field names (`track.clips`, `clip.mediaId`) against `packages/core/src/types/timeline.ts` before writing — do not assume the shape; grep confirmed `Clip` type exists in that file but exact property names must be checked in context (`timeline.ts:57-107` per Task 01 evidence in the track-grouping plan). Pass `usedMediaIds={usedMediaIds}` into `AssetBuckets`.

- [ ] **Step 5: Add `"Group"` and `"Smart"` (or `"Recent/Unused"`) entries to the `groupBy` Select**

Extend the options array in `AssetsPanel.tsx` (~line 1291-1301) to include the two new values with labels `"Group"` and e.g. `"Smart"` (or split into two clearer labels if UX review prefers explicit "Recently Added"/"Unused" toggle buttons instead of a single dropdown value — implement the dropdown-value version first since it's the minimal change matching existing patterns; flag as an open UX question in the commit message if uncertain).

- [ ] **Step 6: Test**

Add `AssetBuckets.test.tsx` (or extend if it exists) covering: `groupBy: "group"` produces one bucket per `item.group` + Ungrouped; `groupBy: "smart"` produces Recently Added (items with `createdAt` within 24h), Unused (items whose id isn't in `usedMediaIds`), and All Assets.

- [ ] **Step 7: Verify + commit**

```bash
cd apps/web && npx tsc --noEmit && npx vitest run src/components/editor/AssetBuckets.test.tsx src/components/editor/AssetsPanel.test.tsx
git add apps/web/src/components/editor/AssetBuckets.tsx apps/web/src/components/editor/AssetsPanel.tsx apps/web/src/components/editor/AssetBuckets.test.tsx
git commit -m "feat(web): add group/recency/unused asset buckets"
```

---

## Task 04: Add multi-select (shift/ctrl-click)

**Files:**
- Modify: `apps/web/src/components/editor/AssetsPanel.tsx`

**Steps:**

- [ ] **Step 1: Read current single-select handler**

`MediaThumbnailRow.handleSelect` (`AssetsPanel.tsx`, inside the `React.memo`'d row component) currently does:
```typescript
const handleSelect = useCallback(() => {
  useUIStore.getState().select({ type: "clip", id: item.id });
  onManageRef?.current?.(item);
}, [item.id, onManageRef]);
```
This always replaces selection (no `addToSelection`) and always opens the inspector via `onManageRef`. Both must change for multi-select to work without unwanted inspector churn.

- [ ] **Step 2: Thread the click event through to read modifier keys**

Change `onSelect: () => void` to `onSelect: (e: React.MouseEvent) => void` in `MediaThumbnail`'s props and its two call sites (`onClick={onSelect}` in both list and grid views already pass the native event — currently discarded). Update `handleSelect`:

```typescript
const handleSelect = useCallback((e: React.MouseEvent) => {
  const additive = e.shiftKey || e.metaKey || e.ctrlKey;
  useUIStore.getState().select({ type: "clip", id: item.id }, additive);
  if (!additive) onManageRef?.current?.(item);
}, [item.id, onManageRef]);
```
(Only open the inspector on a plain click, not on additive multi-select clicks — matches typical file-browser UX and avoids inspector flicker while multi-selecting.)

- [ ] **Step 3: Handle range-select (shift-click extends from `lastSelectedItem`)**

`useUIStore` already tracks `lastSelectedItem`. Add a range-select branch: if `e.shiftKey` and `lastSelectedItem` exists and is also a `"clip"` selection, compute the index range between `lastSelectedItem.id` and `item.id` within the currently rendered/filtered item list and call `selectMultiple` with that range, rather than just additive single-item toggling for shift. Ctrl/meta-click remains additive single-item toggle (standard OS convention: shift = range, ctrl/cmd = toggle single).

- [ ] **Step 4: Test**

Add tests: plain click replaces selection + opens inspector; ctrl-click toggles item into/out of selection without opening inspector; shift-click selects a contiguous range.

- [ ] **Step 5: Verify + commit**

```bash
cd apps/web && npx tsc --noEmit && npx vitest run src/components/editor/AssetsPanel.test.tsx
git add apps/web/src/components/editor/AssetsPanel.tsx
git commit -m "feat(web): add multi-select to asset browser"
```

---

## Task 05: Add batch action bar (bulk delete/tag/group)

**Files:**
- Modify: `apps/web/src/stores/project-store.ts`
- Modify: `apps/web/src/components/editor/AssetsPanel.tsx`

**Steps:**

- [ ] **Step 1: Add bulk store actions**

In `project-store.ts`, add (mirroring the existing single-item `deleteMedia`/`updateMediaMetadata` implementations, batching into one history/undo entry rather than N separate ones — check how `deleteMedia` records history and replicate the batching pattern rather than looping the single-item action N times if the store uses an undo/history system per action):

```typescript
bulkDeleteMedia: (ids: string[]) => Promise<void>;
bulkUpdateMediaMetadata: (ids: string[], patch: { tags?: string[]; group?: string }) => Promise<void>;
```
For `bulkUpdateMediaMetadata`, tags should be **added** (union) to each item's existing tags, not replace them — replacing would destroy per-item tags the user already set. Group should **set** (replace), since group is a single-value field representing "move to bucket."

- [ ] **Step 2: Add batch action bar UI**

In `AssetsPanel.tsx`'s media tab render, above `AssetBuckets`, conditionally render a bar when `selectedItemIds.size > 1`:

```tsx
{selectedItemIds.size > 1 && (
  <div className="px-4 pb-2 flex items-center gap-2 text-xs">
    <span className="text-text-muted">{selectedItemIds.size} selected</span>
    <button onClick={handleBulkDelete} className="...">Delete</button>
    <button onClick={handleBulkTag} className="...">Add Tag…</button>
    <button onClick={handleBulkGroup} className="...">Set Group…</button>
    <button onClick={() => useUIStore.getState().clearSelection()} className="...">Clear</button>
  </div>
)}
```
Reuse existing `Input`/`Button` primitives from `@openreel/ui` and the existing yellow-banner visual pattern (`AssetsPanel.tsx` ~line 1330) for styling consistency — a small popover or `window.prompt` for tag/group input is acceptable (matches existing single-item rename's `window.prompt` precedent), but confirm with the operator if a real form is preferred before defaulting to `prompt`.

- [ ] **Step 3: Wire handlers**

```typescript
const handleBulkDelete = useCallback(async () => {
  await useProjectStore.getState().bulkDeleteMedia([...selectedItemIds]);
  useUIStore.getState().clearSelection();
}, [selectedItemIds]);
```
Similar for tag/group, prompting for the value then calling `bulkUpdateMediaMetadata`.

- [ ] **Step 4: Test**

Cover: batch bar appears only when 2+ items selected; bulk delete removes all selected items and clears selection; bulk tag adds a tag to all selected items without clobbering existing tags; bulk group sets group on all selected items.

- [ ] **Step 5: Verify + commit**

```bash
cd apps/web && npx tsc --noEmit && npx vitest run src/components/editor/AssetsPanel.test.tsx src/stores/project-store.test.ts
git add apps/web/src/stores/project-store.ts apps/web/src/components/editor/AssetsPanel.tsx apps/web/src/stores/project-store.test.ts
git commit -m "feat(web): add batch asset operations"
```

---

## Browser Verification

Per project AGENTS.md, this touches browser UI — typecheck/unit tests alone do not prove the fix works. Before considering any task in this plan complete:

- [ ] Start dev server (`pnpm dev`, port 5173), open the app, import several media files with different types/tags/groups.
- [ ] Verify sort control changes item order for name/date/size/duration, both directions.
- [ ] Verify `By group` bucket groups correctly and `Ungrouped` catches items with no group.
- [ ] Verify `Recently Added` shows only items imported in the current session; `Unused` shows only items not present on any timeline track (add one to the timeline and confirm it disappears from Unused).
- [ ] Verify shift-click selects a contiguous range and ctrl/cmd-click toggles individual items without replacing the whole selection.
- [ ] Verify the batch action bar appears at 2+ selected items, and bulk delete/tag/group operate on exactly the selected set.

---

## Size / Complexity Estimate

**Size: M (Medium).** Five tasks, three of which (01, 02, 04) are small and largely additive; Task 03 requires careful attention to the existing `computeBuckets` switch pattern and correct `Clip`/`mediaId` field lookups; Task 05 requires new store actions with correct undo/history batching semantics, which is the highest-risk piece since it touches state mutation patterns not previously exercised in bulk form. No backend/orchestrator changes required — fully contained to `packages/core` (one field) and `apps/web`.
