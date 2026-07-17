# WebKit Background Export Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep supported WebKit exports running near foreground speed when the editor is backgrounded, and replace the misleading preflight promise with measured live throughput and remaining time.

**Architecture:** Extract the per-frame loop and throughput accounting into deterministic core utilities, then make `ExportEngine` delegate scheduling, progress, encoder policy, and sanitized diagnostics to those utilities. Propagate the richer progress contract through the UI store into a focused overlay component. Retain browser-selected encoding through one shared `no-preference` policy and validate the result with a generated, private-media-free WebKit fixture.

**Tech Stack:** TypeScript, Vitest, React, Zustand, MediaBunny 1.25.3, WebCodecs, Playwright WebKit 26.5.

## Global Constraints

- Work in `/Volumes/Joseph/Projects1/ai-agents/openreel-video`; preserve unrelated dirty project-save changes.
- The per-frame export loop must not install or await wall-clock timers.
- Background throughput after warmup must be at least 50% of foreground throughput in the WebKit gate.
- Preflight estimates are `rough`; only real end-to-end export samples become `observed`.
- A background warning requires an established foreground baseline, at least 15 seconds hidden, at least 30 hidden frames, and throughput below 50% of the foreground rate.
- GPU utilization is diagnostic only; throughput is the acceptance criterion.
- Export diagnostics must not contain media bytes, filesystem paths, signed URLs, credentials, or project payloads.
- All deterministic gate tests must be local, non-flaky, and under two seconds per focused file.
- Do not move export into a worker unless the completed WebKit gate remains below 50% after the timer repair.

---

## File Structure

- Create `packages/core/src/export/export-frame-loop.ts`: timer-free frame orchestration and cancellation/cleanup cadence.
- Create `packages/core/src/export/export-performance.ts`: EWMA throughput, scene-change reset, ETA, visibility baselines, and degradation state.
- Create `packages/core/src/export/encoder-policy.ts`: the single requested acceleration policy.
- Create `packages/core/src/export/export-diagnostics.ts`: typed, sanitized diagnostic events and sink.
- Modify `packages/core/src/export/export-engine.ts`: delegate frame work, progress, policy, and diagnostics.
- Modify `packages/core/src/export/types.ts`: expose observed performance in `ExportProgress`.
- Modify `packages/core/src/device/device-capabilities.ts`: probe the shared requested policy while retaining separate hardware capability metadata.
- Modify `packages/core/src/device/export-estimator.ts`: account for source video, cap unsupported optimism, return a rough range, and reuse the shared policy in the benchmark.
- Modify `packages/core/src/device/index.ts` and `packages/core/src/index.ts`: export the new public estimate/progress types used by the web app.
- Create `apps/web/src/components/editor/ExportProgressOverlay.tsx`: focused accessible progress, ETA, fps, and degradation UI.
- Modify `apps/web/src/stores/ui-store.ts`, `apps/web/src/components/editor/Toolbar.tsx`, `apps/web/src/components/editor/Preview.tsx`, and `apps/web/src/components/editor/ExportDialog.tsx`: propagate and render the new contracts.
- Create `apps/web/playwright.webkit-export.config.ts` and `apps/web/e2e/export-background-webkit.spec.ts`: isolated WebKit performance gate using generated media.

---

### Task 1: Timer-Free Frame Loop

**Files:**
- Create: `packages/core/src/export/export-frame-loop.ts`
- Create: `packages/core/src/export/export-frame-loop.test.ts`

**Interfaces:**
- Consumes: `AbortSignal`, total frame count, async render/encode callback, cleanup callback, progress callback.
- Produces:

```ts
export interface ExportFrameLoopOptions {
  totalFrames: number;
  signal: AbortSignal;
  renderAndEncode(frame: number): Promise<void>;
  cleanup(frame: number): void | Promise<void>;
  onFrameComplete(frame: number): void | Promise<void>;
  createCancelledError(): Error;
  cleanupEvery?: number;
}

export async function runExportFrameLoop(options: ExportFrameLoopOptions): Promise<void>;
```

- [ ] **Step 1: Write the failing timer-clamp, cadence, and cancellation tests**

