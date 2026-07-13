# Media Pane Missing-Filter and Single-Toolbar Implementation Plan

> **Executor:** This plan is written for GPT-5.4-mini. Follow tasks in order, keep changes scoped, and do not declare the UI fixed until the exact browser scenario passes.

**Goal:** Automatically cancel missing-only mode when no missing media remains, and consolidate every Media-pane-level button/dropdown into the single toolbar row containing Search media.

**Measurable outcome:** Replacing or relinking the final missing asset immediately restores the normal searched media collection. The Media pane has one compact, accessible, non-wrapping toolbar containing Search, Import, conditional missing-only and Relink controls, Group by, Collapse/Expand, and Large/Small/List view controls.

**Governing specs:**

- `docs/spec/asset-management-ux.md` → Media toolbar and Missing-only state invariant
- `docs/spec/regressions/media-pane-missing-filter-toolbar-regression.md`

**Primary implementation boundary:** `apps/web/src/components/editor/AssetsPanel.tsx`, especially local state and the `renderSectionContent("media")` branch. Keep `AssetBuckets` responsible only for rendering/group expansion.

**Tech stack:** React 18, TypeScript, Zustand, Tailwind CSS, Radix-based `@openreel/ui`, Lucide icons, Vitest, Testing Library, browser/CDP verification.

## Constraints

- Do not change media status rules or `replaceMediaAsset` semantics.
- Derive `missingAssetsCount` from the complete stabilized `mediaItems`, never from search/filter output.
- Do not clear search, grouping, bucket expansion, selection, or view mode when missing-only cancels.
- Do not put asset-card actions or context-menu actions in the pane toolbar.
- Do not introduce a second toolbar row, wrapping, clipped controls, raw color values, emoji icons, or icon-only controls without accessible names/tooltips.
- Keep missing-only and Relink conditional on `missingAssetsCount > 0`; correctness comes from resetting the state before/when those controls disappear.
- No LLM/probabilistic behavior is involved, so no eval is required.

## Task 1: Add the failing state-transition tests

**Files:**

- Create `apps/web/src/components/editor/AssetsPanel.test.tsx`
- Read, do not modify unless a reusable fixture is genuinely needed: `apps/web/src/components/editor/AssetBuckets.test.tsx`

- [ ] Build a minimal `MediaItem` fixture helper matching the existing helper in `AssetBuckets.test.tsx`. Create healthy items with a non-null `Blob`; create missing placeholders with `blob: null` plus `sourceFile` so `getMediaStatus` classifies them as missing.
- [ ] Seed/reset `useProjectStore` with `createEmptyProject()` plus fixture media items. Reset `useUIStore` selections and call Testing Library `cleanup` after each test. Mock only dependencies that prevent `AssetsPanel` from rendering; keep the real project store, `getMediaStatus`, and Media branch.
- [ ] Write `it("cancels missing-only when the final missing asset is resolved")`: render one healthy and one missing item, press the toggle, prove only missing is visible, update the store with a healthy replacement retaining the same ID, then `waitFor` both healthy items to appear and the missing toggle/Relink controls to be absent.
- [ ] Write `it("keeps missing-only active while another missing asset remains")`: start with two missing items and one healthy item, activate the filter, resolve one missing item through `act`, and assert only the unresolved item remains, count is `1`, and `aria-pressed="true"`.
- [ ] Write `it("does not restore missing-only when missing assets reappear")`: resolve the last missing item, add a new missing fixture, and assert the toggle reappears with `aria-pressed="false"` while healthy items remain visible.
- [ ] Write `it("does not derive missing-only validity from search results")`: activate missing-only with a missing item present, enter a query that does not match it, and assert the toggle remains pressed. Clear the query and assert the missing item returns.
- [ ] Run the focused suite and record the expected pre-fix failure:

```bash
pnpm --filter @openreel/web exec vitest run src/components/editor/AssetsPanel.test.tsx
```

Expected: final-replacement and semantic/layout assertions fail against current code. If the component cannot render, fix only the deterministic test harness before proceeding.

## Task 2: Enforce the missing-only invariant

