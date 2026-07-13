# Editor Header Layout and Menu Implementation Plan

**Implementer:** GPT-5.4-mini  
**Specification:** `docs/spec/regressions/editor-header-layout-and-menu-regression.md`  
**Primary file:** `apps/web/src/components/editor/Toolbar.tsx`

## Outcome

Keep the editor header to one fixed-height row at widths of 768 px and above. Keep Export compact and unwrapped. Replace the star menu trigger with a hamburger, then move Projects and Import Neural Frames into that menu with correct icons and unchanged behavior.

## Constraints for the implementer

- Work only on this header regression; do not redesign adjacent controls.
- Reuse the existing project-manager handler and Neural Frames ref.
- Use existing `@openreel/ui` dropdown primitives and Lucide icons.
- Add the regression test before changing production JSX.
- Do not declare success from jsdom alone. Complete the browser matrix in the spec.
- Preserve unrelated worktree changes.

## Task 1: Establish the failing regression test

**Files:**

- Create `apps/web/src/components/editor/Toolbar.test.tsx`, or extend an existing focused Toolbar test if one exists at implementation time.

**Steps:**

1. Inspect `Toolbar` dependencies and existing test setup. Mock only expensive editor children, browser APIs, and stores needed for deterministic rendering.
2. Render Toolbar with the smallest valid project fixture.
3. Assert that a button named `Open editor menu` exists.
4. Assert `Projects` and `Import Neural Frames` are not exposed as standalone header actions before the menu opens.
5. Open the menu and assert both labeled menu items exist.
6. Add interaction assertions for the existing Projects handler path and `openFilePicker` path. Expose a stable spy from the mocked `NeuralFramesImportTab` imperative handle.
7. Add focused class-contract assertions for a one-row/non-wrapping header: shrinking grid regions, a `flex-nowrap` right group, and `shrink-0 whitespace-nowrap` on Export.
8. Run only this test and confirm it fails for the expected missing accessible name/menu placement/layout contracts.

**Gate:** The new test fails for the current implementation, not because of incomplete mocks.

## Task 2: Correct menu semantics and command placement

**File:** `apps/web/src/components/editor/Toolbar.tsx`

**Steps:**

1. Replace the Lucide `Star` import and rendered icon with `Menu`.
2. Add `aria-label="Open editor menu"` to the dropdown trigger. Add a tooltip only if consistent with adjacent icon-only controls.
3. Remove the standalone Projects tooltip/button block.
4. Add a `Projects` `DropdownMenuItem` that calls `handleOpenProjectManager` and uses a project/folder icon already available from Lucide.
5. Remove the standalone Neural Frames tooltip/button block.
6. Add an `Import Neural Frames` `DropdownMenuItem` that calls `neuralFramesImportRef.current?.openFilePicker()` and renders Lucide `Import`.
7. Group the two commands together near the existing project JSON/file commands. Use one separator to distinguish this project/import group from unrelated menu settings.
8. Remove imports that became unused. Do not remove `Upload` if Export or Load Project JSON still uses it.
9. Run the focused Toolbar test.

**Gate:** Semantic menu tests and both interaction assertions pass.

## Task 3: Make the header layout non-wrapping and shrink-safe

**File:** `apps/web/src/components/editor/Toolbar.tsx`

**Steps:**

1. Keep `h-topbar` and the three logical regions, but make the grid tracks shrink-safe, for example with `minmax(0,1fr)` edge tracks rather than bare `1fr` where needed.
2. Add `min-w-0` to grid children whose text may truncate.
3. Ensure the right action group is `flex flex-nowrap items-center`, `min-w-0` where appropriate, and aligned to the end.
4. Add `shrink-0 whitespace-nowrap` to the Export trigger and to its exporting/complete/error state replacements where necessary, so state transitions cannot change row count.
5. Ensure long project-name/status content truncates with `overflow-hidden`, `text-ellipsis`, and `whitespace-nowrap` at the narrow boundary rather than expanding the grid.
6. Do not solve the issue by hiding Export, changing header height, or adding horizontal page scrolling.
7. Run the focused Toolbar test and update only assertions that express the final explicit layout contract.

**Gate:** Focused test passes and the production class structure directly enforces every geometry requirement.

## Task 4: Run deterministic verification

**Steps:**

1. Run the focused Toolbar test.
2. Run the web package's established unit-test command for affected tests.
3. Run the web package typecheck.
4. Run lint/format checks required by the repository.
5. If an unrelated pre-existing failure occurs, capture the exact command and error; do not weaken the new regression test.

**Gate:** Focused test, affected web tests, typecheck, and required lint checks pass.

## Task 5: Verify the actual layout in a browser

**Steps:**

1. Start the app with `pnpm dev` on port 5173 and open a real editor project.
2. At 1440 x 900, 1024 x 768, and 768 x 720, measure header and Export rectangles in the browser.
3. Confirm header height equals the configured topbar height and remains identical across viewports.
4. Confirm Export is one line, content-sized, visible, and non-overlapping at every width.
5. Confirm the page has no header-induced horizontal overflow.
6. Open the hamburger menu and activate Projects; confirm the project manager opens.
7. Open the menu and activate Import Neural Frames; confirm the import file-picker path opens.
8. Check the browser console after each workflow and record any errors.
9. Save exact viewport measurements and interaction results in the implementation report or commit body.

**Gate:** Every browser check in the regression specification passes at all three viewports.

## Task 6: Review and deliver

**Steps:**

1. Review the diff for accidental behavior changes and unused imports.
2. Confirm no standalone Projects or Neural Frames header controls remain.
3. Confirm the menu trigger has an accessible name and visible focus state.
4. Commit the test and implementation as one atomic regression fix using a conventional commit message, after all gates pass.
5. Report why the fix is correct, its remaining failure modes, exact test commands/results, browser measurements, and whether a reload/restart is required.

## Definition of done

- The regression specification's acceptance criteria all pass.
- The failing test was observed before the production change.
- Deterministic checks pass.
- Browser verification proves geometry and interactions at all specified widths.
- No required behavior is supported only by a manual claim.
