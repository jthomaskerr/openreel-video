import type { ExportRange } from "../types";
import type { FrameRange, RationalTime, Timebase } from "./types";

const CANONICAL_FRACTIONAL_RATES = [
  { source: 23.976, numerator: 24_000, denominator: 1_001 },
  { source: 29.97, numerator: 30_000, denominator: 1_001 },
  { source: 59.94, numerator: 60_000, denominator: 1_001 },
] as const;

const RATE_EPSILON = 0.000_5;

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a || 1;
}

function assertSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a safe integer`);
  }
}

export function reduceRational(numerator: number, denominator: number): RationalTime {
  assertSafeInteger(numerator, "Rational numerator");
  assertSafeInteger(denominator, "Rational denominator");
  if (denominator <= 0 || numerator < 0) {
    throw new RangeError("Rational time must be non-negative with a positive denominator");
  }
  const divisor = greatestCommonDivisor(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

export function createTimebase(sourceFrameRate: number): Timebase {
  if (!Number.isFinite(sourceFrameRate) || sourceFrameRate <= 0) {
    throw new RangeError("Frame rate must be finite and positive");
  }

  const fractional = CANONICAL_FRACTIONAL_RATES.find(
    (rate) => Math.abs(rate.source - sourceFrameRate) <= RATE_EPSILON,
  );
  if (fractional) {
    return {
      framesPerSecondNumerator: fractional.numerator,
      framesPerSecondDenominator: fractional.denominator,
      frameDurationNumerator: fractional.denominator,
      frameDurationDenominator: fractional.numerator,
      sourceFrameRate,
    };
  }

  if (!Number.isSafeInteger(sourceFrameRate)) {
    throw new RangeError("Frame rate must be a supported fractional rate or a positive integer");
  }

  return {
    framesPerSecondNumerator: sourceFrameRate,
    framesPerSecondDenominator: 1,
    frameDurationNumerator: 1,
    frameDurationDenominator: sourceFrameRate,
    sourceFrameRate,
  };
}

export function secondsToFrameIndex(seconds: number, timebase: Timebase): number {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new RangeError("Seconds must be finite and non-negative");
  }
  const frames = (seconds * timebase.framesPerSecondNumerator) / timebase.framesPerSecondDenominator;
  const rounded = Math.floor(frames + 0.5 + Number.EPSILON * Math.max(1, frames));
  assertSafeInteger(rounded, "Frame index");
  return rounded;
}

export function frameIndexToRationalSeconds(frameIndex: number, timebase: Timebase): RationalTime {
  assertSafeInteger(frameIndex, "Frame index");
  if (frameIndex < 0) throw new RangeError("Frame index must be non-negative");
  const numerator = frameIndex * timebase.frameDurationNumerator;
  assertSafeInteger(numerator, "Rational numerator");
  return reduceRational(numerator, timebase.frameDurationDenominator);
}

export function frameRangeFromSeconds(range: ExportRange, timebase: Timebase): FrameRange {
  if (!Number.isFinite(range.startTime) || !Number.isFinite(range.endTime) || range.endTime <= range.startTime) {
    throw new RangeError("Export range end must be greater than start");
  }
  const startFrame = secondsToFrameIndex(range.startTime, timebase);
  const endFrame = secondsToFrameIndex(range.endTime, timebase);
  const durationFrames = endFrame - startFrame;
  if (durationFrames <= 0) throw new RangeError("Export range must have a positive frame duration");
  return { startFrame, endFrame, durationFrames };
}

export function rationalTimeToString(time: RationalTime): string {
  const reduced = reduceRational(time.numerator, time.denominator);
  return reduced.denominator === 1 ? `${reduced.numerator}s` : `${reduced.numerator}/${reduced.denominator}s`;
}

