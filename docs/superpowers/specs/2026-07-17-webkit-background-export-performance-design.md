# WebKit Background Export Performance Repair

## Outcome

A supported WebKit browser must continue exporting when the editor tab is not foregrounded without OpenReel's own scheduling reducing throughput to a timer-clamped rate.

For the 480p, H.264, 30 fps regression scenario:

- background export throughput after warmup must be at least 50% of foreground throughput on the same browser and project;
- export must not use wall-clock timers in the per-frame loop;
- progress must continue to update from completed frames;
- after either 10% progress or 30 seconds of rendering, the displayed remaining-time estimate must be derived from observed end-to-end frame throughput rather than a synthetic encoder benchmark;
- if browser-imposed background throttling still reduces observed throughput below 50% of the foreground baseline, the UI must report that explicitly and recommend foregrounding the tab. It must not silently retain an invalid estimate.

GPU utilization is not an acceptance criterion. WebKit may encode 480p H.264 faster with its software-preferred configuration than with its hardware-preferred configuration. The user-visible requirement is sustained end-to-end throughput with truthful status.

## Regression Evidence

The current export loop renders and encodes five frames, clears caches, then awaits `setTimeout(resolve, 2)`. WebKit may clamp that timer to approximately one second when the page is backgrounded or loses foreground priority. This limits export to approximately five frames per second while CPU and GPU remain mostly idle.

The Vintage Tokyo project is 246.07 seconds long. At 30 fps it contains approximately 7,382 output frames. A five-frame-per-second limit predicts 24.6 minutes total and 12.3 minutes to reach halfway, matching the reported behavior and the timer activity visible in Web Inspector.

A fresh WebKit 26.5 probe at 854x480 measured:

- synthetic H.264 encoding at approximately 335 to 535 fps;
- sequential MediaBunny source decode and canvas copying at approximately 30 to 36 fps;
- OpenReel `VideoEngine` rendering at approximately 36 fps;
- the combined OpenReel render and MediaBunny encode path at approximately 40 fps.

The foreground pipeline is therefore capable of approximately real-time or faster 480p export. The observed five-frame-per-second behavior is timer-bound, not encoder-bound.

The pre-export estimate is a separate defect. The benchmark measures generated frames through a foreground `VideoEncoder` configured with `prefer-hardware`, while real export performs source decoding, canvas copies, compositing, cache maintenance, file streaming, and a `VideoSampleSource` configured with `prefer-software`. Calling the benchmark result “measured” overstates what was measured and permits estimates such as 15 seconds for work that follows a materially different path.

## Design

### Export scheduling

Remove the `setTimeout(..., 2)` yield from the per-frame export loop. Do not replace it with another wall-clock timer.

The loop already crosses asynchronous backpressure boundaries through frame decoding, `VideoSampleSource.add`, stream writes, and the async generator progress yield. Those boundaries allow pending work to run without introducing a browser timer that can be clamped by page visibility policy.

Keep cancellation checks at least once per frame. Keep resource cleanup deterministic. Cache cleanup may remain frame-count based, but its cost must be measured separately from decode, render, encode, and stream-write time.

If browser verification later demonstrates unacceptable UI starvation, add a cooperative task yield behind a small scheduling abstraction. Any such implementation must have a WebKit test proving it is not visibility-timer throttled before adoption.

### Encoder policy consistency

Define one encoder-acceleration policy shared by capability detection, benchmarking, estimation metadata, and real export. The initial policy is `no-preference`, allowing the browser to select its fastest supported path.

Use MediaBunny's `onEncoderConfig` callback to record the effective `VideoEncoderConfig` for diagnostics. Logs must identify the codec, dimensions, frame rate, bitrate, and requested acceleration preference without logging project media or signed URLs.

Do not claim that an export uses hardware acceleration solely because `isConfigSupported` accepted `prefer-hardware`. Support checks indicate configuration acceptance, not the implementation or performance of the selected encoder.

### Initial estimate

The pre-export estimate remains a planning hint, not a measured promise. It must be labelled `rough` unless it comes from a previous completed export with the same browser family, codec, resolution bucket, frame-rate bucket, and comparable project complexity.

The synthetic encoder benchmark may remain as a capability diagnostic, but its result must not be presented as an end-to-end measured export time. Initial estimation must account for frame rate, active visual track count, transitions, effects, and source-video presence. It must return a range when confidence is rough.

### Adaptive remaining time

Collect end-to-end timing from the real export loop. Each completed frame contributes a sample covering decode, render, encode backpressure, and stream-write work.

Maintain a bounded exponentially weighted moving average of seconds per frame. Ignore the preparation and initial warmup interval, then calculate:

