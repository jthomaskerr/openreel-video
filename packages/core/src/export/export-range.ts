import type { ExportRange } from "./types";

export interface ResolvedExportRange extends ExportRange {
  duration: number;
}

export interface ExportFrameTiming {
  totalFrames: number;
  timelineTime: number;
  outputTimestamp: number;
  frameDuration: number;
}

export function resolveExportRange(
  timelineDuration: number,
  range?: ExportRange,
): ResolvedExportRange {
  if (!Number.isFinite(timelineDuration) || timelineDuration <= 0) {
    throw new RangeError("Timeline duration must be a positive finite number");
  }

  const startTime = range?.startTime ?? 0;
  const endTime = range?.endTime ?? timelineDuration;

  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
    throw new RangeError("Export startTime and endTime must be finite numbers");
  }
  if (startTime < 0) {
    throw new RangeError("Export startTime cannot be negative");
  }
  if (endTime > timelineDuration) {
    throw new RangeError("Export endTime cannot exceed the timeline duration");
  }
  if (endTime <= startTime) {
    throw new RangeError("Export endTime must be after startTime");
  }

  return { startTime, endTime, duration: endTime - startTime };
}

export function getExportFrameTiming(
  range: ResolvedExportRange,
  frameRate: number,
  frame: number,
): ExportFrameTiming {
  if (!Number.isFinite(frameRate) || frameRate <= 0) {
    throw new RangeError("Export frameRate must be a positive finite number");
  }

  const frameDuration = 1 / frameRate;
  return {
    totalFrames: Math.ceil(range.duration * frameRate),
    timelineTime: range.startTime + frame * frameDuration,
    outputTimestamp: frame * frameDuration,
    frameDuration,
  };
}
