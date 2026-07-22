# Preview Playback Controls Design

## Outcome

Playback no longer changes timeline navigation unexpectedly. By default, the preview playhead remains at the exact position where playback stops, including the timeline end. Users who prefer automatic rewinding can enable a persisted preview-footer toggle labeled **Revert to begin on stop**. The preview footer also exposes functional A-B looping and playback-speed controls.

## Behavior

- The new toggle is off by default.
- The preference is global to the editor and persists across projects and browser restarts through the existing settings store.
- Each transition from stopped/paused to playing captures the effective playback-session start position.
- With the toggle off, stopping playback or naturally reaching the timeline end preserves the stopped playhead position.
- With the toggle on, stopping playback or naturally reaching the timeline end returns the playhead to the captured playback-session start position, not necessarily timeline `0`.
- Pressing Play while positioned at the timeline end begins a new playback session from `0` when no valid A-B loop is active. The reset happens as playback begins, not during the prior stop, so timeline zoom and scrolling remain anchored to the stopped position until the user chooses to play again.
- The second and subsequent plays must render and advance normally through every playback path. Cleanup from the previous run must not restore the timeline-end clock position over the new session start.
- Scrubbing and seeking behavior remains unchanged.

## A-B Loop Playback

- Footer buttons labeled `A` and `B` set the corresponding boundary to the current playhead position.
- The scrub bar displays both boundaries as distinct, accessible markers.
- A separate Loop control enables the range only when `A < B`; an invalid or incomplete range cannot be activated.
- Starting playback outside an enabled range starts at A. Reaching B seeks to A and continues playing without entering the stopped state.
- Pausing an active loop follows the **Revert to begin on stop** preference. When enabled, it returns to the effective session start, which is A if playback was redirected into the loop.
- Editing A or B while playing takes effect on the next boundary evaluation without restarting playback.

## Playback Speed

- The footer exposes an accessible slider using the timeline store's existing `0.1x` through `4.0x` contract, with a visible numeric value and `1.0x` default.
- Speed changes take effect during playback without changing the playhead position.
- Master-clock progression, decoded video cadence, native playback, and preview audio use the same rate so audio, video, and the visible playhead remain synchronized.
- The master clock uses monotonic wall time and never waits for `AudioContext.resume()`, so a suspended or permission-blocked audio context cannot freeze visual playback or second play. Audio resume failures remain observable and audio scheduling catches up from the shared transport position when audio becomes available.
- Playback speed is an editor-session transport state. It does not alter clip speed or rendered export timing.

## Components and Data Flow

1. `settings-store.ts` owns the persisted rewind preference and setter. Its migration/default path treats missing values as `false`.
2. `timeline-store.ts` owns transport rate, independent A/B boundaries, and loop-enabled state.
3. `Preview.tsx` renders the rewind switch, A/B/Loop controls, boundary markers, and speed slider in the existing player-control footer.
4. A playback-session resolver selects the effective start from the requested playhead, valid loop range, and timeline end; the selected value is captured before playback resources start.
5. Playback completion records the actual stopped position and conditionally returns to the captured session start.
6. Every playback implementation applies loop boundaries and rate through the same transport values.
7. Playback cleanup preserves the explicitly selected stop position instead of overwriting it from a stopped master clock.

## Accessibility and Layout

- Use the existing `@openreel/ui` `Switch` component and its established focus/checked semantics.
- Associate visible labels with the switch and slider, expose their current values, and give icon/abbreviated controls descriptive accessible names.
- Keep the control in the right-side footer group, using existing spacing and semantic color tokens.
- Controls must not shift when toggled or introduce horizontal page scrolling. At constrained widths, secondary transport controls may collapse into an overflow popover while remaining keyboard accessible.

## Tests

- Settings-store regression: the preference defaults to `false`, updates, and is included in persisted settings.
- Playback lifecycle regression: completion preserves the stopped position when disabled and returns to the captured session start when enabled.
- Second-play regression: after natural completion with rewind disabled, a play request at the timeline end resolves to `0`, advances, and is not overwritten by cleanup from the prior run.
- Loop regressions: invalid ranges cannot activate; playback outside a valid enabled range starts at A; reaching B seeks to A without stopping.
- Rate regressions: the selected speed drives clock progression, video cadence, native playback, and audio consistently.
- Preview footer regression: the labeled switch, A/B/Loop controls, markers, and speed slider reflect state and invoke the correct actions.
- Existing preview playback, audio, native playback, timeline zoom/scroll, and settings-store tests remain green.

## Failure Modes

- Existing persisted settings do not contain the new key. The default/migration path must produce `false` without discarding other settings.
- Floating-point clock values may sit microscopically below or above the end. End detection must use the editor's established tolerance rather than strict equality.
- A natural-end callback and effect cleanup can run in the same React transition. Completion state remains authoritative so cleanup cannot replace the selected stopped/session-start position with stale clock time.
- The setting changes while playback is active. The value at completion time controls that stop, matching the visible toggle state.
- Native and canvas playback can reach a loop boundary on different frames. Boundary resolution clamps the visible playhead to A before the next frame and prevents a transient stopped state.
- Speed changes can desynchronize audio and video when applied to only one renderer. Every active renderer and clock must consume the same transport-rate update.

## Scope

This change does not alter clip speed, export timing, timeline zoom calculations, timeline scrolling algorithms, scrubbing, or persistence conflict handling.
