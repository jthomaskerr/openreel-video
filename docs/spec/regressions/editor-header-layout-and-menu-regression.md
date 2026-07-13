# Editor Header Layout and Menu Regression

**Status:** Approved for implementation  
**Date:** 2026-07-13  
**Affected surface:** Video editor header  
**Primary implementation:** `apps/web/src/components/editor/Toolbar.tsx`

## User-visible outcome

At every supported editor width, the header remains a single fixed-height row and Export remains a compact, immediately available action. The header menu uses a recognizable hamburger icon. Projects and Neural Frames import are available as labeled menu items instead of consuming permanent header space.

## Regression

The header currently uses a three-column grid (`grid-cols-[1fr_auto_1fr]`) without sufficient minimum-width and wrapping constraints on its edge groups. Its right-hand group includes standalone controls for Neural Frames import and Projects, plus a menu button represented by a star. When horizontal space is constrained, Export can be displaced onto another visual line and the header consumes excessive vertical space.

The icon-only controls also communicate the wrong hierarchy:

- the general menu is represented by `Star`, not a hamburger/menu icon;
- Neural Frames import is represented by a generic upload icon and permanently occupies the header;
- Projects is a standalone header action despite belonging with project and application commands in the menu.

## Required behavior

### Header geometry

1. The header is exactly one row at supported viewport widths from 768 px upward.
2. The header retains its configured `h-topbar` height; content must not increase its block size.
3. The left, center, and right regions must be allowed to shrink safely. Long project names and status text truncate rather than pushing the right region onto another row.
4. The right action region does not wrap (`flex-nowrap`) and does not shrink the Export button below its intrinsic content width.
5. Export remains fully visible in the header, with its icon, `Export` label, and disclosure indicator on one line.
6. Export uses only the space required by its content. It must not grow to fill a grid track or row.
7. No header control overlaps another control or causes horizontal page scrolling.

### Menu trigger

1. Replace the star glyph on the general menu trigger with Lucide's `Menu` hamburger icon.
2. Give the trigger the accessible name `Open editor menu` via `aria-label` or equivalent visible labeling.
3. Preserve keyboard operation, focus visibility, and the existing dropdown alignment.

### Menu contents

1. Remove the standalone Projects button from the header.
2. Add a `Projects` dropdown item using a project-appropriate icon such as `FolderKanban` or `FolderOpen`.
3. Activating `Projects` invokes the existing `handleOpenProjectManager` behavior and closes the dropdown through the menu primitive's normal selection behavior.
4. Remove the standalone Neural Frames import button from the header.
5. Add an `Import Neural Frames` dropdown item using Lucide's `Import` icon. Do not use `Upload`, because this action imports an external artifact into OpenReel rather than exporting data from it.
6. Activating `Import Neural Frames` invokes `neuralFramesImportRef.current?.openFilePicker()` and preserves the existing hidden `NeuralFramesImportTab` integration.
7. Place both commands in a coherent project/import section of the existing menu, separated from theme, settings, tours, and help where appropriate.

## Non-goals

- Redesigning the Export dropdown or changing export formats.
- Changing project-manager behavior.
- Changing Neural Frames parsing, validation, or orchestration.
- Reworking the rest of the editor toolbar icons.
- Supporting editor widths below 768 px in this change.

## Deterministic regression coverage

Add a focused `Toolbar` component test. Mock heavy children and stores only as needed to render the header reliably.

The test must prove:

1. The menu trigger is discoverable by role and accessible name `Open editor menu`.
2. The standalone `Projects` and `Import Neural Frames` actions are absent before opening the menu.
3. Opening the menu reveals labeled `Projects` and `Import Neural Frames` menu items.
4. Selecting `Projects` calls the existing project-manager opening path.
5. Selecting `Import Neural Frames` calls the Neural Frames handle's `openFilePicker` path.
6. The header and right action region carry explicit non-wrapping/minimum-width classes, and Export carries a no-shrink/whitespace invariant. This class-level assertion is intentional because jsdom does not perform layout.

Prefer semantic role/name assertions over icon implementation assertions. A single targeted assertion may verify that the menu trigger no longer renders the star if the icon mock makes that stable.

## Browser regression matrix

Browser verification is mandatory because jsdom cannot establish layout geometry.

Test the editor at these viewport sizes:

| Viewport | Expected result |
| --- | --- |
| 1440 x 900 | Header is one row; Export is compact and fully visible |
| 1024 x 768 | Header is one row; project/status content yields before right actions |
| 768 x 720 | Header is one row; no overlap or horizontal page scroll; Export remains fully visible |

At each width:

1. Record `header.getBoundingClientRect().height` and confirm it equals the computed `h-topbar` height.
2. Confirm the Export trigger's text and icons share one bounding row.
3. Confirm the Export trigger's width is content-sized and materially smaller than the right action region.
4. Open the hamburger menu and activate Projects.
5. Reopen the menu and activate Import Neural Frames, confirming that the file-picker path is reached without a console error.
6. Confirm there are no new browser console errors.

## Acceptance criteria

- All deterministic Toolbar regression tests pass locally.
- Existing web tests and typechecking pass.
- Browser checks pass at all three specified viewports.
- Header height does not change between the three viewports.
- Export never wraps, grows across a row, or leaves the header's single visual row.
- Projects and Import Neural Frames appear only in the hamburger menu and retain their prior behavior.
- The menu trigger has the accessible name `Open editor menu` and displays a hamburger icon.

## Important failure modes

- Applying `flex-nowrap` only to the Export button while leaving a grid child at the default `min-width: auto`; the grid can still overflow.
- Hiding controls at a breakpoint instead of moving them into the menu; this makes actions undiscoverable.
- Moving JSX without preserving the Neural Frames imperative ref or project-manager handler.
- Using only snapshots or jsdom assertions to claim the wrapping defect is fixed.
- Making the entire right grid track fixed-width, which can cause center content to overlap at 768 px.

