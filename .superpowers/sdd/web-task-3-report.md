# Web Task 3 implementation report

## Outcome

Implemented reusable, read-only Resolve picker preview components for backend render state, media clip thumbnails, grouped disclosures, and a frame-accurate mini timeline.

## Files

- `apps/web/src/components/editor/resolve-picker/RenderedOutputPreview.tsx`
- `apps/web/src/components/editor/resolve-picker/MediaClipPreview.tsx`
- `apps/web/src/components/editor/resolve-picker/ClipGroups.tsx`
- `apps/web/src/components/editor/resolve-picker/MiniTimeline.tsx`
- `apps/web/src/components/editor/resolve-picker/preview-components.test.tsx`

## Correctness

- Render previews preserve backend `ready`, `stale`, and `missing` states. Stale and missing reasons remain visible and no unrelated media is substituted.
- Media URLs are accepted only after validation by the shared strict `@openreel/core` schemas. Components never accept filesystem paths or construct new media URLs.
- Video and audio use one labelled custom play/pause control each, with no duplicate native controls and no autoplay. Promise rejection, media error, pause, and ended events all return the control to an accurate state and surface an actionable error.
- Audio uses the backend-provided canonical `waveformUrl` as an accessible waveform image. It does not invent peak data.
- Clip types render as native-button disclosures with `aria-expanded`, stable `aria-controls`, visible focus styling, pluralized counts, and explicit missing/unsupported explanations.
- Mini-timeline tracks are ordered by their contract index. Clip positions derive from exact start/end frame ratios, preserve gaps, and clamp to 0–100% for overflow. Zero duration never divides by zero and renders an explicit empty state. Visible frame text provides the non-visual equivalent.
- Media containers reserve a fixed 16:9 aspect ratio. No component animation is introduced, so reduced-motion users receive the same stable layout.

## Important failure modes

- A rejected `play()` promise or media decode/network error shows a local alert and resets play state.
- An image or waveform load error replaces the failed visual with an explicit explanation.
- Runtime data outside the shared strict preview schema is rejected visibly rather than passed to a media element.
- Missing previews retain the clip/render record and backend-provided reason.
- Timeline clips wholly or partly beyond the declared duration are visually clamped while their original frame ranges remain available as text.

## Verification

- RED: focused suite failed before implementation with `Failed to resolve import "./ClipGroups"`.
- GREEN: `rtk pnpm --filter @openreel/web exec vitest run src/components/editor/resolve-picker/preview-components.test.tsx` passed 8/8 tests.
- Typecheck: `rtk ./apps/web/node_modules/.bin/tsc --noEmit -p apps/web/tsconfig.json` exited 0.
- Serena diagnostics: zero warnings/errors for all four components and their test file.
- `rtk git diff --check` exited 0.

## Scope note

This task creates the approved reusable components only. The following picker-composition task mounts them into `ProjectMetadata`; browser verification belongs to that mounted integration task.

## Review follow-up: unique disclosure IDs

- Fixed `ClipGroups` disclosures so every component instance derives a sanitized React `useId()` prefix and appends the group type. Each button's `aria-controls` now resolves to its own panel even when multiple project previews are mounted together.
- Regression coverage renders two `ClipGroups` instances, asserts their unsupported-group panel IDs are distinct, verifies each target exists, and confirms collapsing one removes only its own panel.
- RED: the new regression assertion failed against the previous `resolve-clip-group-unsupported` ID collision.
- GREEN: `rtk pnpm --filter @openreel/web exec vitest run src/components/editor/resolve-picker/preview-components.test.tsx` passed 8/8 tests.
- Typecheck: `rtk pnpm --dir apps/web exec tsc --noEmit` exited 0.
- `rtk git diff --check` exited 0.
