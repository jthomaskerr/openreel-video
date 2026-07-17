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

const EWMA_ALPHA = 0.2;
const MIN_SAMPLE_FACTOR = 0.25;
const MAX_SAMPLE_FACTOR = 4;
const COMPLEXITY_MIN_FACTOR = 0.5;
const COMPLEXITY_MAX_FACTOR = 2;
const COMPLEXITY_CHANGE_SAMPLES = 5;
const WARMUP_MAX_MS = 30_000;
const BACKGROUND_MIN_MS = 15_000;
const BACKGROUND_MIN_FRAMES = 30;
const BACKGROUND_MIN_RATIO = 0.5;
const RECOVERY_MIN_FRAMES = 30;

function updateEwma(previous: number | null, sample: number): number {
  if (previous === null) return sample;
  return EWMA_ALPHA * sample + (1 - EWMA_ALPHA) * previous;
}

export class ExportPerformanceTracker {
  private readonly warmupFrameCount: number;
  private lastCompletedAtMs: number;
  private secondsPerFrame: number | null = null;
  private warmupOriginCompletedFrames = 0;
  private warmupOriginMs: number;
  private complexityAnchor: number | null = null;
  private complexityChangeSamples = 0;
  private visibleSecondsPerFrame: number | null = null;
  private visibleFrames = 0;
  private visibleStartedAtMs: number | null = null;
  private foregroundBaselineSecondsPerFrame: number | null = null;
  private hiddenSecondsPerFrame: number | null = null;
  private hiddenFrames = 0;
  private hiddenStartedAtMs: number | null = null;
  private lastVisibility: ExportVisibility = "unknown";
  private backgroundDegraded = false;
  private recoveryFrames = 0;

  constructor(
    private readonly totalFrames: number,
    private readonly startedAtMs: number,
  ) {
    this.lastCompletedAtMs = startedAtMs;
    this.warmupOriginMs = startedAtMs;
    this.warmupFrameCount = Math.max(1, Math.ceil(totalFrames * 0.1));
  }

  recordCompletedFrame(
    frame: number,
    completedAtMs: number,
    visibility: ExportVisibility,
  ): ExportPerformanceSnapshot {
    const previousCompletedAtMs = this.lastCompletedAtMs;
    const rawSecondsPerFrame = Math.max(
      Number.EPSILON,
      (completedAtMs - previousCompletedAtMs) / 1_000,
    );
    this.lastCompletedAtMs = completedAtMs;

    this.recordComplexitySample(frame, completedAtMs, rawSecondsPerFrame);
    this.recordVisibilitySample(
      completedAtMs,
      previousCompletedAtMs,
      rawSecondsPerFrame,
      visibility,
    );

    const completedFrames = frame + 1;
    const framesSinceWarmupOrigin =
      completedFrames - this.warmupOriginCompletedFrames;
    const warmupElapsedMs = completedAtMs - this.warmupOriginMs;
    const estimateConfidence: ExportEstimateConfidence =
      framesSinceWarmupOrigin >= this.warmupFrameCount ||
      warmupElapsedMs >= WARMUP_MAX_MS
        ? "observed"
        : "warming-up";
    const secondsPerFrame = this.secondsPerFrame ?? rawSecondsPerFrame;
    const remainingFrames = Math.max(0, this.totalFrames - completedFrames);

    return {
      framesPerSecond: 1 / secondsPerFrame,
      elapsedRenderingTime: (completedAtMs - this.startedAtMs) / 1_000,
      estimatedTimeRemaining: remainingFrames * secondsPerFrame,
      estimateConfidence,
      visibility,
      backgroundThroughputRatio: this.getBackgroundThroughputRatio(),
      backgroundDegraded: this.backgroundDegraded,
    };
  }

