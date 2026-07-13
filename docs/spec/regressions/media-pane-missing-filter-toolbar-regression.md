# Media Pane Missing-Filter and Toolbar Regression

**Canonical functional spec:** [Media Assets](../media-assets.md).

**Status:** Reproduced from source; implementation pending.

**Scope:** Media-pane missing-only filtering, final missing-asset replacement, and pane-level toolbar layout.

## User-visible outcome

After the last missing asset is replaced or relinked, the Media pane automatically exits missing-only mode and immediately shows the normal filtered library. Search, import, missing-media actions, grouping, bucket controls, and view controls occupy one compact toolbar row.

## Regression

The user can enable **Show Only Missing Assets**, replace the final missing asset, and become stranded in an empty filtered view. The button that disables the mode is conditionally rendered only while `missingAssetsCount > 0`, but `showOnlyMissing` remains `true`. The control therefore disappears at the exact moment it is needed to recover.

The pane-level controls are also spread across three vertical blocks:

- search and view-mode controls;
- collapse, expand, and group-by controls;
- missing-only and relink controls.

This consumes media-list height and gives related controls inconsistent sizes, borders, labels, and grouping.

## Source diagnosis

`apps/web/src/components/editor/AssetsPanel.tsx` owns both states:

- `showOnlyMissing` is local React state.
- `missingAssetsCount` is derived from the complete `mediaItems` collection using `getMediaStatus(item) === MediaStatus.MISSING`.
- `filteredItems` excludes every non-missing item whenever `showOnlyMissing` is true.
- the missing-only and relink buttons are inside `missingAssetsCount > 0 && (...)`.

There is no state transition that clears `showOnlyMissing` when `missingAssetsCount` becomes zero. React rerenders after replacement with the filter still true, an empty `filteredItems` list, and no missing-only button.

The toolbar fragmentation is in the same `renderSectionContent("media")` branch, immediately before `ScrollArea`. This makes `AssetsPanel` the correct implementation and regression-test boundary.

## Deterministic reproduction

1. Seed `useProjectStore` with one healthy media item and one item for which `getMediaStatus` returns `MediaStatus.MISSING`.
2. Render `AssetsPanel` on the Media tab.
3. Press the missing-only toggle.
4. Confirm only the missing item is rendered and the toggle reports pressed.
5. Update the project store so the missing item is healthy while retaining its media ID, as `replaceMediaAsset` does.
6. Current result: the toggle disappears and the media collection remains empty because `showOnlyMissing` is still true.
7. Required result: missing-only mode resets, the healthy items are visible, and missing-media controls are absent.

## Acceptance criteria

1. `showOnlyMissing` can be true only when `missingAssetsCount > 0`.
2. Resolving the final missing asset cancels missing-only mode no later than the next committed render/effect and displays all items matching the current search query.
3. Resolving one of several missing assets leaves missing-only mode active and shows the remaining missing assets.
4. A later transition from zero missing assets to one or more missing assets does not restore the old missing-only state.
5. Search text, group-by value, bucket expansion state, and view mode survive automatic cancellation.
6. Search filtering neither activates nor cancels missing-only mode.
7. Search, Import, missing-only, Relink, Group by, Collapse all, Expand all, and all three view controls are descendants of one toolbar element containing the search field.
8. There is no second pane-level action row and no full-width missing-media action block.
9. The toolbar uses a single control height and consistent semantic tokens. Icon-only buttons have tooltips, unique accessible names, visible focus styles, and appropriate pressed/disabled semantics.
10. At the minimum supported Media pane width, the toolbar remains one physical line. It does not wrap or clip a control; the search field remains at least 96 CSS pixels wide, or the entire row scrolls horizontally.
11. Missing controls appear/disappear without changing toolbar height or moving focus.
12. Import, relink, grouping, collapse/expand, view selection, asset drag/drop, and search behavior remain functional.

## Required regression tests

Create `apps/web/src/components/editor/AssetsPanel.test.tsx` with deterministic Testing Library coverage:

- **Final replacement:** enable missing-only, replace the only missing fixture through a store update, then `waitFor` the healthy items to appear and the missing controls to disappear.
- **Partial replacement:** begin with two missing fixtures, resolve one, and assert the toggle remains pressed with only the unresolved item visible and count `1`.
- **No sticky reactivation:** resolve the last missing item, then add a new missing item and assert the returned toggle has `aria-pressed="false"` and healthy items remain visible.
- **Search independence:** keep one missing item in the library, use a search that hides it, and assert missing-only state is not implicitly changed.
- **Single toolbar structure:** query `role="toolbar"` by its accessible name, assert it contains the search box and every pane-level control, and assert no pane-level control exists outside it.
- **Control semantics:** assert unique names, missing-toggle `aria-pressed`, active view semantics, grouping-dependent disabled states, and keyboard focusability in visual order.
- **No-wrap contract:** assert the stable toolbar class/style contract (`flex-nowrap`, fixed child shrink behavior, `min-w-0` search container, and overflow fallback). Do not use pixel geometry in jsdom.

Retain `AssetBuckets.test.tsx` coverage for grouping and imperative collapse/expand behavior. Do not move filtering into `AssetBuckets`; cancellation belongs at the `AssetsPanel` state boundary.

## Browser validation

Browser verification is mandatory for sign-off:

1. Start the app with `pnpm dev` and open `http://localhost:5173/editor?projectId=vintage-tokyo` at 1440×900.
2. Open Media, enable missing-only, replace all but one missing item, and verify the filter remains active with the correct count.
3. Replace the final missing item and verify normal media returns automatically with no transient stranded empty state.
4. Reintroduce or load a project with missing media and verify the toggle returns unpressed.
5. Exercise Import, Relink, Group by, Collapse, Expand, and all view modes from the single row.
6. Narrow the Media pane to its supported minimum. Verify one toolbar line, no clipped control, a usable search field, and horizontal toolbar scrolling only if required.
7. Tab through the toolbar. Verify visual order, visible focus, tooltips/accessibility names, pressed state, and disabled controls.
8. Capture wide and minimum-width screenshots as verification evidence and check the browser console for new errors or warnings.

## Important failure modes

- Clearing state only inside the replacement click handler misses folder relink, project hydration, undo/redo, and external store updates. Enforce the derived-state invariant in `AssetsPanel`.
- Deriving the missing count from `filteredItems` couples cancellation to search and can clear the mode incorrectly. Count the complete stabilized media collection.
- Hiding missing controls without resetting state recreates the original trap.
- Resetting every time media changes can erase an active filter while unresolved missing assets remain. Reset only on `missingAssetsCount === 0 && showOnlyMissing`.
- Allowing controls to shrink indiscriminately creates inaccessible hit targets or clipped icons. The search field yields first; action controls do not shrink.
- Moving item/card actions into the toolbar confuses selection-scoped and pane-scoped behavior. Only pane-level controls belong there.

## Evidence collected

- Source inspection of `AssetsPanel` confirms the state/count/filter/conditional-render sequence above.
- `AssetBuckets.test.tsx` covers grouping and collapse/expand but there is no `AssetsPanel` regression suite for this state transition.
- No product code was changed as part of this specification task; browser verification remains an implementation gate.
