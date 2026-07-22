# Preview Transport Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the stopped playhead by default, optionally return it to the playback-session origin, fix replay from timeline end, and add working A-B loop and synchronized playback-rate controls to the Preview footer.

**Architecture:** Keep the persisted rewind preference in `settings-store`, transient transport values in `timeline-store`, and pure boundary decisions in `playback-lifecycle.ts`. Extract the new compact footer controls into a testable component. `Preview.tsx` remains the orchestration boundary that applies the resolved session start, stop target, loop range, and playback rate to every renderer and the master clock.

**Tech Stack:** React, TypeScript, Zustand persist middleware, `@openreel/ui` Switch, Vitest, Testing Library, OpenReel master timeline clock and realtime audio graph.

## Global Constraints

- The visible label is exactly **Revert to begin on stop**.
- The rewind preference is global, persisted, and defaults to `false`.
- “Begin” means the effective start of the current playback session.
- Second play after natural completion must advance normally with either preference value.
- A-B looping must not enter the stopped state at B.
- Playback rate is `0.1x` through `4.0x`, defaults to `1.0x`, and must keep clock, audio, native playback, and decoded video synchronized.
- Timeline zoom and scroll calculations are not changed.

---

### Task 1: Persisted rewind preference

**Files:**
- Modify: `apps/web/src/stores/settings-store.ts`
- Test: `apps/web/src/stores/settings-store.test.ts`

**Interfaces:**
- Produces: `revertToPlaybackStartOnStop: boolean`
- Produces: `setRevertToPlaybackStartOnStop(enabled: boolean): void`

- [ ] **Step 1: Write the failing store test**

```ts
it("persists the rewind-on-stop preference", () => {
  useSettingsStore.setState({ revertToPlaybackStartOnStop: false });
  useSettingsStore.getState().setRevertToPlaybackStartOnStop(true);
  expect(useSettingsStore.getState().revertToPlaybackStartOnStop).toBe(true);
  expect(JSON.parse(localStorage.getItem("openreel-settings") ?? "{}").state)
    .toMatchObject({ revertToPlaybackStartOnStop: true });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `rtk pnpm --filter @openreel/web exec vitest run src/stores/settings-store.test.ts`

Expected: FAIL because the preference and setter do not exist.

- [ ] **Step 3: Add the default, setter, persisted projection, and migration fallback**

Add the fields to `SettingsState`, initialize the preference to `false`, implement the setter with `set`, add it to `partialize`, increment the persisted store version, and migrate missing values with `state.revertToPlaybackStartOnStop ?? false`.

- [ ] **Step 4: Run the test and verify GREEN**

Run: `rtk pnpm --filter @openreel/web exec vitest run src/stores/settings-store.test.ts`

Expected: all settings-store tests pass.

- [ ] **Step 5: Commit**

```bash
rtk git add apps/web/src/stores/settings-store.ts apps/web/src/stores/settings-store.test.ts
rtk git commit -m "feat(web): persist preview rewind preference"
```

### Task 2: Deterministic transport decisions and independent loop markers

**Files:**
- Modify: `apps/web/src/components/editor/preview/playback-lifecycle.ts`
- Modify: `apps/web/src/components/editor/preview/playback-lifecycle.test.ts`
- Modify: `apps/web/src/stores/timeline-store.ts`
- Modify: `apps/web/src/stores/timeline-store.test.ts`

**Interfaces:**
- Produces: `resolvePlaybackSessionStart(input): number`
- Produces: `resolvePlaybackStopPosition(input): number`
- Produces: `isValidLoopRange(start, end): boolean`
- Produces: `setLoopStart(position: number): void`
- Produces: `setLoopEnd(position: number): void`

- [ ] **Step 1: Write failing lifecycle tests**

```ts
expect(resolvePlaybackStopPosition({
  revertToSessionStart: false,
  sessionStart: 4,
  stoppedPosition: 12,
})).toBe(12);

expect(resolvePlaybackStopPosition({
  revertToSessionStart: true,
  sessionStart: 4,
  stoppedPosition: 12,
})).toBe(4);

expect(resolvePlaybackSessionStart({
  requestedPosition: 12,
  timelineEnd: 12,
  loopEnabled: false,
  loopStart: 0,
  loopEnd: 0,
})).toBe(0);