```ts
it("completes without installing a timer under a simulated background clamp", async () => {
  vi.useFakeTimers();
  const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
  const rendered: number[] = [];
  await runExportFrameLoop({
    totalFrames: 12,
    signal: new AbortController().signal,
    renderAndEncode: async (frame) => { rendered.push(frame); },
    cleanup: vi.fn(),
    onFrameComplete: vi.fn(),
    createCancelledError: () => new Error("cancelled"),
  });
  expect(rendered).toEqual([...Array(12).keys()]);
  expect(timeoutSpy).not.toHaveBeenCalled();
});

it("cleans every five completed frames", async () => {
  const cleanup = vi.fn();
  await runExportFrameLoop(makeOptions({ totalFrames: 11, cleanup }));
  expect(cleanup.mock.calls.map(([frame]) => frame)).toEqual([4, 9]);
});

it("checks cancellation before each frame", async () => {
  const controller = new AbortController();
  await expect(runExportFrameLoop(makeOptions({
    totalFrames: 3,
    signal: controller.signal,
    renderAndEncode: async (frame) => { if (frame === 0) controller.abort(); },
  }))).rejects.toThrow("cancelled");
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `rtk pnpm --filter @openreel/core exec vitest run src/export/export-frame-loop.test.ts`

Expected: FAIL because `export-frame-loop.ts` does not exist.

- [ ] **Step 3: Implement the minimal timer-free loop**

```ts
export async function runExportFrameLoop({
  totalFrames,
  signal,
  renderAndEncode,
  cleanup,
  onFrameComplete,
  createCancelledError,
  cleanupEvery = 5,
}: ExportFrameLoopOptions): Promise<void> {
  for (let frame = 0; frame < totalFrames; frame += 1) {
    if (signal.aborted) throw createCancelledError();
    await renderAndEncode(frame);
    await onFrameComplete(frame);
    if ((frame + 1) % cleanupEvery === 0) await cleanup(frame);
  }
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `rtk pnpm --filter @openreel/core exec vitest run src/export/export-frame-loop.test.ts`

Expected: 3 tests pass with no fake-timer advancement.

- [ ] **Step 5: Commit**

```bash
rtk git add packages/core/src/export/export-frame-loop.ts packages/core/src/export/export-frame-loop.test.ts
rtk git commit -m "fix(core): remove timer dependency from export frame loop"
```

---

### Task 2: Observed Throughput and Background Degradation

**Files:**
- Create: `packages/core/src/export/export-performance.ts`
- Create: `packages/core/src/export/export-performance.test.ts`

**Interfaces:**
- Consumes: monotonically increasing completion timestamps and `visible | hidden | unknown` visibility samples.
- Produces:

```ts
export type ExportVisibility = "visible" | "hidden" | "unknown";
export type ExportEstimateConfidence = "warming-up" | "observed";

export interface ExportPerformanceSnapshot {
  framesPerSecond: number;
  elapsedRenderingTime: number;
  estimatedTimeRemaining: number;
  estimateConfidence: ExportEstimateConfidence;
  visibility: ExportVisibility;
  backgroundThroughputRatio: number | null;
  backgroundDegraded: boolean;
}

export class ExportPerformanceTracker {
  constructor(totalFrames: number, startedAtMs: number);
  recordCompletedFrame(frame: number, completedAtMs: number, visibility: ExportVisibility): ExportPerformanceSnapshot;
}
```

- [ ] **Step 1: Write failing deterministic convergence tests**

Cover these exact cases in `export-performance.test.ts`:

```ts
it("converges on stable 40 fps samples", () => {
  const tracker = new ExportPerformanceTracker(300, 0);
  let sample!: ExportPerformanceSnapshot;
  for (let frame = 0; frame < 30; frame += 1) {
    sample = tracker.recordCompletedFrame(frame, (frame + 1) * 25, "visible");
  }
  expect(sample.framesPerSecond).toBeCloseTo(40, 1);
  expect(sample.estimatedTimeRemaining).toBeCloseTo(6.75, 1);
  expect(sample.estimateConfidence).toBe("observed");
});

it("does not let one 1 second outlier replace the rolling rate", () => {
  // Feed 35 × 25 ms, one × 1000 ms, then 10 × 25 ms.
  expect(sample.framesPerSecond).toBeGreaterThan(25);
});

it("resets confidence after five sustained 2x scene-cost samples", () => {
  // Establish 25 ms, then feed five 60 ms frames.
  expect(sample.estimateConfidence).toBe("warming-up");
});

it("warns only after a real foreground baseline and sustained hidden degradation", () => {
  // Establish 40 fps visible, then 30 hidden frames over >=15 s at <20 fps.
  expect(sample.backgroundThroughputRatio).toBeLessThan(0.5);
  expect(sample.backgroundDegraded).toBe(true);
});

it("ignores short background dips and clears after 30 recovered frames", () => {
  // Establish 40 fps visible, feed a short hidden dip, then sustained degradation.
  expect(shortDip.backgroundDegraded).toBe(false);
  // Feed 30 frames at or above 50% of the foreground baseline.
  expect(recovered.backgroundDegraded).toBe(false);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `rtk pnpm --filter @openreel/core exec vitest run src/export/export-performance.test.ts`

Expected: FAIL because the tracker does not exist.

- [ ] **Step 3: Implement bounded EWMA and explicit thresholds**

Use these named constants so tests and runtime policy share exact thresholds:

```ts
const EWMA_ALPHA = 0.2;
const SAMPLE_CLAMP = { min: 0.25, max: 4 } as const;
const COMPLEXITY_CHANGE = { min: 0.5, max: 2, samples: 5 } as const;
const WARMUP_MAX_MS = 30_000;
const BACKGROUND_MIN_MS = 15_000;
const BACKGROUND_MIN_FRAMES = 30;
const BACKGROUND_MIN_RATIO = 0.5;
const RECOVERY_MIN_FRAMES = 30;
```

For each positive frame delta, clamp it relative to the current EWMA, then update `secondsPerFrame = alpha * sample + (1 - alpha) * previous`. Reset the warmup origin after five consecutive raw samples outside `0.5×..2×` the EWMA. Confidence becomes `observed` when frames since the origin reach `Math.ceil(totalFrames * 0.1)` or rendering time since the origin reaches 30 seconds. Calculate ETA only from this end-to-end EWMA. Maintain separate visible and hidden EWMAs; degrade only after an established visible baseline plus both hidden thresholds, and clear after 30 consecutive samples at or above the 50% baseline.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `rtk pnpm --filter @openreel/core exec vitest run src/export/export-performance.test.ts`

Expected: all convergence, reset, visibility, and recovery tests pass under 100 ms.

- [ ] **Step 5: Commit**

```bash
rtk git add packages/core/src/export/export-performance.ts packages/core/src/export/export-performance.test.ts
rtk git commit -m "feat(core): measure live export throughput"
```

---

### Task 3: Shared Encoder Policy and Honest Preflight Range

**Files:**
- Create: `packages/core/src/export/encoder-policy.ts`
- Modify: `packages/core/src/device/device-capabilities.ts:165-223`
- Modify: `packages/core/src/device/export-estimator.ts:1-360`
- Modify: `packages/core/src/device/export-estimator.test.ts`
- Modify: `packages/core/src/device/device-capabilities.test.ts`
- Modify: `packages/core/src/device/index.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**

```ts
export const EXPORT_HARDWARE_ACCELERATION = "no-preference" as const;

export interface TimeEstimate {
  seconds: number;
  formatted: string;
  confidence: "rough";
  range: { minSeconds: number; maxSeconds: number };
  breakdown?: { rendering: number; encoding: number; muxing: number };
}

export interface ExportEstimateSettings {
  // Existing width, height, frameRate, duration, codec, effects,
  // transitions, and trackCount fields remain.
  hasSourceVideo: boolean;
}
```

- [ ] **Step 1: Add failing policy and estimate tests**

Assert that capability probing calls `VideoEncoder.isConfigSupported` with `no-preference`, `runBenchmark` configures `VideoEncoder` with the same constant, and a stored encoder-only benchmark still returns `confidence: "rough"`. Verify source video, visual tracks, transitions, and effects each make the estimate no faster. For a 180-second, 854×480, 30 fps H.264 export with an unrealistically fast benchmark, assert the midpoint is capped at no faster than 2× real time and the range contains 180 seconds.

```ts
expect(estimate.seconds).toBeGreaterThanOrEqual(90);
expect(estimate.range.minSeconds).toBeLessThanOrEqual(estimate.seconds);
expect(estimate.range.maxSeconds).toBeGreaterThanOrEqual(180);
expect(estimate.confidence).toBe("rough");
```

- [ ] **Step 2: Run tests and verify RED**

Run: `rtk pnpm --filter @openreel/core exec vitest run src/device/export-estimator.test.ts src/device/device-capabilities.test.ts`

Expected: failures show the current `prefer-hardware`, `measured`, and unbounded low-resolution extrapolation.

- [ ] **Step 3: Implement the shared policy and bounded range**

Import `EXPORT_HARDWARE_ACCELERATION` in the capability probe and benchmark. Preserve a separate `prefer-hardware` probe only for the informational `hardware` boolean. Calculate the rough midpoint with:

```ts
const effectiveFps = Math.min(adjustedFps, settings.frameRate * 2);
const seconds = totalFrames / Math.max(1, effectiveFps);
const range = {
  minSeconds: seconds * 0.75,
  maxSeconds: seconds * 2,
};
```

Add `hasSourceVideo?: boolean` to the existing `ExportEstimateSettings`. Apply source-video, project-effects, transitions, and `trackCount` multipliers to the benchmark-derived fps before the cap. Export the updated `TimeEstimate` contract through both index files.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `rtk pnpm --filter @openreel/core exec vitest run src/device/export-estimator.test.ts src/device/device-capabilities.test.ts`

Expected: the new assertions and all existing device tests pass.

- [ ] **Step 5: Commit**

```bash
rtk git add packages/core/src/export/encoder-policy.ts packages/core/src/device packages/core/src/index.ts
rtk git commit -m "fix(core): align export policy and preflight estimates"
```

---

### Task 4: ExportEngine Integration and Sanitized Diagnostics

**Files:**
- Create: `packages/core/src/export/export-diagnostics.ts`
- Create: `packages/core/src/export/export-diagnostics.test.ts`
- Modify: `packages/core/src/export/types.ts:53-65`
- Modify: `packages/core/src/export/export-engine.ts:33-38,269-479,1303-1326`
- Modify: `packages/core/src/export/export-engine.test.ts`

**Interfaces:**

```ts
export interface ExportProgress {
  // existing fields remain
  readonly framesPerSecond: number;
  readonly elapsedRenderingTime: number;
  readonly estimateConfidence: "warming-up" | "observed";
  readonly visibility: "visible" | "hidden" | "unknown";
  readonly backgroundThroughputRatio: number | null;
  readonly backgroundDegraded: boolean;
}

export type ExportDiagnosticEvent =
  | { event: "export-start"; browser: string; codec: string; width: number; height: number; frameRate: number; totalFrames: number; requestedAcceleration: "no-preference" }
  | { event: "encoder-config"; codec: string; width: number; height: number; frameRate: number; bitrate: number; requestedAcceleration: "no-preference"; effectiveAcceleration: string | null }
  | { event: "export-preparation"; audioMs: number; decodersMs: number }
  | { event: "decoder-fallback"; assetId: string; operation: string; fallback: string }
  | { event: "export-performance"; frame: number; decodeRenderMs: number; encodeWriteMs: number; cleanupCount: number; cleanupMs: number; framesPerSecond: number; visibility: string }
  | { event: "export-finished"; phase: "cancelled" | "finalized"; elapsedMs: number }
  | { event: "export-error"; phase: string; code: string; message: string };

export type ExportDiagnosticSink = (event: ExportDiagnosticEvent) => void;

export interface ExportEngineRuntime {
  now(): number;
  visibility(): "visible" | "hidden" | "unknown";
  diagnostics: ExportDiagnosticSink;
}

export class ExportEngine {
  constructor(runtime?: Partial<ExportEngineRuntime>);
}
```

- [ ] **Step 1: Extend the MediaBunny mock to capture source config and write failing engine tests**

Change `MockVideoSampleSource` to store its constructor config. Assert real export requests `no-preference`, does not call `setTimeout`, produces `observed` progress after warmup, checks cancellation, and still clears caches every five frames. Inject a deterministic clock and visibility reader into `ExportEngine` constructor options rather than patching globals.

- [ ] **Step 2: Add failing diagnostic-redaction tests**

Pass inputs containing `blob:`, `file:///`, query signatures, `authorization`, media bytes, and project payload fields to the diagnostic builder. Assert the output contains only the typed allowlisted keys above, permits only the opaque `assetId` on fallback events, and replaces unsafe error text with a normalized message/code pair.

- [ ] **Step 3: Run tests and verify RED**

Run: `rtk pnpm --filter @openreel/core exec vitest run src/export/export-engine.test.ts src/export/export-diagnostics.test.ts`

Expected: failures identify the timer, software preference, missing progress fields, and absent diagnostic allowlist.

- [ ] **Step 4: Wire the frame loop, tracker, policy, and diagnostics**

Create the tracker immediately before rendering begins, not before audio preparation. Delegate frames to `runExportFrameLoop`. Time audio preparation, decoder preparation, render/decode, `videoSource.add`, and cache cleanup separately with the injected monotonic clock. Feed `document.visibilityState` through a guarded reader returning `unknown` outside a document. Use MediaBunny `onEncoderConfig` to emit only allowlisted encoder fields. Replace empty cleanup and decoder-initialization catches with warning diagnostics containing the opaque asset id, stable operation name, and selected fallback. Emit explicit cancellation and finalization events.

- [ ] **Step 5: Run focused and affected core tests**

Run: `rtk pnpm --filter @openreel/core exec vitest run src/export/export-frame-loop.test.ts src/export/export-performance.test.ts src/export/export-diagnostics.test.ts src/export/export-engine.test.ts src/device/export-estimator.test.ts src/device/device-capabilities.test.ts`

Expected: all focused tests pass; no timer advancement is required.

- [ ] **Step 6: Commit**

```bash
rtk git add packages/core/src/export
rtk git commit -m "fix(core): make export progress timer independent"
```

---

### Task 5: Progress State and Accessible Overlay

**Files:**
- Create: `apps/web/src/components/editor/ExportProgressOverlay.tsx`
- Create: `apps/web/src/components/editor/ExportProgressOverlay.test.tsx`
- Modify: `apps/web/src/stores/ui-store.ts:207-216`
- Modify: `apps/web/src/components/editor/Toolbar.tsx:86-92,273-346`
- Modify: `apps/web/src/components/editor/Preview.tsx:6492-6530`

**Interfaces:**

```ts
export interface ExportUIState {
  isExporting: boolean;
  progress: number;
  phase: string;
  estimatedTimeRemaining: number | null;
  framesPerSecond: number | null;
  estimateConfidence: "warming-up" | "observed";
  backgroundDegraded: boolean;
}
```

- [ ] **Step 1: Write failing overlay tests**

```tsx
it("shows measurement state before observed throughput", () => {
  render(<ExportProgressOverlay state={warmingState} />);
  expect(screen.getByText("Measuring export speed…")).toBeVisible();
});

it("shows live remaining time and fps", () => {
  render(<ExportProgressOverlay state={{ ...observedState, estimatedTimeRemaining: 125, framesPerSecond: 28.4 }} />);
  expect(screen.getByText("About 2m 5s remaining")).toBeVisible();
  expect(screen.getByText("28.4 fps")).toBeVisible();
});

it("shows an actionable background warning", () => {
  render(<ExportProgressOverlay state={{ ...observedState, backgroundDegraded: true }} />);
  expect(screen.getByRole("alert")).toHaveTextContent("foregrounding the editor may speed it up");
});

it("clears the warning after sustained throughput recovery", () => {
  const { rerender } = render(<ExportProgressOverlay state={{ ...observedState, backgroundDegraded: true }} />);
  rerender(<ExportProgressOverlay state={{ ...observedState, backgroundDegraded: false }} />);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("replaces warming-up copy with observed generator progress", () => {
  const { rerender } = render(<ExportProgressOverlay state={warmingState} />);
  expect(screen.getByText("Measuring export speed…")).toBeVisible();
  rerender(<ExportProgressOverlay state={{
    ...observedState,
    estimatedTimeRemaining: 125,
    framesPerSecond: 28.4,
  }} />);
  expect(screen.queryByText("Measuring export speed…")).not.toBeInTheDocument();
  expect(screen.getByText("About 2m 5s remaining")).toBeVisible();
});
```

- [ ] **Step 2: Run the component test and verify RED**

Run: `rtk pnpm --filter @openreel/web exec vitest run src/components/editor/ExportProgressOverlay.test.tsx`

Expected: FAIL because the component and richer store state do not exist.

- [ ] **Step 3: Implement the component and state propagation**

Move the existing overlay markup out of `Preview.tsx`. Give the overlay `role="status"`, `aria-live="polite"`, an `aria-valuenow` progressbar, and a separate `role="alert"` only for sustained degradation. In `Toolbar.runExport`, copy all new `ExportProgress` fields into local and global state on each generator yield.

- [ ] **Step 4: Run component, Toolbar, Preview, and UI-store tests**

Run: `rtk pnpm --filter @openreel/web exec vitest run src/components/editor/ExportProgressOverlay.test.tsx src/components/editor/Toolbar.test.tsx src/stores/ui-store.test.ts`

Expected: all tests pass and existing toolbar/export controls remain intact.

- [ ] **Step 5: Commit**

```bash
rtk git add apps/web/src/components/editor/ExportProgressOverlay.tsx apps/web/src/components/editor/ExportProgressOverlay.test.tsx apps/web/src/components/editor/Toolbar.tsx apps/web/src/components/editor/Preview.tsx apps/web/src/stores/ui-store.ts
rtk git commit -m "feat(web): show observed export throughput"
```

---

### Task 6: Rough Estimate Copy and Project Complexity

**Files:**
- Modify: `apps/web/src/components/editor/ExportDialog.tsx:58-65,120-240,742-758`
- Create: `apps/web/src/components/editor/ExportDialog.test.tsx`
- Modify: `apps/web/src/components/editor/Toolbar.tsx:297-326,1045-1051`

**Interfaces:**
- `ExportDialogProps` gains `hasEffects`, `hasTransitions`, `hasSourceVideo`, and `activeVisualTrackCount`.
- The dialog receives a rough range and never renders a green measured check for an encoder-only benchmark.

- [ ] **Step 1: Write failing estimate-copy tests**

Render a 180-second 480p dialog with a fast stored benchmark and assert it displays `Rough estimate`, a range containing at least 90 seconds through 180 seconds, and explanatory copy: `Live remaining time appears after export starts.` Assert `Measured` and the green check icon are absent.

- [ ] **Step 2: Run the test and verify RED**

Run: `rtk pnpm --filter @openreel/web exec vitest run src/components/editor/ExportDialog.test.tsx`

Expected: FAIL because the current dialog displays one value and treats benchmark confidence as measured.

- [ ] **Step 3: Pass real project complexity and render the range**

In `Toolbar`, derive active visual-track count, source-video presence, any enabled clip effects, and any transitions from the current timeline once with `useMemo`. Pass those values to both toolbar preset estimates and `ExportDialog`. Format the range with the existing duration formatter and include a visually muted `Rough estimate` label.

- [ ] **Step 4: Run dialog and toolbar tests**

Run: `rtk pnpm --filter @openreel/web exec vitest run src/components/editor/ExportDialog.test.tsx src/components/editor/Toolbar.test.tsx`

Expected: all estimate and toolbar tests pass.

- [ ] **Step 5: Commit**

```bash
rtk git add apps/web/src/components/editor/ExportDialog.tsx apps/web/src/components/editor/ExportDialog.test.tsx apps/web/src/components/editor/Toolbar.tsx
rtk git commit -m "fix(web): label export estimates as rough"
```

---

### Task 7: WebKit Foreground/Background Gate

**Files:**
- Create: `apps/web/playwright.webkit-export.config.ts`
- Create: `apps/web/e2e/export-background-webkit.spec.ts`
- Create: `apps/web/e2e/helpers/generated-export-fixture.ts`

**Interfaces:**
- The helper generates a four-second 854×480 H.264 source in WebKit using MediaBunny and returns an in-memory project plus writable stream.
- The spec runs the same export in a foreground page and a background page and returns sanitized metrics only. The deterministic core regression test, not a page-global timer spy, proves the export loop installs no timers.

- [ ] **Step 1: Add the WebKit-only config**

```ts
export default defineConfig({
  testDir: "./e2e",
  testMatch: "export-background-webkit.spec.ts",
  timeout: 90_000,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:5174", browserName: "webkit", headless: true },
  webServer: {
    command: "pnpm exec vite --host 127.0.0.1 --port 5174",
    url: "http://127.0.0.1:5174",
    reuseExistingServer: true,
  },
});
```

- [ ] **Step 2: Implement the generated fixture and failing background test**

Generate colored canvas frames and a short tone; do not read Vintage Tokyo or commit binary media. Run foreground first to establish fps. Start the second export, call `foregroundPage.bringToFront()` so the export page becomes hidden, wait until the export reports a hidden visibility sample, and assert:

```ts
expect(background.visibilitySamples).toContain("hidden");
expect(background.success).toBe(true);
expect(background.framesPerSecond / foreground.framesPerSecond).toBeGreaterThanOrEqual(0.5);
expect(background.estimateConfidenceSamples).toContain("warming-up");
expect(background.estimateConfidenceSamples).toContain("observed");
expect(background.output.duration).toBeCloseTo(4, 1);
expect(background.output.width).toBe(854);
expect(background.output.height).toBe(480);
expect(background.output.frameRate).toBe(30);
expect(background.output.hasVideo).toBe(true);
expect(background.output.hasAudio).toBe(true);
```

- [ ] **Step 3: Run the gate against the pre-repair commit and verify RED**

Run: `rtk pnpm --filter @openreel/web exec playwright test --config=playwright.webkit-export.config.ts`

Expected: background throughput falls below 50% because WebKit clamps the current five-frame timer batch. Keep the deterministic core test as the direct proof that the repair removes the frame-loop timer.

- [ ] **Step 4: Run the gate against the implementation and verify GREEN**

Run the same command.

Expected: foreground and background exports complete, background/foreground ratio is at least 0.5, the export page records hidden visibility, progress advances from warming-up to observed, and the generated output metadata is correct.

- [ ] **Step 5: Commit**

```bash
rtk git add apps/web/playwright.webkit-export.config.ts apps/web/e2e/export-background-webkit.spec.ts apps/web/e2e/helpers/generated-export-fixture.ts
rtk git commit -m "test(web): gate WebKit background export throughput"
```

---

### Task 8: Full Verification and Delivery Evidence

**Files:**
- Modify only if evidence reveals a defect: files from Tasks 1-7.
- Record sanitized command output in the final handoff; do not commit generated videos, traces, or private project data.

- [ ] **Step 1: Run affected tests from the dependency graph**

Run `tokensave_affected` for the changed source files, then execute its focused recommendation. At minimum run:

```bash
rtk pnpm --filter @openreel/core exec vitest run src/export src/device
rtk pnpm --filter @openreel/web exec vitest run src/components/editor/ExportProgressOverlay.test.tsx src/components/editor/ExportDialog.test.tsx src/components/editor/Toolbar.test.tsx src/stores/ui-store.test.ts
```

Expected: all focused deterministic tests pass.

- [ ] **Step 2: Run type checking and linting**

```bash
rtk pnpm typecheck
rtk pnpm lint
```

Expected: exit 0 with no new diagnostics.

- [ ] **Step 3: Run WebKit browser gate**

Run: `rtk pnpm --filter @openreel/web exec playwright test --config=playwright.webkit-export.config.ts`

Expected: the 50% throughput, timer-free, output metadata, and completion assertions pass.

- [ ] **Step 4: Verify the real editor flow in WebKit**

Open `/#/editor?projectId=vintage-tokyo`, select 480p H.264, start export, record foreground throughput, background the editor for at least 30 frames and 15 seconds, then foreground it. In Web Inspector, confirm no timer event originates from the frame loop. Confirm the overlay changes from rough to observed ETA, progress remains active, no degradation warning appears when the ratio remains at least 0.5, cancellation remains responsive, and the final file plays with correct audio/video duration. If the ratio remains below 0.5, stop and evaluate the dedicated-worker escalation required by the spec.

- [ ] **Step 5: Run final diff and safety checks**

```bash
rtk git diff --check
rtk git status --short
```

Expected: no whitespace errors, no generated media/traces, and only intended source/test changes plus pre-existing unrelated dirty files.

- [ ] **Step 6: Commit any verification-only correction atomically**

Use one conventional commit per independently verified correction. Do not amend unrelated project-save work and do not bypass hooks.

---

## Completion Standard

The work is complete only when all deterministic tests, type checking, linting, the generated WebKit gate, and the real Vintage Tokyo foreground/background verification pass. Report exact commands, test counts, foreground/background fps and ratio, effective encoder configuration, output metadata, and any remaining browser-imposed limitation. No application restart is required beyond reloading the Vite page after implementation changes.
