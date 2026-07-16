import { describe, expect, it } from "vitest";
import {
  getMediaDropRejection,
  isMediaCompatibleWithTrack,
  pointerToTimelineTime,
} from "./media-drop";

describe("pointerToTimelineTime", () => {
  it.each([
    {
      name: "unscrolled at normal zoom",
      clientX: 350,
      viewportLeft: 100,
      scrollLeft: 0,
      pixelsPerSecond: 20,
      expected: 12.5,
    },
    {
      name: "horizontally scrolled at normal zoom",
      clientX: 350,
      viewportLeft: 100,
      scrollLeft: 200,
      pixelsPerSecond: 20,
      expected: 22.5,
    },
    {
      name: "horizontally scrolled at high zoom",
      clientX: 225,
      viewportLeft: 125,
      scrollLeft: 400,
      pixelsPerSecond: 40,
      expected: 12.5,
    },
  ])("converts $name", ({ expected, ...coordinates }) => {
    expect(pointerToTimelineTime(coordinates)).toBe(expected);
  });

  it("clamps pointers before the timeline origin to zero", () => {
    expect(pointerToTimelineTime({
      clientX: 50,
      viewportLeft: 100,
      scrollLeft: 0,
      pixelsPerSecond: 20,
    })).toBe(0);
  });
});

describe("media drop compatibility", () => {
  it.each([
    ["video", "video"],
    ["image", "video"],
    ["audio", "audio"],
    ["image", "image"],
    ["srt", "subtitle"],
  ] as const)("accepts %s media on a %s track", (mediaType, trackType) => {
    expect(isMediaCompatibleWithTrack(mediaType, trackType)).toBe(true);
  });

  it("rejects incompatible and locked targets with a visible reason", () => {
    expect(getMediaDropRejection({ type: "audio", locked: false }, "video"))
      .toContain("not compatible");
    expect(getMediaDropRejection({ type: "video", locked: true }, "video"))
      .toBe("Track is locked");
  });
});