expect(resolvePlaybackSessionStart({
  requestedPosition: 9,
  timelineEnd: 12,
  loopEnabled: true,
  loopStart: 2,
  loopEnd: 6,
})).toBe(2);
```

- [ ] **Step 2: Write failing timeline-store tests**

```ts
useTimelineStore.getState().setLoopStart(3);
useTimelineStore.getState().setLoopEnd(8);
expect(useTimelineStore.getState()).toMatchObject({ loopStart: 3, loopEnd: 8 });

useTimelineStore.getState().setLoopRange(8, 3);
expect(useTimelineStore.getState().loopEnabled).toBe(false);
```

- [ ] **Step 3: Run both tests and verify RED**

Run: `rtk pnpm --filter @openreel/web exec vitest run src/components/editor/preview/playback-lifecycle.test.ts src/stores/timeline-store.test.ts`

Expected: FAIL because the new resolvers and independent boundary setters do not exist.

- [ ] **Step 4: Implement the pure decisions and store actions**

Use a shared end tolerance of one millisecond. A valid enabled loop redirects starts outside `[A, B)` to A. A requested position at timeline end redirects to `0` only when no valid loop applies. `setLoopEnabled(true)` must refuse invalid ranges, and invalidating a currently enabled range must turn looping off.

- [ ] **Step 5: Run both tests and verify GREEN**

Run: `rtk pnpm --filter @openreel/web exec vitest run src/components/editor/preview/playback-lifecycle.test.ts src/stores/timeline-store.test.ts`

Expected: both files pass.

- [ ] **Step 6: Commit**

```bash
rtk git add apps/web/src/components/editor/preview/playback-lifecycle.ts apps/web/src/components/editor/preview/playback-lifecycle.test.ts apps/web/src/stores/timeline-store.ts apps/web/src/stores/timeline-store.test.ts
rtk git commit -m "feat(web): define preview transport boundaries"
```

### Task 3: Accessible preview transport controls

**Files:**
- Create: `apps/web/src/components/editor/preview/PreviewTransportControls.tsx`
- Create: `apps/web/src/components/editor/preview/PreviewTransportControls.test.tsx`
- Modify: `apps/web/src/components/editor/Preview.tsx`

**Interfaces:**
- Consumes: rewind preference and setter from Task 1
- Consumes: loop/rate state and actions from Task 2
- Produces: compact footer controls and scrub-bar A/B marker percentages

- [ ] **Step 1: Write the failing component test**

Render the component with controlled props. Assert that the exact rewind label toggles its callback, A and B callbacks receive the current playhead, Loop is disabled for an invalid range and enabled for a valid range, and the speed slider reports `aria-valuemin="0.1"`, `aria-valuemax="4"`, and updates the rate callback.

- [ ] **Step 2: Run the component test and verify RED**

Run: `rtk pnpm --filter @openreel/web exec vitest run src/components/editor/preview/PreviewTransportControls.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the component using existing primitives**

Use `Switch` from `@openreel/ui`, semantic `<label>` elements, labeled A/B buttons, a Loop toggle button with `aria-pressed`, and `<input type="range" min={0.1} max={4} step={0.1}>`. Use existing footer color, spacing, focus, and disabled-state classes. Export marker percentages from a pure helper or render them in the parent scrub bar with `aria-label="Loop start"` and `aria-label="Loop end"`.

- [ ] **Step 4: Integrate controls into Preview footer**

Select the preference from `useSettingsStore`, transport state/actions from `useTimelineStore`, place A/B markers above the scrub progress bar, and mount the compact control group beside mute/zoom controls without altering zoom state.

- [ ] **Step 5: Run component and existing footer-adjacent tests**

Run: `rtk pnpm --filter @openreel/web exec vitest run src/components/editor/preview/PreviewTransportControls.test.tsx src/components/editor/preview/playback-lifecycle.test.ts src/stores/settings-store.test.ts src/stores/timeline-store.test.ts`

Expected: all files pass.

- [ ] **Step 6: Commit**

```bash
rtk git add apps/web/src/components/editor/preview/PreviewTransportControls.tsx apps/web/src/components/editor/preview/PreviewTransportControls.test.tsx apps/web/src/components/editor/Preview.tsx
rtk git commit -m "feat(web): add preview loop and speed controls"
```

### Task 4: Apply transport behavior across playback paths

