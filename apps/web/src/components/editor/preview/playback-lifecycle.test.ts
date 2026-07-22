import { describe, expect, it } from "vitest";
import {
  isValidLoopRange,
  resolvePlaybackCleanupPosition,
  resolvePlaybackSessionStart,
  resolvePlaybackStopPosition,
  shouldInitializeDecodedVideo,
} from "./playback-lifecycle";

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

describe("preview playback transport decisions", () => {
  it("preserves the stopped position when rewind-on-stop is disabled", () => {
    expect(resolvePlaybackStopPosition({
      revertToSessionStart: false,
      sessionStart: 4,
      stoppedPosition: 12,
    })).toBe(12);
  });

  it("returns to the playback-session start when rewind-on-stop is enabled", () => {
    expect(resolvePlaybackStopPosition({
      revertToSessionStart: true,
      sessionStart: 4,
      stoppedPosition: 12,
    })).toBe(4);
  });

  it("starts a second play from zero when the playhead is at timeline end", () => {
    expect(resolvePlaybackSessionStart({
      requestedPosition: 12,
      timelineEnd: 12,
      loopEnabled: false,
      loopStart: 0,
      loopEnd: 0,
    })).toBe(0);
  });

  it("keeps the stopped end visible while resolving the next play from zero", () => {
    const stoppedPosition = resolvePlaybackStopPosition({
      revertToSessionStart: false,
      sessionStart: 4,
      stoppedPosition: 12,
    });
    const cleanupPosition = resolvePlaybackCleanupPosition({
      completed: true,
      startPosition: stoppedPosition,
      clockIsActive: true,
      clockPosition: 12,
    });

    expect(cleanupPosition).toBe(12);
    expect(resolvePlaybackSessionStart({
      requestedPosition: cleanupPosition,
      timelineEnd: 12,
      loopEnabled: false,
      loopStart: 0,
      loopEnd: 0,
    })).toBe(0);
  });

  it("starts at A when an enabled loop is valid and the playhead is outside it", () => {
    expect(resolvePlaybackSessionStart({
      requestedPosition: 9,
      timelineEnd: 12,
      loopEnabled: true,
      loopStart: 2,
      loopEnd: 6,
    })).toBe(2);
  });

  it("keeps a playhead already inside an enabled loop", () => {
    expect(resolvePlaybackSessionStart({
      requestedPosition: 4,
      timelineEnd: 12,
      loopEnabled: true,
      loopStart: 2,
      loopEnd: 6,
    })).toBe(4);
  });

  it("rejects incomplete and reversed loop ranges", () => {
    expect(isValidLoopRange(2, 6)).toBe(true);
    expect(isValidLoopRange(6, 2)).toBe(false);
    expect(isValidLoopRange(2, 2)).toBe(false);
  });

  it("never sends still images to the decoded-video initializer", () => {
    expect(shouldInitializeDecodedVideo("video")).toBe(true);
    expect(shouldInitializeDecodedVideo("image")).toBe(false);
    expect(shouldInitializeDecodedVideo("audio")).toBe(false);
    expect(shouldInitializeDecodedVideo("srt")).toBe(false);
    expect(shouldInitializeDecodedVideo(undefined)).toBe(false);
  });
});