  private recordComplexitySample(
    frame: number,
    completedAtMs: number,
    rawSecondsPerFrame: number,
  ): void {
    const previous = this.secondsPerFrame;
    if (previous === null) {
      this.secondsPerFrame = rawSecondsPerFrame;
      return;
    }

    if (this.complexityAnchor === null) {
      if (this.isMaterialChange(rawSecondsPerFrame, previous)) {
        this.complexityAnchor = previous;
        this.complexityChangeSamples = 1;
      }
    } else if (this.isMaterialChange(rawSecondsPerFrame, this.complexityAnchor)) {
      this.complexityChangeSamples += 1;
    } else {
      this.complexityAnchor = null;
      this.complexityChangeSamples = 0;
    }

    if (this.complexityChangeSamples >= COMPLEXITY_CHANGE_SAMPLES) {
      this.secondsPerFrame = rawSecondsPerFrame;
      this.warmupOriginCompletedFrames = frame + 1;
      this.warmupOriginMs = completedAtMs;
      this.complexityAnchor = null;
      this.complexityChangeSamples = 0;
      return;
    }

    const boundedSample = Math.min(
      previous * MAX_SAMPLE_FACTOR,
      Math.max(previous * MIN_SAMPLE_FACTOR, rawSecondsPerFrame),
    );
    this.secondsPerFrame = updateEwma(previous, boundedSample);
  }

  private isMaterialChange(sample: number, baseline: number): boolean {
    return (
      sample < baseline * COMPLEXITY_MIN_FACTOR ||
      sample > baseline * COMPLEXITY_MAX_FACTOR
    );
  }

  private recordVisibilitySample(
    completedAtMs: number,
    previousCompletedAtMs: number,
    rawSecondsPerFrame: number,
    visibility: ExportVisibility,
  ): void {
    if (visibility === "visible") {
      if (this.visibleStartedAtMs === null) {
        this.visibleStartedAtMs = previousCompletedAtMs;
      }
      this.visibleFrames += 1;
      this.visibleSecondsPerFrame = updateEwma(
        this.visibleSecondsPerFrame,
        rawSecondsPerFrame,
      );
    }

    if (visibility === "hidden") {
      if (this.lastVisibility !== "hidden") {
        this.hiddenStartedAtMs = previousCompletedAtMs;
        this.hiddenFrames = 0;
        this.hiddenSecondsPerFrame = null;
        if (this.hasEstablishedForegroundBaseline(completedAtMs)) {
          this.foregroundBaselineSecondsPerFrame =
            this.visibleSecondsPerFrame;
        }
      }
      this.hiddenFrames += 1;
      this.hiddenSecondsPerFrame = updateEwma(
        this.hiddenSecondsPerFrame,
        rawSecondsPerFrame,
      );
    }

    this.updateDegradation(completedAtMs, rawSecondsPerFrame, visibility);
    this.lastVisibility = visibility;
  }

  private hasEstablishedForegroundBaseline(completedAtMs: number): boolean {
    if (
      this.visibleSecondsPerFrame === null ||
      this.visibleStartedAtMs === null
    ) {
      return false;
    }
    return (
      this.visibleFrames >= this.warmupFrameCount ||
      completedAtMs - this.visibleStartedAtMs >= WARMUP_MAX_MS
    );
  }

  private updateDegradation(
    completedAtMs: number,
    rawSecondsPerFrame: number,
    visibility: ExportVisibility,
  ): void {
    const baseline = this.foregroundBaselineSecondsPerFrame;
    if (baseline === null) return;

    const currentRatio = baseline / rawSecondsPerFrame;
    if (this.backgroundDegraded) {
      if (currentRatio >= BACKGROUND_MIN_RATIO) {
        this.recoveryFrames += 1;
        if (this.recoveryFrames >= RECOVERY_MIN_FRAMES) {
          this.backgroundDegraded = false;
          this.recoveryFrames = 0;
        }
      } else {
        this.recoveryFrames = 0;
      }
      return;
    }

    if (
      visibility === "hidden" &&
      this.hiddenStartedAtMs !== null &&
      this.hiddenFrames >= BACKGROUND_MIN_FRAMES &&
      completedAtMs - this.hiddenStartedAtMs >= BACKGROUND_MIN_MS &&
      (this.getBackgroundThroughputRatio() ?? 1) < BACKGROUND_MIN_RATIO
    ) {
      this.backgroundDegraded = true;
      this.recoveryFrames = 0;
    }
  }

  private getBackgroundThroughputRatio(): number | null {
    if (
      this.foregroundBaselineSecondsPerFrame === null ||
      this.hiddenSecondsPerFrame === null
    ) {
      return null;
    }
    return (
      this.foregroundBaselineSecondsPerFrame / this.hiddenSecondsPerFrame
    );
  }
}