`remaining seconds = remaining frames × observed seconds per frame`

The estimate must resist single-frame spikes and must reset its confidence after a material scene-complexity change. The progress contract must expose observed frames per second, elapsed rendering time, estimated remaining seconds, and confidence. The export UI must distinguish the rough preflight estimate from the live observed estimate.

### Background degradation reporting

Track foreground and background throughput separately using page visibility as diagnostic context only. Visibility must not pause export.

When an established foreground baseline exists and background throughput remains below 50% of that rate for at least 15 seconds and at least 30 completed frames, show a persistent, actionable warning: the browser is limiting background export performance, and foregrounding the editor may speed it up. Clear the warning after sustained recovery. Do not infer browser throttling when no foreground baseline exists. This warning is defensive runtime feedback, not a substitute for removing OpenReel's timer dependency or meeting the browser performance gate.

### Instrumentation

Record structured, non-sensitive export diagnostics:

- browser family and version;
- requested and effective encoder configuration;
- output dimensions, frame rate, codec, and total frames;
- time spent preparing audio and decoders;
- rolling decode/render/encode-write milliseconds per frame;
- foreground/background visibility state and throughput;
- cache cleanup count and duration;
- cancellation, finalization, and error phase.

Diagnostics must never include media bytes, local filesystem paths, signed URLs, credentials, or full project payloads.

## Deterministic Regression Tests

Add focused tests that fail against the current implementation and complete locally in under two seconds:

1. Exporting multiple frames does not install or await a per-frame or per-batch timer. Run with fake timers configured to model a one-second background clamp and prove frame completion is independent of timer advancement.
2. Cancellation remains observable once per frame after the timer yield is removed.
3. Cache cleanup still runs at its documented frame-count cadence and cleanup failures are surfaced through structured diagnostics rather than silently ignored.
4. Capability probing, benchmarking, and real export request the same acceleration policy.
5. The preflight estimator labels an encoder-only benchmark as `rough`, not `measured` end-to-end evidence.
6. The adaptive estimator converges on a stable synthetic frame duration, resists one outlier, and recalculates after a sustained complexity change.
7. The export UI switches from the rough preflight range to a live observed remaining time after warmup.
8. Sustained background throughput below 50% produces the actionable warning; recovery clears it; short dips do neither.

Existing export-engine, export-estimator, audio-export, cancellation, file-streaming, and project persistence tests must continue to pass.

## Browser Regression Verification

Run the same short, deterministic 480p fixture in foreground and background WebKit sessions. Capture total frames, elapsed time, frames per second, requested/effective encoder configuration, and visibility transitions.

The browser gate passes when:

- foreground export completes successfully;
- background export completes successfully;
- background throughput is at least 50% of foreground throughput;
- no per-frame-loop timer events appear in the Web Inspector trace;
- the live estimate updates from observed throughput and does not retain the rough preflight value;
- cancellation, file finalization, and output playback remain correct.

Verify the Vintage Tokyo project separately as a representative manual scenario, but do not use private project media as a committed automated fixture.

## Failure Modes

- Removing the timer without retaining async backpressure could starve UI work. Browser verification must confirm progress controls and cancellation remain responsive.
- Forcing hardware acceleration may be slower or unsupported for some codec and resolution combinations. Shared `no-preference` policy avoids treating GPU use as the goal.
- A live estimate based on too few frames may oscillate. Warmup, bounded smoothing, and confidence state prevent false precision.
- Background media decode may still be throttled by WebKit independently of timers. The throughput threshold and warning make this visible. If the browser gate remains below 50% after the timer repair, evaluate a dedicated worker and do not declare the performance repair complete until the gate passes.
- Clearing caches too aggressively may destroy useful sequential decode state. Cleanup timing must be instrumented before its cadence is changed.
- Silent decoder initialization failures currently obscure fallback behavior. The repair must emit structured warnings with media identifiers and selected fallback paths.

## Non-goals

- Moving the entire export pipeline into a worker in this repair.
- Server-side or native export.
- Requiring visible GPU utilization.
- Parallel frame rendering before sequential correctness and memory bounds are established.
- Guaranteeing an absolute export duration across all projects and devices.

## Delivery Evidence

Completion requires:

- deterministic regression-test output;
- foreground and background WebKit measurements from the committed fixture;
- a sanitized export diagnostic sample;
- an output video that plays through and has the expected duration, dimensions, frame rate, video, and audio;
- browser verification of progress, adaptive ETA, warning behavior, cancellation, and successful finalization;
- exact commands and results recorded in the implementation handoff.