**File:** `apps/web/src/components/editor/AssetsPanel.tsx`

- [ ] Add `useEffect` to the React import.
- [ ] Immediately after the memoized `missingAssetsCount`, add an effect whose only job is:

```tsx
useEffect(() => {
  if (missingAssetsCount === 0 && showOnlyMissing) {
    setShowOnlyMissing(false);
  }
}, [missingAssetsCount, showOnlyMissing]);
```

- [ ] Do not put this reset inside `handleRelinkFromFolder`, `replaceMediaAsset`, or individual click handlers. The effect must cover every store-driven transition.
- [ ] Keep `filteredItems` dependent on `mediaItems`, `searchQuery`, and `showOnlyMissing`. Do not add `missingAssetsCount` or derive the count from `filteredItems`.
- [ ] Run the four focused transition tests. Confirm final resolution passes, partial resolution preserves the mode, search does not cancel it, and reappearing missing items start unpressed.

## Task 3: Write the failing toolbar structure and semantics tests

**File:** `apps/web/src/components/editor/AssetsPanel.test.tsx`

- [ ] Add a fixture with at least one missing item so every conditional pane control is present.
- [ ] Assert one `role="toolbar"` named `Media controls` contains: textbox `Search media`; buttons `Import media`, `Show only missing assets`, `Relink from folder`, `Collapse all buckets`, `Expand all buckets`, `Large icons`, `Small icons`, `List view`; and combobox `Group media by`.
- [ ] Assert those named pane controls do not exist outside the toolbar.
- [ ] Assert the missing toggle changes `aria-pressed` from false to true.
- [ ] Assert the selected view option uses `aria-pressed="true"` and the other two use false.
- [ ] Select Group by `None` and assert collapse/expand are disabled; select `Type` and assert enabled.
- [ ] Assert the toolbar has the stable non-wrap/overflow class contract and its search wrapper has `min-w-0`; assert action groups have `shrink-0`. Avoid jsdom measurements.
- [ ] Run the focused suite and confirm these tests fail before the markup refactor.

## Task 4: Consolidate the Media toolbar

**File:** `apps/web/src/components/editor/AssetsPanel.tsx`

- [ ] Replace the three current pre-list blocks with one semantic toolbar:

```tsx
<div
  role="toolbar"
  aria-label="Media controls"
  className="flex flex-nowrap items-center gap-1 overflow-x-auto px-4 py-3"
>
  {/* flexible search, then shrink-0 action groups */}
</div>
```

Match repository tokens and component conventions rather than copying the sketch blindly.

- [ ] Search wrapper: `relative min-w-[96px] flex-1`; keep Search icon and Input; give the input `aria-label="Search media"` if placeholder alone does not produce a stable accessible name. Use the shared compact height selected for this toolbar.
- [ ] Add `Import media` as a compact icon button calling existing `triggerFileInput`. Use the existing Upload/Plus icon language, tooltip/title, visible focus ring, and `aria-label`.
- [ ] Move the conditional missing-only toggle next. Convert the full-width yellow card to a compact toggle with `aria-pressed={showOnlyMissing}`, AlertTriangle icon, and a small textual/numeric count that does not rely on color alone. Accessible name: `Show only missing assets`.
- [ ] Move conditional Relink next as a compact icon button calling `handleRelinkFromFolder`, with accessible name `Relink from folder`. Disable it while `isImporting` to prevent concurrent folder operations.
- [ ] Move Group by next. Give `SelectTrigger` `aria-label="Group media by"`, compact width, and the same control height/border/radius tokens.
- [ ] Move Collapse and Expand next without changing ref calls. Retain disabled behavior for `groupBy === "none"`; add consistent title/tooltips and focus styles.
- [ ] Move the view segmented control last. Give each button `aria-label` and `aria-pressed={mediaViewMode === mode}`. Use one compact outer border and consistent active/hover/focus states.
- [ ] Add `shrink-0` to every action/control group. Keep the toolbar `flex-nowrap`. Use `overflow-x-auto` only as the fallback for the minimum-width invariant; do not hide overflow.
- [ ] Remove the old second control row and the old full-width missing-media block completely.
- [ ] Check the hidden file input remains wired to `handleFileImport` and no duplicate Import button is introduced outside content-specific empty states.
- [ ] Run `AssetsPanel.test.tsx` and `AssetBuckets.test.tsx`.

