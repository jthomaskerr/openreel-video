import { describe, expect, it } from "vitest";
import { resolvePlaybackCleanupPosition } from "./playback-lifecycle";

describe("resolvePlaybackCleanupPosition", () => {
  it("preserves the reset position after playback completes", () => {
    expect(resolvePlaybackCleanupPosition({
      completed: true,
      startPosition: 0,
      clockIsActive: true,
      clockPosition: 12,
    })).toBe(0);
  });

  it("captures the clock position when playback pauses before completion", () => {
    expect(resolvePlaybackCleanupPosition({
      completed: false,
      startPosition: 0,
      clockIsActive: true,
      clockPosition: 4.25,
    })).toBe(4.25);
  });

  it("keeps the current start position when the clock is inactive", () => {
    expect(resolvePlaybackCleanupPosition({
      completed: false,
      startPosition: 3,
      clockIsActive: false,
      clockPosition: 9,
    })).toBe(3);
  });
});
