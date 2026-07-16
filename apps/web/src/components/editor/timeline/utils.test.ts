import type { Track } from "@openreel/core";
import { describe, expect, it } from "vitest";
import type { SnapSettings } from "./types";
import { calculateEdgeSnap, calculateSnap } from "./utils";

const DEFAULT_SETTINGS: SnapSettings = {
  enabled: true,
  snapToClips: true,
  snapToPlayhead: true,
  snapToGrid: true,
  gridSize: 1,
  snapThreshold: 10,
};

function tracksWith(
  clips: Array<{ id: string; startTime: number; duration: number }>,
): Track[] {
  return [{ id: "track-1", clips }] as unknown as Track[];
}

function settings(overrides: Partial<SnapSettings> = {}): SnapSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

describe("calculateSnap movement characterization", () => {
  it("returns the raw movement when snapping is disabled", () => {
    expect(
      calculateSnap(4.25, "moving", [], 5, settings({ enabled: false }), 100),
    ).toEqual({ time: 4.25, snapped: false });
  });

  it("snaps the moving clip start to another clip edge", () => {
    expect(
      calculateSnap(
        9.95,
        "moving",
        tracksWith([{ id: "other", startTime: 10, duration: 2 }]),
        30,
        settings({ snapToGrid: false }),
        100,
      ),
    ).toEqual({
      time: 10,
      snapped: true,
      snapPoint: { time: 10, type: "clip-start" },
    });
  });

  it("preserves opposite-edge movement snapping when duration is supplied", () => {
    expect(
      calculateSnap(
        7.95,
        "moving",
        tracksWith([{ id: "other", startTime: 10, duration: 2 }]),
        30,
        settings({ snapToGrid: false }),
        100,
        2,
      ),
    ).toEqual({
      time: 8,
      snapped: true,
      snapPoint: { time: 10, type: "clip-start" },
    });
  });
});

describe("calculateEdgeSnap", () => {
  it.each([
    ["clip start", 10.05, 10, "clip-start"],
    ["clip end", 11.95, 12, "clip-end"],
  ] as const)("snaps an edge to a %s", (_label, rawTime, expected, type) => {
    const result = calculateEdgeSnap(
      rawTime,
      "moving",
      tracksWith([{ id: "other", startTime: 10, duration: 2 }]),
      30,
      settings({ snapToPlayhead: false, snapToGrid: false }),
      100,
    );

    expect(result).toEqual({
      time: expected,
      snapped: true,
      snapPoint: { time: expected, type },
    });
    expect(result.snapPoint?.time).toBe(result.time);
  });

  it("snaps an edge to the playhead", () => {
    const result = calculateEdgeSnap(
      4.95,
      "moving",
      [],
      5,
      settings({ snapToClips: false, snapToGrid: false }),
      100,
    );

    expect(result).toEqual({
      time: 5,
      snapped: true,
      snapPoint: { time: 5, type: "playhead" },
    });
    expect(result.snapPoint?.time).toBe(result.time);
  });

  it("snaps an edge to the nearest grid line", () => {
    const result = calculateEdgeSnap(
      5.96,
      "moving",
      [],
      30,
      settings({ snapToClips: false, snapToPlayhead: false }),
      100,
    );

    expect(result).toEqual({
      time: 6,
      snapped: true,
      snapPoint: { time: 6, type: "grid" },
    });
    expect(result.snapPoint?.time).toBe(result.time);
  });

  it.each([
    [
      "clips",
      { snapToClips: false, snapToPlayhead: true, snapToGrid: false },
      tracksWith([{ id: "other", startTime: 5, duration: 2 }]),
      30,
    ],
    [
      "playhead",
      { snapToClips: true, snapToPlayhead: false, snapToGrid: false },
      [] as Track[],
      5,
    ],
    [
      "grid",
      { snapToClips: true, snapToPlayhead: true, snapToGrid: false },
      [] as Track[],
      30,
    ],
  ] as const)("honors independent %s target disablement", (_label, overrides, tracks, playhead) => {
    expect(
      calculateEdgeSnap(
        4.95,
        "moving",
        tracks,
        playhead,
        settings(overrides),
        100,
      ),
    ).toEqual({ time: 4.95, snapped: false });
  });

  it("prioritizes clips over playhead and grid even when they are farther away", () => {
    expect(
      calculateEdgeSnap(
        9.96,
        "moving",
        tracksWith([{ id: "other", startTime: 10.04, duration: 2 }]),
        9.97,
        settings(),
        100,
      ),
    ).toMatchObject({
      time: 10.04,
      snapPoint: { time: 10.04, type: "clip-start" },
    });
  });

  it("prioritizes the playhead over the grid even when the grid is closer", () => {
    expect(
      calculateEdgeSnap(
        9.96,
        "moving",
        [],
        9.9,
        settings({ snapToClips: false }),
        100,
      ),
    ).toMatchObject({
      time: 9.9,
      snapPoint: { time: 9.9, type: "playhead" },
    });
  });

  it("chooses the nearest target when priorities are equal", () => {
    expect(
      calculateEdgeSnap(
        10,
        "moving",
        tracksWith([
          { id: "left", startTime: 9.93, duration: 1 },
          { id: "right", startTime: 10.03, duration: 1 },
        ]),
        30,
        settings({ snapToPlayhead: false, snapToGrid: false }),
        100,
      ),
    ).toMatchObject({
      time: 10.03,
      snapPoint: { time: 10.03, type: "clip-start" },
    });
  });

  it("does not snap at the exact threshold boundary", () => {
    expect(
      calculateEdgeSnap(
        8,
        "moving",
        tracksWith([{ id: "other", startTime: 10, duration: 1 }]),
        30,
        settings({ snapToPlayhead: false, snapToGrid: false, snapThreshold: 2 }),
        1,
      ),
    ).toEqual({ time: 8, snapped: false });
  });

  it("converts the pixel threshold using the current zoom", () => {
    const args = [
      9.8,
      "moving",
      tracksWith([{ id: "other", startTime: 10, duration: 1 }]),
      30,
      settings({ snapToPlayhead: false, snapToGrid: false }),
    ] as const;

    expect(calculateEdgeSnap(...args, 40).snapped).toBe(true);
    expect(calculateEdgeSnap(...args, 100)).toEqual({
      time: 9.8,
      snapped: false,
    });
  });

  it("returns the raw edge when snapping is disabled", () => {
    expect(
      calculateEdgeSnap(
        4.95,
        "moving",
        tracksWith([{ id: "other", startTime: 5, duration: 2 }]),
        5,
        settings({ enabled: false }),
        100,
      ),
    ).toEqual({ time: 4.95, snapped: false });
  });

  it("excludes both edges of the clip being trimmed", () => {
    expect(
      calculateEdgeSnap(
        7,
        "moving",
        tracksWith([{ id: "moving", startTime: 5, duration: 2 }]),
        30,
        settings({ snapToPlayhead: false, snapToGrid: false }),
        100,
      ),
    ).toEqual({ time: 7, snapped: false });
  });
});