## Task 5: Focused quality gates

- [ ] Run formatting/lint only on touched TypeScript files if the repository supports a scoped command; otherwise run:

```bash
pnpm --filter @openreel/web lint
pnpm --filter @openreel/web typecheck
```

- [ ] Run focused deterministic tests:

```bash
pnpm --filter @openreel/web exec vitest run \
  src/components/editor/AssetsPanel.test.tsx \
  src/components/editor/AssetBuckets.test.tsx
```

- [ ] Run the web test suite if focused checks pass:

```bash
pnpm --filter @openreel/web test:run
```

- [ ] Inspect failures. Do not weaken assertions, add arbitrary waits, or replace the store transition with direct local-state access.

## Task 6: Mandatory browser verification

- [ ] Start the development app and keep it monitored:

```bash
pnpm dev
```

- [ ] Open `http://localhost:5173/editor?projectId=vintage-tokyo` at 1440×900. If the project has no missing items, load/import a deterministic project fixture with one healthy and two missing media placeholders. Do not mutate production data.
- [ ] Open the Media pane and capture a before screenshot showing one toolbar row and the missing count.
- [ ] Enable missing-only. Verify healthy items disappear and the toggle visibly/semantically reports active.
- [ ] Replace one missing item. Verify the mode stays active, the count decrements, and the remaining missing item stays visible.
- [ ] Replace the final missing item. Verify the normal searched library returns automatically, both missing controls disappear, toolbar height stays fixed, and focus is not lost into the document body.
- [ ] Load/reintroduce a missing item. Verify the toggle returns inactive.
- [ ] Exercise Search, Import picker cancel, Group by None/Type, Collapse, Expand, and all three view modes. Verify each action still works.
- [ ] Resize the Media pane to its minimum supported width. Verify controls remain in one line, none are clipped, search retains at least 96 CSS pixels or horizontal toolbar scrolling is available, and the content area has no unrelated horizontal scrollbar.
- [ ] Keyboard-only pass: Tab through controls in visual order, operate buttons with Space/Enter, operate Select with keyboard, confirm visible focus, and confirm icon-only tooltips/accessibility names.
- [ ] Inspect the browser console. Record zero new errors/warnings from this flow.
- [ ] Save wide and narrow screenshots under `/tmp/media-pane-missing-filter-toolbar/` and record their paths in the commit/PR verification notes.

## Task 7: Review, commit, and delivery evidence

- [ ] Review `git diff --check` and `git diff --` for only the intended component/test changes. Preserve unrelated user changes.
- [ ] Confirm the implementation satisfies every acceptance criterion in the regression spec. Explicitly record any unverified assumption.
- [ ] Make one atomic conventional commit after tests and browser verification:

```bash
git add apps/web/src/components/editor/AssetsPanel.tsx \
  apps/web/src/components/editor/AssetsPanel.test.tsx
git commit -m "fix(media): recover and consolidate missing asset controls"
```

- [ ] Push the current branch without force. Never bypass hooks.
- [ ] Final report must use exactly one project status (`DONE`, `DONE_WITH_CONCERNS`, `BLOCKED`, or `NEEDS_CONTEXT`), list exact test commands/results, browser scenario/results, screenshot paths, commit hash, push result, failure modes checked, and restart/reload command (`pnpm dev`, or explicitly state none required for a running HMR session).

## Why this implementation is correct

The effect enforces the actual state invariant at the component boundary that owns both the filter flag and the complete media collection. It therefore covers replacement, relink, project changes, and any other Zustand update without coupling business actions to UI cleanup. The toolbar refactor changes only control placement and semantics while reusing existing handlers and state, which limits behavioral blast radius. Deterministic tests prove state transitions and DOM structure; browser verification proves the rendered layout, responsive behavior, focus, and exact replacement workflow that jsdom cannot validate.
