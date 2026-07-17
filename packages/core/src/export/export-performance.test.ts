import { describe, expect, it } from "vitest";
import {
  ExportPerformanceTracker,
  type ExportPerformanceSnapshot,
} from "./export-performance";

function recordFrames(
  tracker: ExportPerformanceTracker,
  startFrame: number,
  count: number,
  startTimeMs: number,
  frameDurationMs: number,
  visibility: "visible" | "hidden" | "unknown",
): { sample: ExportPerformanceSnapshot; completedAtMs: number } {
  let sample!: ExportPerformanceSnapshot;
  let completedAtMs = startTimeMs;
  for (let offset = 0; offset < count; offset += 1) {
    completedAtMs += frameDurationMs;
    sample = tracker.recordCompletedFrame(
      startFrame + offset,
      completedAtMs,
      visibility,
    );
  }
  return { sample, completedAtMs };
}

describe("ExportPerformanceTracker", () => {
  it("converges on stable 40 fps samples", () => {
    const tracker = new ExportPerformanceTracker(300, 0);
    const { sample } = recordFrames(tracker, 0, 30, 0, 25, "visible");

    expect(sample.framesPerSecond).toBeCloseTo(40, 1);
    expect(sample.estimatedTimeRemaining).toBeCloseTo(6.75, 1);
    expect(sample.estimateConfidence).toBe("observed");
  });

  it("does not let one one-second outlier replace the rolling rate", () => {
    const tracker = new ExportPerformanceTracker(300, 0);
    const stable = recordFrames(tracker, 0, 35, 0, 25, "visible");
    const outlier = tracker.recordCompletedFrame(
      35,
      stable.completedAtMs + 1_000,
      "visible",
    );
    const recovered = recordFrames(
      tracker,
      36,
      10,
      stable.completedAtMs + 1_000,
      25,
      "visible",
    );

    expect(outlier.framesPerSecond).toBeCloseTo(25, 6);
    expect(recovered.sample.framesPerSecond).toBeGreaterThan(25);
  });

  it("resets confidence after five sustained scene-cost samples", () => {
    const tracker = new ExportPerformanceTracker(300, 0);
    const stable = recordFrames(tracker, 0, 30, 0, 25, "visible");
    expect(stable.sample.estimateConfidence).toBe("observed");

    const changed = recordFrames(
      tracker,
      30,
      5,
      stable.completedAtMs,
      60,
      "visible",
    );

    expect(changed.sample.estimateConfidence).toBe("warming-up");
  });

  it("warns only after a foreground baseline and sustained hidden degradation", () => {
    const tracker = new ExportPerformanceTracker(300, 0);
    const visible = recordFrames(tracker, 0, 30, 0, 25, "visible");
    const shortDip = recordFrames(
      tracker,
      30,
      10,
      visible.completedAtMs,
      500,
      "hidden",
    );
    expect(shortDip.sample.backgroundDegraded).toBe(false);

    const degraded = recordFrames(
      tracker,
      40,
      20,
      shortDip.completedAtMs,
      500,
      "hidden",
    );

    expect(degraded.sample.backgroundThroughputRatio).toBeLessThan(0.5);
    expect(degraded.sample.backgroundDegraded).toBe(true);
  });

  it("does not infer throttling without a foreground baseline", () => {
    const tracker = new ExportPerformanceTracker(300, 0);
    const hidden = recordFrames(tracker, 0, 40, 0, 500, "hidden");

    expect(hidden.sample.backgroundThroughputRatio).toBeNull();
    expect(hidden.sample.backgroundDegraded).toBe(false);
  });

  it("clears the warning after thirty recovered frames", () => {
    const tracker = new ExportPerformanceTracker(300, 0);
    const visible = recordFrames(tracker, 0, 30, 0, 25, "visible");
    const degraded = recordFrames(
      tracker,
      30,
      30,
      visible.completedAtMs,
      500,
      "hidden",
    );
    expect(degraded.sample.backgroundDegraded).toBe(true);

    const recovered = recordFrames(
      tracker,
      60,
      30,
      degraded.completedAtMs,
      25,
      "visible",
    );

    expect(recovered.sample.backgroundDegraded).toBe(false);
  });
});
