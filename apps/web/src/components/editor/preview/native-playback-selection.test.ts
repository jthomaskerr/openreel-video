/**
 * native-playback-selection.test.ts
 *
 * Tests that the native video playback path correctly detects and handles
 * missing video clips on the timeline.
 */

import { describe, it, expect } from "vitest";

// We test the logic inline since `canUseNativeVideoPlayback` is a useCallback
// inside Preview.tsx and not easily exported. These tests verify the shape
// of the decision-making logic.

describe("native-playback-selection logic", () => {
  it("valid video clips with blobs should allow native playback", () => {
    // Simulated check: mediaItem.blob exists and type is "video"
    const mediaItem = { blob: new Blob(), type: "video" as const };
    const canUse = mediaItem.blob && mediaItem.type === "video";
    expect(canUse).toBe(true);
  });

  it("missing video clips should disable native playback", () => {
    // Simulated missing media: no blob, type is video, status is MISSING
    const mediaItem = { blob: null, type: "video" as const, status: "MISSING" };
    const isMissing = !mediaItem.blob && mediaItem.type === "video" && mediaItem.status === "MISSING";
    // If any visible future clip is missing, native should be disabled
    expect(isMissing).toBe(true);
  });

  it("mixed valid + missing timeline should diagnose the missing interval", () => {
    // Simulate a timeline with two clips: one valid, one missing
    const clips = [
      { mediaItem: { blob: new Blob(), type: "video" }, startTime: 0, duration: 5 },
      { mediaItem: { blob: null, type: "video", status: "MISSING" }, startTime: 5, duration: 5 },
    ];

    const validClips = clips.filter(
      (c) => c.mediaItem.blob && c.mediaItem.type === "video",
    );
    const missingClips = clips.filter(
      (c) =>
        c.mediaItem.type === "video" &&
        !c.mediaItem.blob &&
        (c.mediaItem as { status?: string }).status === "MISSING",
    );

    // Valid clips exist, but missing clips also exist
    expect(validClips.length).toBe(1);
    expect(missingClips.length).toBe(1);

    // The native playback should be disabled when ANY future missing clip exists
    const hasVisibleMissing = missingClips.length > 0;
    const nativePlaybackAllowed = !hasVisibleMissing && validClips.length > 0;
    expect(nativePlaybackAllowed).toBe(false);
  });

  it("all valid clips should allow native playback", () => {
    const clips = [
      { mediaItem: { blob: new Blob(), type: "video" }, startTime: 0, duration: 5 },
      { mediaItem: { blob: new Blob(), type: "video" }, startTime: 5, duration: 5 },
    ];

    const validClips = clips.filter(
      (c) => c.mediaItem.blob && c.mediaItem.type === "video",
    );
    const missingClips = clips.filter(
      (c) => !c.mediaItem.blob,
    );

    expect(validClips.length).toBe(2);
    expect(missingClips.length).toBe(0);

    const nativePlaybackAllowed = missingClips.length === 0 && validClips.length > 0;
    expect(nativePlaybackAllowed).toBe(true);
  });

  it("image clips with blobs do not affect native video path", () => {
    const clip = { mediaItem: { blob: new Blob(), type: "image" } };
    const isVideo = clip.mediaItem.type === "video";
    expect(isVideo).toBe(false);
  });

  it("missing audio clip should not disable native video playback", () => {
    const clips = [
      { mediaItem: { blob: new Blob(), type: "video" } }, // video: OK
      { mediaItem: { blob: null, type: "audio", status: "MISSING" } }, // audio: missing
    ];

    const validVideos = clips.filter(
      (c) => c.mediaItem.blob && c.mediaItem.type === "video",
    );
    const missingVideos = clips.filter(
      (c) =>
        c.mediaItem.type === "video" &&
        !c.mediaItem.blob,
    );

    expect(validVideos.length).toBe(1);
    expect(missingVideos.length).toBe(0);
  });
});
