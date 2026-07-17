import { describe, expect, it } from "vitest";
import {
  resolveExportRange,
  getExportFrameTiming,
} from "./export-range";

describe("resolveExportRange", () => {
  it("defaults to the complete timeline", () => {
    expect(resolveExportRange(12.5)).toEqual({
      startTime: 0,
      endTime: 12.5,
      duration: 12.5,
    });
  });

  it("accepts an explicit non-empty section", () => {
    expect(
      resolveExportRange(12.5, { startTime: 2.25, endTime: 7.75 }),
    ).toEqual({ startTime: 2.25, endTime: 7.75, duration: 5.5 });
  });

  it.each([
    [{ startTime: -1, endTime: 2 }, "startTime"],
    [{ startTime: 2, endTime: 2 }, "after"],
    [{ startTime: 3, endTime: 2 }, "after"],
    [{ startTime: 0, endTime: 13 }, "timeline"],
    [{ startTime: Number.NaN, endTime: 2 }, "finite"],
  ])("rejects invalid ranges", (range, message) => {
    expect(() => resolveExportRange(12.5, range)).toThrow(message);
  });
});

describe("getExportFrameTiming", () => {
  it("uses the selected range for frame count and rebases output timestamps", () => {
    const range = resolveExportRange(10, { startTime: 2, endTime: 3 });
    expect(getExportFrameTiming(range, 30, 0)).toEqual({
      totalFrames: 30,
      timelineTime: 2,
      outputTimestamp: 0,
      frameDuration: 1 / 30,
    });
    expect(getExportFrameTiming(range, 30, 29)).toEqual({
      totalFrames: 30,
      timelineTime: 2 + 29 / 30,
      outputTimestamp: 29 / 30,
      frameDuration: 1 / 30,
    });
  });
});
