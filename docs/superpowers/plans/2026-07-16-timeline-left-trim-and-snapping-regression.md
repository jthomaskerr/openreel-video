# Plan: Timeline left-trim anchoring and trim-edge snapping

## Outcome

Dragging the left trim handle changes `startTime`, `inPoint`, and `duration` atomically while preserving the original right timeline edge. Dragging either trim handle uses the enabled clip-edge, playhead, and grid snap targets at the configured pixel threshold, and the rendered edge, persisted clip state, and snap indicator always agree.

Canonical contracts:

- [Timeline left trim and snapping regression](../../spec/regressions/timeline-left-trim-and-snapping-regression.md)
- [Timeline, section 2.3](../../spec/timeline.md#23-time-conversion)

## Current state (audited 2026-07-16 AEST)

| Area | Current evidence | Required change |
|---|---|---|
| Trim interaction | `ClipComponent.tsx:95-101` captures `startTime`, `duration`, `inPoint`, and `outPoint`; its mousemove effect at `:628-668` derives deltas from that snapshot. | Keep immutable-snapshot behavior, add the original right edge and available source bound explicitly, and resolve a candidate timeline edge rather than a source-only value. |
| Left trim mutation | `Timeline.tsx:815-855` treats the callback value as a new `inPoint`, changes `inPoint` and `duration`, and intentionally leaves `startTime` fixed. | Replace this path with one atomic update containing `startTime`, `inPoint`, `outPoint`, `duration`, and exit-relative keyframes. |
| Movement snapping | `timeline/utils.ts:11-112` implements clip/playhead/grid targets, clip self-exclusion, target priority, and `snapThreshold / pixelsPerSecond`. | Preserve movement behavior and expose an edge-only resolver which never evaluates the opposite edge. |
| Snap UI | `Timeline.tsx:695-701` owns `snapIndicatorTime`; `:1378-1385` renders it. `ClipComponent` already receives `onSnapIndicator`. | Drive it from the exact trim snap result and clear it on unsnap, mouseup, cancellation, and unmount. |
| Automated coverage | `ClipComponent.test.tsx` exists, but contains no trim tests. No unit test currently imports `calculateSnap`. `apps/web/e2e` contains only `project-identity.spec.ts`. | Add pure calculation tests, snap tests, interaction/state tests, and one Playwright regression. |

The worktree was dirty during this audit, including edits to `Timeline.tsx` and Timeline tests. Those changes are user-owned. The implementation coordinator must start from a clean integration commit containing those edits or rebase every worktree onto the commit that contains them. No agent may overwrite or discard them.

## Fixed implementation contracts

These contracts exist to let GPT-5.4-mini agents work independently without inventing incompatible callback shapes.

### Trim calculation boundary

Create `apps/web/src/components/editor/timeline/trim-calculation.ts` with pure exported types and functions:

```ts
export const MIN_CLIP_DURATION_SECONDS = 0.1;

export interface ClipTrimSnapshot {
  clipId: string;
  startTime: number;
  duration: number;
  inPoint: number;
  outPoint: number;
  sourceDuration: number;
  keyframes: Keyframe[];
}

export interface ClipTrimUpdate {
  edge: "left" | "right";
  edgeTime: number;
  startTime: number;
  duration: number;
  inPoint: number;
  outPoint: number;
  keyframes: Keyframe[];
}

export function calculateClipTrim(
  snapshot: ClipTrimSnapshot,
  edge: "left" | "right",
  candidateEdgeTime: number,
  minimumDuration?: number,
): ClipTrimUpdate;
```

Rules:

- Reject or safely normalize non-finite input. No returned timing field may be negative or non-finite.
- Left edge: clamp one effective delta, then derive every field from the immutable snapshot. Preserve `snapshot.startTime + snapshot.duration` exactly within floating-point tolerance.
- Right edge: keep `startTime` and `inPoint` fixed, change `duration` and `outPoint` together, and clamp to `sourceDuration` and minimum duration.
- Treat `sourceDuration` as the authoritative upper source boundary. `ClipComponent` obtains it from the referenced media item when finite; when metadata is unavailable, use `Math.max(snapshot.outPoint, snapshot.inPoint + snapshot.duration)` so unknown media never permits speculative extension.
- Recalculate exit-relative keyframes from the same new duration. Do not mutate the snapshot or keyframe array.

### Edge snapping boundary

Add to `apps/web/src/components/editor/timeline/utils.ts`:

```ts
export function calculateEdgeSnap(
  rawEdgeTime: number,
  clipId: string,
  tracks: Track[],
  playheadPosition: number,
  snapSettings: SnapSettings,
  pixelsPerSecond: number,
): SnapResult;
```

`calculateEdgeSnap` evaluates only `rawEdgeTime`. It uses the same candidate builder and priority table as `calculateSnap`, excludes `clipId`, honors each enablement flag, and converts the pixel threshold using current zoom. Refactor shared internals if useful, but keep existing `calculateSnap` behavior and call sites backward compatible.

### Interaction callback boundary

Change `onTrimClip` throughout `ClipComponentProps` and `TrackLaneProps` to:

```ts
onTrimClip?: (clipId: string, update: ClipTrimUpdate) => void;
```

`ClipComponent` is responsible for pointer-to-timeline conversion, edge snapping, and pure trim calculation. `Timeline` is responsible only for committing the supplied complete update to the latest matching clip in one `useProjectStore.setState` transition. Both preview geometry and commit therefore consume the same `ClipTrimUpdate.edgeTime`.

## Parallel execution model

Use one clean integration branch and isolated worktrees. Each agent must run Serena preflight in its own session, inspect only its owned files, add deterministic tests before implementation, commit without `--no-verify`, and report its commit SHA plus exact test output. Agents must not stage files outside their ownership list.

```text
Wave 1 (parallel)                 Wave 2 (parallel after Wave 1 merges)       Wave 3

WP1 trim calculation ------+----> WP3 component interaction ---------+
                            |                                        |
WP2 edge snap utility ------+----> WP4 atomic Timeline commit --------+----> WP5 browser regression
                                                                     |
                                                                     +----> WP6 final audit
```

WP1 and WP2 are fully independent. After both commits are merged into the integration branch, create fresh WP3 and WP4 worktrees from that merge commit. WP3 and WP4 have disjoint file ownership and can run concurrently. Merge both before WP5. WP6 is the coordinator's final verification and review, not a speculative fix pass.

## WP0: Coordinator baseline and task dispatch

Owner: primary/coordinator agent.

1. Run the required Serena and Hindsight preflight.
2. Record `rtk git status --short` and preserve all pre-existing changes.
3. Ensure the current user-owned Timeline work is committed or otherwise present on the integration base. Do not create implementation worktrees from stale `main`; the graph audit warned that the current feature branch was being served from `main`.
4. Create one worktree/branch per work package from the correct integration SHA.
5. Give every mini-agent the canonical spec, this plan, its ownership list, fixed contracts above, and the instruction to stop if repository evidence contradicts a fixed contract.

Gate: all worktrees report the same intended merge-base SHA and are clean before agent edits.

## WP1: Pure trim calculation and invariant tests

Owner: mini-agent A.

Owned files only:

- New `apps/web/src/components/editor/timeline/trim-calculation.ts`
- New `apps/web/src/components/editor/timeline/trim-calculation.test.ts`

Tasks:

1. Write failing table-driven tests for the eight deterministic behaviors relevant to pure math: inward left trim, outward left extension, timeline-zero clamp, source-zero clamp, minimum duration, right-edge trim, right source-bound clamp, and non-finite input.
2. Assert the right-edge invariant for every left-edge case:

   ```ts
   expect(update.startTime + update.duration)
     .toBeCloseTo(snapshot.startTime + snapshot.duration);
   ```

3. Add an immutability test and exit-relative keyframe tests for both shortening and extension. Ordinary keyframes remain unchanged; `kf-exit-*` keyframes preserve their offset from the clip exit.
4. Implement `calculateClipTrim` against the fixed contract. Use a single clamped effective edge/delta, never independent per-field clamps.
5. Run:

   ```bash
   rtk pnpm --filter @openreel/web test:run -- src/components/editor/timeline/trim-calculation.test.ts
   rtk pnpm --filter @openreel/web typecheck
   ```

Acceptance evidence: all cases pass deterministically; returned values are finite; snapshot/keyframes are unchanged; no React or store dependency exists in the new module.

Commit: `fix(web): add invariant-safe clip trim calculation`

## WP2: Edge-only snap resolver and tests

Owner: mini-agent B.

Owned files only:

- `apps/web/src/components/editor/timeline/utils.ts`
- New `apps/web/src/components/editor/timeline/utils.test.ts`

Tasks:

1. Characterize existing `calculateSnap` in tests before refactoring so ordinary movement behavior cannot silently change.
2. Extract shared snap-point construction and target-priority selection as private helpers.
3. Implement `calculateEdgeSnap` exactly as specified. It must not accept or inspect clip duration, so it cannot snap a fixed opposite edge accidentally.
4. Add tests for clip starts, clip ends, playhead, and grid; independent target disablement; clip-over-playhead-over-grid priority; nearest target within equal priority; exact-threshold behavior; multiple `pixelsPerSecond` values; snapping disabled; and exclusion of both edges of the trimmed clip.
5. Verify `SnapResult.snapPoint.time` is the same exact value as returned `time` for edge snapping.
6. Run:

   ```bash
   rtk pnpm --filter @openreel/web test:run -- src/components/editor/timeline/utils.test.ts
   rtk pnpm --filter @openreel/web typecheck
   ```

Acceptance evidence: existing movement tests remain green; edge tests demonstrate pixel threshold conversion and priority explicitly; no component or store file changes.

Commit: `feat(web): add edge-only timeline snap resolution`

## Wave 1 merge gate

Owner: coordinator.

1. Review WP1 and WP2 against the fixed contracts, then cherry-pick both commits onto the integration branch.
2. Run both focused suites together and `typecheck`.
3. Do not resolve failures by weakening assertions. Return a failing package to its owner with the exact counterexample.
4. Create fresh WP3 and WP4 worktrees from the successful merge commit.

## WP3: Trim pointer interaction, preview, and indicator lifecycle

Owner: mini-agent C.

Owned files only:

- `apps/web/src/components/editor/timeline/ClipComponent.tsx`
- `apps/web/src/components/editor/timeline/ClipComponent.test.tsx`
- `apps/web/src/components/editor/timeline/TrackLane.tsx`

Tasks:

1. Update the callback types to accept `ClipTrimUpdate`.
2. Extend the mousedown snapshot with `sourceDuration`, original right edge, and the immutable values required by `calculateClipTrim`. Do not read subsequently mutated clip timing during mousemove.
3. Convert each mousemove `clientX` to the dragged timeline edge using the live timeline bounding rect, current horizontal `scrollLeft`, timeline origin, and current `pixelsPerSecond`. Derive the raw edge from the original snapshot plus pointer movement if that is equivalent under scrolling; tests must prove scrolling and zoom cases.
4. Call `calculateEdgeSnap` with the original clip id and snapshot tracks/settings, then pass the resolved edge time into `calculateClipTrim`.
5. Send one complete update through `onTrimClip`. Call `onSnapIndicator(snapPoint.time)` only when snapped; call `onSnapIndicator(null)` immediately when unsnapped.
6. Clear the indicator and cursor on mouseup, Escape cancellation, effect cleanup, and component unmount. Escape must not emit a new update after cancellation.
7. Add stable `data-testid="clip-trim-left-${clip.id}"` and `data-testid="clip-trim-right-${clip.id}"` hooks for Playwright. Do not encode styling in selectors.
8. Add interaction tests proving:
   - repeated mousemoves are derived from the mousedown snapshot rather than the last callback result;
   - preview/callback uses the exact snapped edge time;
   - left and right edges invoke edge-only snapping;
   - zoom and existing horizontal scroll produce correct edge times;
   - self targets are excluded through the resolver;
   - the indicator appears, changes, clears when leaving threshold, and clears on mouseup/Escape/unmount.
9. Run:

   ```bash
   rtk pnpm --filter @openreel/web test:run -- src/components/editor/timeline/ClipComponent.test.tsx
   rtk pnpm --filter @openreel/web typecheck
   ```

Acceptance evidence: callback payloads match WP1 results exactly; no state mutation occurs in `ClipComponent`; no edits to `Timeline.tsx`.

Commit: `fix(web): snap trim handles from immutable interaction state`

## WP4: Atomic Timeline commit and state regression tests

Owner: mini-agent D.

Owned files only:

- `apps/web/src/components/editor/Timeline.tsx`
- New `apps/web/src/components/editor/Timeline.trim.test.tsx`

Tasks:

1. Change `handleTrimClip` to accept the complete `ClipTrimUpdate` created by WP3's fixed callback contract.
2. In one `useProjectStore.setState` functional transition, locate the latest clip by id and replace `startTime`, `duration`, `inPoint`, `outPoint`, and `keyframes` together. Update `modifiedAt` in that same transition.
3. Do not recompute duration, edge time, clamps, snapping, or keyframes inside `Timeline`. The supplied update is the single source of truth. Reject a payload containing non-finite or negative timing rather than partially committing it.
4. Preserve all unrelated clip, track, timeline, and project fields. Keep right-trim placement semantics through the values produced by WP1.
5. Add state-focused tests which subscribe to the store and assert every observed post-action state is valid. Cover the `10/8/2/10 -> 13/5/5/10` scenario, the subsequent outward trim back to timeline 11, exit keyframes, right trim, invalid-payload rejection, and preservation of unrelated state.
6. Run:

   ```bash
   rtk pnpm --filter @openreel/web test:run -- src/components/editor/Timeline.trim.test.tsx
   rtk pnpm --filter @openreel/web typecheck
   ```

Acceptance evidence: exactly one store notification is observed per trim update; no subscriber sees a mixed old/new timing tuple; the left right-edge invariant and right left-edge invariant both hold.

Commit: `fix(web): commit clip trim timing atomically`

## Wave 2 merge gate

Owner: coordinator.

1. Merge WP3 and WP4. Their file ownership must produce no textual conflict.
2. Resolve only callback-type integration errors. Any behavioral conflict goes back to the owning agent.
3. Run:

   ```bash
   rtk pnpm --filter @openreel/web test:run -- \
     src/components/editor/timeline/trim-calculation.test.ts \
     src/components/editor/timeline/utils.test.ts \
     src/components/editor/timeline/ClipComponent.test.tsx \
     src/components/editor/Timeline.trim.test.tsx
   rtk pnpm --filter @openreel/web typecheck
   ```

4. Inspect the combined diff for duplicated snap or trim math in React components. Shared deterministic logic belongs only in WP1/WP2 modules.

## WP5: Browser regression at real zoom and scroll

Owner: mini-agent E after Wave 2 is merged.

Owned files only:

- New `apps/web/e2e/timeline-trim-snapping.spec.ts`
- Test-only fixture/helper files under `apps/web/e2e/` if required

Do not modify production components. If a required accessible selector or test hook is missing, report it to the coordinator for a small amendment in the owning WP3 file.

Tasks:

1. Start the orchestrator and web app using the repository browser workflow, load a known project id from the URL, and create or load a deterministic timeline fixture with two clips.
2. Test snapping off:
   - clip A starts at 10 seconds with duration 8, `inPoint` 2, and `outPoint` 10;
   - drag its left handle to 13 seconds;
   - assert rendered left edge is 13, rendered right edge remains 18, and persisted clip timing is `13/5/5`;
   - begin a new drag to 11 seconds and assert `11/7/3` with right edge still 18.
3. Test snapping on for clip edge, playhead, and grid independently. At two zoom levels and after non-zero horizontal scrolling, position the pointer just inside and just outside the configured pixel threshold. Assert the dragged edge and snap indicator use the exact enabled target only inside the threshold.
4. Test the right handle against the same target types and assert `startTime` and `inPoint` do not change.
5. Assert the indicator clears after leaving threshold, mouseup, and Escape. Assert the clip does not snap to its own opposite edge.
6. Capture a screenshot and browser console output on failure through Playwright artifacts. No paid or probabilistic eval is required because behavior is deterministic and contains no LLM call.
7. Run:

   ```bash
   rtk pnpm --filter @openreel/web test:e2e -- e2e/timeline-trim-snapping.spec.ts
   ```

Acceptance evidence: the exact interaction passes in Chromium against the rendered app, not only jsdom; the URL keeps the intended project id; there are no new console errors.

Commit: `test(web): cover timeline trim snapping in browser`

## WP6: Final audit, verification, and delivery

Owner: coordinator.

1. Use Serena references to confirm every `onTrimClip` caller and implementation uses `ClipTrimUpdate` and that no legacy left-trim path remains.
2. Use the graph/Serena impact tools to identify affected tests. Run the focused suites, the complete web unit suite, lint, typecheck, build, and the focused browser test:

   ```bash
   rtk pnpm --filter @openreel/web test:run
   rtk pnpm --filter @openreel/web lint
   rtk pnpm --filter @openreel/web typecheck
   rtk pnpm --filter @openreel/web build
   rtk pnpm --filter @openreel/web test:e2e -- e2e/timeline-trim-snapping.spec.ts
   ```

3. Review important failure modes explicitly:
   - no cumulative pointer drift;
   - no left trim with fixed `startTime`;
   - no snap calculation against the fixed edge;
   - no raw/snapped preview-versus-commit split;
   - no self-snap;
   - no seconds-constant threshold;
   - no independent clamps which break invariants;
   - no stale indicator after termination;
   - no speculative extension beyond unknown source duration.
4. Check `rtk git diff --check` and `rtk git status --short`. Stage only plan-scoped files.
5. Commit any coordinator-only integration amendment separately, then push all coherent commits. Never bypass hooks.
6. Update the regression spec status only after every deterministic and browser gate passes. If any required gate cannot run, deliver `DONE_WITH_CONCERNS` or `BLOCKED`, not `DONE`.

## Required evidence matrix

| Claim | Evidence |
|---|---|
| Left trim preserves retained material's timeline position | WP1 invariant table plus WP4 state tests plus WP5 rendered 10→13→11 scenario |
| Clamps cannot create invalid mixed timing | WP1 boundary/non-finite tests and WP4 single-notification state subscription |
| Snapping respects targets, priority, zoom, and self-exclusion | WP2 pure tests and WP5 inside/outside threshold cases |
| Preview and persisted state use one snapped edge | WP3 callback/indicator test and WP5 rendered/persisted assertions |
| Right trim remains compatible | WP1/WP4 right-edge tests and WP5 right-handle scenario |
| Indicator lifecycle is correct | WP3 mouseup/Escape/unmount tests and WP5 rendered checks |

## Commit order

1. `fix(web): add invariant-safe clip trim calculation`
2. `feat(web): add edge-only timeline snap resolution`
3. `fix(web): snap trim handles from immutable interaction state`
4. `fix(web): commit clip trim timing atomically`
5. `test(web): cover timeline trim snapping in browser`
6. Optional coordinator-only `docs: close timeline trim snapping regression` after all gates pass

## Restart and reload

No production restart or migration is required. Browser verification requires restarting the local Vite dev server if it was already running with stale modules, then reloading the editor URL that contains the deterministic project id.