**Files:**
- Modify: `apps/web/src/components/editor/Preview.tsx`
- Modify: `apps/web/src/components/editor/preview/playback-lifecycle.test.ts`
- Modify: `apps/web/src/components/editor/preview-audio-playback.ts`
- Modify: `apps/web/src/components/editor/preview-audio-playback.test.ts`
- Modify: `packages/core/src/audio/realtime-audio-graph.ts`
- Create: `packages/core/src/audio/transport-audio-timing.ts`
- Test: `packages/core/src/audio/transport-audio-timing.test.ts`
- Modify: `packages/core/src/playback/master-timeline-clock.ts`
- Test: `packages/core/src/playback/master-timeline-clock.test.ts`

**Interfaces:**
- Consumes: `resolvePlaybackSessionStart`, `resolvePlaybackStopPosition`, valid A-B range, and playback rate
- Produces: repeatable second play, continuous A-B looping, and synchronized rate changes

- [ ] **Step 1: Add regressions for second play, loop wrap, and rate application**

Cover these observable transitions: natural completion leaves the playhead at end when rewind is disabled; a subsequent Play resolves and advances from `0`; rewind enabled returns to the captured nonzero session start; master clock wraps B to A without stopping; rate changes preserve current time and change subsequent clock progression; preview audio/native playback receive the selected rate.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `rtk pnpm --filter @openreel/web exec vitest run src/components/editor/preview/playback-lifecycle.test.ts src/components/editor/preview-audio-playback.test.ts src/components/editor/preview/native-playback-selection.test.ts`

Run: `rtk pnpm --filter @openreel/core exec vitest run src/playback/master-timeline-clock.test.ts`

Expected: new second-play/integration assertions fail before orchestration changes.

- [ ] **Step 3: Capture the effective session start before playback begins**

Resolve from the requested playhead, timeline end, and valid loop range. Store it in a dedicated ref that is not overwritten by ordinary non-playing playhead synchronization during completion cleanup.

- [ ] **Step 4: Replace unconditional completion rewind**

Route every natural-end callback through one completion function. It chooses the actual stopped position or captured session start using the persisted preference, updates both visible playhead and next start ref, then pauses. Cleanup preserves that explicit choice.

- [ ] **Step 5: Configure loop and rate on every active path**

Before `masterClock.play()`, call `masterClock.setLoop(validEnabled, A, B)` and `masterClock.setPlaybackRate(playbackRate)`. Apply the same rate to native media elements and preview audio sources. Ensure decoded-frame scheduling consumes the same rate. When clock time wraps from B to A, seek/reschedule audio and native media without changing `playbackState` from `playing`.

- [ ] **Step 6: Verify focused and broader regressions**

Run the Task 4 focused commands, then:

`rtk pnpm --filter @openreel/web exec vitest run src/components/editor/preview/PreviewTransportControls.test.tsx src/components/editor/preview/playback-lifecycle.test.ts src/components/editor/preview-audio-playback.test.ts src/components/editor/preview/native-playback-selection.test.ts src/components/editor/preview/canvas-renderers.test.ts src/stores/settings-store.test.ts src/stores/timeline-store.test.ts`

Expected: all selected tests pass, including second play.

- [ ] **Step 7: Commit**

```bash
rtk git add apps/web/src/components/editor/Preview.tsx apps/web/src/components/editor/preview/playback-lifecycle.test.ts apps/web/src/components/editor/preview-audio-playback.test.ts apps/web/src/components/editor/preview/native-playback-selection.test.ts packages/core/src/playback/master-timeline-clock.test.ts
rtk git commit -m "fix(web): make preview transport repeatable"
```

### Task 5: Final verification

**Files:**
- Verify all files changed above

- [ ] **Step 1: Run language-server diagnostics for every changed TypeScript file**

Expected: no errors or warnings introduced.

- [ ] **Step 2: Run `rtk git diff --check` and the affected deterministic suite**

Expected: no whitespace errors and all affected tests pass.

- [ ] **Step 3: Verify in the browser on port 5173**

Verify: stop with rewind off preserves position and timeline scroll; stop with rewind on returns to session origin; natural completion followed by second Play advances; A/B markers set and loop continuously; speed changes keep audio/video/playhead synchronized.

- [ ] **Step 4: Push the verified commits**

Run: `rtk git push origin feature/time-machine-media-library`
