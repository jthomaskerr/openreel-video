import { describe, expect, it } from "vitest";
import {
  createTimebase,
  frameIndexToRationalSeconds,
  frameRangeFromSeconds,
  rationalTimeToString,
  secondsToFrameIndex,
} from "./timebase";

describe("handoff timebase", () => {
  it.each([
    [24, 24, 1],
    [25, 25, 1],
    [30, 30, 1],
    [23.976, 24_000, 1_001],
    [29.97, 30_000, 1_001],
    [59.94, 60_000, 1_001],
  ])("normalizes %s fps to %s/%s", (source, numerator, denominator) => {
    expect(createTimebase(source)).toMatchObject({
      framesPerSecondNumerator: numerator,
      framesPerSecondDenominator: denominator,
      frameDurationNumerator: denominator,
      frameDurationDenominator: numerator,
      sourceFrameRate: source,
    });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -24, 23.5])(
    "rejects unsupported or invalid rate %s",
    (frameRate) => expect(() => createTimebase(frameRate)).toThrow(/frame rate/i),
  );

  it("rounds an exact positive half-frame boundary to the following frame", () => {
    const timebase = createTimebase(30);
    expect(secondsToFrameIndex(0.5 / 30, timebase)).toBe(1);
  });

  it("rounds range boundaries independently and derives a positive duration", () => {
    const timebase = createTimebase(30);
    expect(frameRangeFromSeconds({ startTime: 1 / 60, endTime: 3 / 60 }, timebase)).toEqual({
      startFrame: 1,
      endFrame: 2,
      durationFrames: 1,
    });
  });

  it("rejects a range that collapses to zero frames", () => {
    const timebase = createTimebase(30);
    expect(() => frameRangeFromSeconds({ startTime: 0, endTime: 0.001 }, timebase)).toThrow(
      /positive frame duration/i,
    );
  });

  it("reduces rational seconds", () => {
    const timebase = createTimebase(30);
    expect(frameIndexToRationalSeconds(60, timebase)).toEqual({ numerator: 2, denominator: 1 });
    expect(rationalTimeToString({ numerator: 2, denominator: 1 })).toBe("2s");
  });

  it("round-trips a 60-minute NTSC frame boundary without drift", () => {
    const timebase = createTimebase(29.97);
    const sixtyMinuteFrame = secondsToFrameIndex(60 * 60, timebase);
    const rational = frameIndexToRationalSeconds(sixtyMinuteFrame, timebase);
    const exactSeconds = rational.numerator / rational.denominator;

    expect(secondsToFrameIndex(exactSeconds, timebase)).toBe(sixtyMinuteFrame);
    expect(rationalTimeToString(rational)).toMatch(/^\d+(?:\/\d+)?s$/);
  });
});

describe("long-form rational timing", () => {
  it("round-trips the final frame of a 60-minute 29.97 fps fixture with zero frame drift", () => {
    const timebase = createTimebase(29.97);
    const finalFrame = Math.round((60 * 60 * 30_000) / 1_001);
    const rational = frameIndexToRationalSeconds(finalFrame, timebase);
    expect(secondsToFrameIndex(rational.numerator / rational.denominator, timebase)).toBe(finalFrame);
    expect(rational.denominator).toBeGreaterThan(0);
  });
});
