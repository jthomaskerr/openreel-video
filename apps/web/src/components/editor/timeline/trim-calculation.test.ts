import type { Keyframe } from "@openreel/core";
import { describe, expect, it } from "vitest";

import {
  calculateClipTrim,
  MIN_CLIP_DURATION_SECONDS,
  type ClipTrimSnapshot,
} from "./trim-calculation";

const keyframes: Keyframe[] = [
  {
    id: "kf-ordinary",
    time: 1,
    property: "opacity",
    value: 0.5,
    easing: "linear",
  },
  {
    id: "kf-exit-opacity",
    time: 4.5,
    property: "opacity",
    value: 0,
    easing: "ease-out",
  },
];

const baseSnapshot: ClipTrimSnapshot = {
  clipId: "clip-1",
  startTime: 10,
  duration: 5,
  inPoint: 2,
  outPoint: 7,
  sourceDuration: 12,
  keyframes,
};

describe("calculateClipTrim", () => {
  it.each([
    {
      name: "trims the left edge inward",
      snapshot: baseSnapshot,
      candidateEdgeTime: 12,
      expected: { edgeTime: 12, startTime: 12, duration: 3, inPoint: 4, outPoint: 7 },
    },
    {
      name: "extends the left edge outward",
      snapshot: baseSnapshot,
      candidateEdgeTime: 8,
      expected: { edgeTime: 8, startTime: 8, duration: 7, inPoint: 0, outPoint: 7 },
    },
    {
      name: "clamps the left edge at timeline zero",
      snapshot: { ...baseSnapshot, startTime: 1, inPoint: 5, outPoint: 10 },
      candidateEdgeTime: -10,
      expected: { edgeTime: 0, startTime: 0, duration: 6, inPoint: 4, outPoint: 10 },
    },
    {
      name: "clamps outward extension at source zero",
      snapshot: baseSnapshot,
      candidateEdgeTime: 5,
      expected: { edgeTime: 8, startTime: 8, duration: 7, inPoint: 0, outPoint: 7 },
    },
    {
      name: "preserves the minimum duration",
      snapshot: baseSnapshot,
      candidateEdgeTime: 20,
      expected: {
        edgeTime: 14.9,
        startTime: 14.9,
        duration: MIN_CLIP_DURATION_SECONDS,
        inPoint: 6.9,
        outPoint: 7,
      },
    },
  ])("$name", ({ snapshot, candidateEdgeTime, expected }) => {
    const update = calculateClipTrim(snapshot, "left", candidateEdgeTime);

    expect(update).toMatchObject({ edge: "left", ...expected });
    expect(update.startTime + update.duration).toBeCloseTo(
      snapshot.startTime + snapshot.duration,
    );
  });

  it.each([
    {
      name: "trims the right edge",
      candidateEdgeTime: 13,
      expected: { edgeTime: 13, startTime: 10, duration: 3, inPoint: 2, outPoint: 5 },
    },
    {
      name: "clamps the right edge at the source boundary",
      candidateEdgeTime: 30,
      expected: { edgeTime: 20, startTime: 10, duration: 10, inPoint: 2, outPoint: 12 },
    },
  ])("$name", ({ candidateEdgeTime, expected }) => {
    expect(calculateClipTrim(baseSnapshot, "right", candidateEdgeTime)).toMatchObject({
      edge: "right",
      ...expected,
    });
  });

  it("rejects non-finite input instead of returning invalid timing", () => {
    expect(() => calculateClipTrim(baseSnapshot, "left", Number.NaN)).toThrow(RangeError);
    expect(() =>
      calculateClipTrim({ ...baseSnapshot, sourceDuration: Number.POSITIVE_INFINITY }, "right", 12),
    ).toThrow(RangeError);
  });

  it("does not mutate the snapshot or its keyframes", () => {
    const snapshot = structuredClone(baseSnapshot);
    const before = structuredClone(snapshot);

    const update = calculateClipTrim(snapshot, "right", 13);

    expect(snapshot).toEqual(before);
    expect(update.keyframes).not.toBe(snapshot.keyframes);
  });

  it.each([
    { name: "shortening", candidateEdgeTime: 13, expectedDuration: 3, expectedExitTime: 2.5 },
    { name: "extension", candidateEdgeTime: 18, expectedDuration: 8, expectedExitTime: 7.5 },
  ])("preserves exit-relative keyframes when $name", ({ candidateEdgeTime, expectedDuration, expectedExitTime }) => {
    const update = calculateClipTrim(baseSnapshot, "right", candidateEdgeTime);

    expect(update.duration).toBe(expectedDuration);
    expect(update.keyframes.find((keyframe) => keyframe.id === "kf-ordinary")?.time).toBe(1);
    expect(update.keyframes.find((keyframe) => keyframe.id === "kf-exit-opacity")?.time).toBe(
      expectedExitTime,
    );
  });
});
