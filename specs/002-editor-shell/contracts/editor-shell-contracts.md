# Editor Shell Interaction Contracts

## Startup contract

| State | Visible outcome | Required action |
|---|---|---|
| Progress | Progress indicator plus current stage | No Retry while attempt is active |
| Ready | Installed workspace regions | Normal editing actions available |
| Failed | Stable announced error with diagnostic message | Retry starts a new in-place attempt |

A failed attempt must be logged with its underlying error and must not be represented as continuing progress.

## Resize boundary contract

Each installed boundary exposes:

- separator role and orientation;
- an accessible name identifying the adjusted region;
- current, minimum, and maximum values;
- focusability;
- pointer behavior equivalent to the installed drag behavior;
- Arrow-key behavior that moves the physical boundary by the clarified step and clamps it to the same installed bounds.

Direction mapping:

| Boundary | Decrease panel | Increase panel | Step |
|---|---|---|---|
| Media | Left | Right | 10 px |
| Inspector | Right | Left | 10 px |
| Chat | Right | Left | 10 px |
| Timeline | Down | Up | 2 percentage points |

## Tab contract

For primary inspector tabs, clip-edit tabs, and settings tabs:

- exactly one available tab is selected;
- each tab identifies its associated panel and each panel identifies its tab;
- ArrowRight/ArrowDown selects and focuses the next tab, wrapping to the first;
- ArrowLeft/ArrowUp selects and focuses the previous tab, wrapping to the last;
- Home selects and focuses the first tab;
- End selects and focuses the last tab;
- unrelated keys retain current behavior.

## Compatibility contract

- Existing pointer activation, visible labels, panel contents, settings categories, bounds, shortcuts, and error isolation remain unchanged.
- No production file under `apps/web/src/components/editor/tour/` changes in this feature.
- No new export is required from `@openreel/ui`.
