import { describe, expect, it } from "vitest";
import type { MediaItem, Track } from "@openreel/core";
import { getAudioPlaybackClips } from "./preview-audio-playback";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const transform = {
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  rotation: 0,
  anchor: { x: 0.5, y: 0.5 },
  opacity: 1,
};

function clip(
  id: string,
  mediaId: string,
  trackId: string,
  type: "video" | "audio",
  overrides: Partial<{ startTime: number; duration: number }> = {},
): Track["clips"][number] {
  return {
    id,
    type,
    mediaId,
    trackId,
    startTime: overrides.startTime ?? 0,
    duration: overrides.duration ?? 5,
    inPoint: 0,
    outPoint: overrides.duration ?? 5,
    effects: [],
    audioEffects: [],
    transform,
    volume: 1,
    keyframes: [],
  };
}

function track(
  id: string,
  type: "video" | "audio",
  clips: Track["clips"],
  overrides: Partial<{ hidden: boolean; muted: boolean }> = {},
): Track {
  return {
    id,
    type,
    name: id,
    clips,
    transitions: [],
    locked: false,
    hidden: overrides.hidden ?? false,
    muted: overrides.muted ?? false,
    solo: false,
  };
}

function media(
  id: string,
  type: "video" | "audio",
  channels: number,
  overrides: Partial<{ sampleRate: number; audioTrackCount: number }> = {},
): MediaItem {
  return {
    id,
    name: id,
    type,
    fileHandle: null,
    blob: new Blob(["x"]),
    metadata: {
      duration: 5,
      width: type === "video" ? 1920 : 0,
      height: type === "video" ? 1080 : 0,
      frameRate: type === "video" ? 30 : 0,
      codec: "",
      sampleRate: overrides.sampleRate ?? (channels > 0 ? 48000 : 0),
      channels,
      audioTrackCount: overrides.audioTrackCount,
      fileSize: 1,
    },
    thumbnailUrl: null,
    waveformData: null,
  };
}

/** Convenience: single map-based media lookup */
function lookup(items: MediaItem[]) {
  const map = new Map(items.map((m) => [m.id, m]));
  return (id: string) => map.get(id);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getAudioPlaybackClips", () => {
  // =========================================================================
  // Bug 1 regression: video embedded audio was never scheduled
  // Root cause: setupAudioFromAudioTrack only iterated type==="audio" tracks.
  // =========================================================================

  it("[regression Bug 1] includes video track when it has embedded audio and no separated clip", () => {
    // The old code filtered to audio tracks only — this video clip would have
    // been silently skipped, producing no audio during playback.
    const v = clip("v1", "media-1", "vt", "video");
    const tracks = [track("vt", "video", [v])];

    const result = getAudioPlaybackClips(tracks, lookup([media("media-1", "video", 2)]), 0);

    expect(result).toHaveLength(1);
    expect(result[0].clip.id).toBe("v1");
  });

  it("[regression Bug 1] video audio scheduled even when time is mid-clip", () => {
    const v = clip("v1", "media-1", "vt", "video", { startTime: 0, duration: 10 });
    const tracks = [track("vt", "video", [v])];

    const result = getAudioPlaybackClips(tracks, lookup([media("media-1", "video", 2)]), 7);

    expect(result).toHaveLength(1);
    expect(result[0].clip.id).toBe("v1");
  });

  // =========================================================================
  // Bug 2 regression: audio-only path (no visual content) — the helper itself
  // must return clips correctly so the caller can detect hasAnyVisualContent=false.
  // This test defends the clip-counting logic used to decide that branch.
  // =========================================================================

  it("[regression Bug 2] pure audio track clips are returned so audio-only path fires", () => {
    const a = clip("a1", "media-1", "at", "audio");
    const tracks = [track("at", "audio", [a])];

    const result = getAudioPlaybackClips(tracks, lookup([media("media-1", "audio", 2)]), 0);

    expect(result).toHaveLength(1);
    expect(result[0].clip.id).toBe("a1");
  });

  it("[regression Bug 2] empty result for audio-only project with no clips in window", () => {
    // If no clips are in window, audio-only fast path should not fire either.
    const a = clip("a1", "media-1", "at", "audio", { startTime: 10, duration: 5 });
    const tracks = [track("at", "audio", [a])];

    const result = getAudioPlaybackClips(tracks, lookup([media("media-1", "audio", 2)]), 0);

    expect(result).toHaveLength(0);
  });

  // =========================================================================
  // Separated-audio suppression (the fix's core logic)
  // =========================================================================

  it("uses embedded video audio when no separated audio clip is present", () => {
    const video = clip("video-clip", "media-1", "video-track", "video");
    const tracks = [track("video-track", "video", [video])];
    const mediaItems = [media("media-1", "video", 2)];

    expect(
      getAudioPlaybackClips(
        tracks,
        (id) => mediaItems.find((item) => item.id === id),
        1,
      ),
    ).toEqual([{ track: tracks[0], clip: video }]);
  });

  it("prefers a separated audio clip over duplicate embedded video audio", () => {
    const video = clip("video-clip", "media-1", "video-track", "video");
    const separatedAudio = clip("audio-clip", "media-1", "audio-track", "audio");
    const tracks = [
      track("video-track", "video", [video]),
      track("audio-track", "audio", [separatedAudio]),
    ];
    const mediaItems = [media("media-1", "video", 2)];

    expect(
      getAudioPlaybackClips(
        tracks,
        (id) => mediaItems.find((item) => item.id === id),
        1,
      ),
    ).toEqual([{ track: tracks[1], clip: separatedAudio }]);
  });

  // =========================================================================
  // Hidden / muted track suppression
  // =========================================================================

  it("excludes clips from hidden audio tracks", () => {
    const a = clip("a1", "media-1", "at", "audio");
    const tracks = [track("at", "audio", [a], { hidden: true })];

    const result = getAudioPlaybackClips(tracks, lookup([media("media-1", "audio", 2)]), 0);

    expect(result).toHaveLength(0);
  });

  it("excludes clips from hidden video tracks", () => {
    const v = clip("v1", "media-1", "vt", "video");
    const tracks = [track("vt", "video", [v], { hidden: true })];

    const result = getAudioPlaybackClips(tracks, lookup([media("media-1", "video", 2)]), 0);

    expect(result).toHaveLength(0);
  });

  it("excludes clips from muted audio tracks", () => {
    const a = clip("a1", "media-1", "at", "audio");
    const tracks = [track("at", "audio", [a], { muted: true })];

    const result = getAudioPlaybackClips(tracks, lookup([media("media-1", "audio", 2)]), 0);

    expect(result).toHaveLength(0);
  });

  it("excludes clips from muted video tracks", () => {
    const v = clip("v1", "media-1", "vt", "video");
    const tracks = [track("vt", "video", [v], { muted: true })];

    const result = getAudioPlaybackClips(tracks, lookup([media("media-1", "video", 2)]), 0);

    expect(result).toHaveLength(0);
  });

  // =========================================================================
  // Key Decision: muted separated-audio track still suppresses duplicate video audio
  // The old logic, if it had this check, could have re-included video audio when
  // the separated-audio track was muted. The helper must NOT do that.
  // =========================================================================

  it("[regression] muted separated-audio track still suppresses video embedded audio", () => {
    // A user muted the separated audio track — we do NOT want to silently fall
    // back to the video's embedded audio (that would break the mute operation).
    const v = clip("v1", "media-1", "vt", "video");
    const sep = clip("a1", "media-1", "at", "audio");
    const tracks = [
      track("vt", "video", [v]),
      track("at", "audio", [sep], { muted: true }), // muted but still present
    ];

    const result = getAudioPlaybackClips(tracks, lookup([media("media-1", "video", 2)]), 0);

    // Both clips should be excluded: video suppressed by linked audio, audio
    // excluded because its track is muted.
    expect(result).toHaveLength(0);
  });

  // =========================================================================
  // startTime tolerance boundary for linked-audio detection (0.01 s)
  it("suppresses video audio when separated clip startTime differs by less than 0.01 s", () => {
    const v = clip("v1", "media-1", "vt", "video", { startTime: 0 });
    const sep = clip("a1", "media-1", "at", "audio", { startTime: 0.009 }); // within tolerance
    const tracks = [
      track("vt", "video", [v]),
      track("at", "audio", [sep]),
    ];

    // Pass lookAhead=1 so both v (startTime=0) and sep (startTime=0.009) are in window
    const result = getAudioPlaybackClips(tracks, lookup([media("media-1", "video", 2)]), 0, 1);

    // Video should be suppressed; audio track is not muted so it appears
    expect(result).toHaveLength(1);
    expect(result[0].clip.id).toBe("a1");
  });

  it("does NOT suppress video audio when separated clip startTime differs by 0.01 s exactly", () => {
    // Condition is Math.abs(delta) < 0.01 (strictly less) — at exactly 0.01 no suppression
    const v = clip("v1", "media-1", "vt", "video", { startTime: 0 });
    const sep = clip("a1", "media-1", "at", "audio", { startTime: 0.01 }); // at boundary — no suppression
    const tracks = [
      track("vt", "video", [v]),
      track("at", "audio", [sep]),
    ];

    // lookAhead=1 keeps both clips in window
    const result = getAudioPlaybackClips(tracks, lookup([media("media-1", "video", 2)]), 0, 1);

    // Video NOT suppressed — two clips
    expect(result).toHaveLength(2);
  });

  // =========================================================================
  // mediaId mismatch: different media must NOT suppress video audio
  // =========================================================================

  it("does not suppress video audio when separated audio clip has different mediaId", () => {
    const v = clip("v1", "media-1", "vt", "video");
    const sep = clip("a1", "media-2", "at", "audio"); // different mediaId
    const tracks = [
      track("vt", "video", [v]),
      track("at", "audio", [sep]),
    ];
    const items = [media("media-1", "video", 2), media("media-2", "audio", 2)];

    const result = getAudioPlaybackClips(tracks, lookup(items), 0);

    // Both clips play independently
    expect(result).toHaveLength(2);
    const ids = result.map((r) => r.clip.id).sort();
    expect(ids).toEqual(["a1", "v1"]);
  });

  // =========================================================================
  // mediaItemHasAudio: silent video (0 channels) must not be scheduled
  // =========================================================================

  it("excludes video clips whose media has 0 audio channels", () => {
    const v = clip("v1", "media-1", "vt", "video");
    const tracks = [track("vt", "video", [v])];
    const items = [media("media-1", "video", 0)]; // channels=0, sampleRate will also be 0

    const result = getAudioPlaybackClips(tracks, lookup(items), 0);

    expect(result).toHaveLength(0);
  });

  it("includes video clips that have sampleRate > 0 even when channels field is 0", () => {
    // sampleRate alone signals audio presence (some container metadata may be incomplete)
    const v = clip("v1", "media-1", "vt", "video");
    const tracks = [track("vt", "video", [v])];
    const items = [media("media-1", "video", 0, { sampleRate: 44100 })];

    const result = getAudioPlaybackClips(tracks, lookup(items), 0);

    expect(result).toHaveLength(1);
  });

  it("includes video clips that have audioTrackCount > 0 even when channels and sampleRate are 0", () => {
    // audioTrackCount is the third fallback used by mediaItemHasAudio
    const v = clip("v1", "media-1", "vt", "video");
    const tracks = [track("vt", "video", [v])];
    const items = [media("media-1", "video", 0, { sampleRate: 0, audioTrackCount: 1 })];

    const result = getAudioPlaybackClips(tracks, lookup(items), 0);

    expect(result).toHaveLength(1);
  });

  it("excludes unknown mediaId from results", () => {
    const v = clip("v1", "nonexistent", "vt", "video");
    const tracks = [track("vt", "video", [v])];

    const result = getAudioPlaybackClips(tracks, lookup([]), 0);

    expect(result).toHaveLength(0);
  });

  // =========================================================================
  // Playback window boundary conditions
  // =========================================================================

  it("excludes clip that ends exactly at current time (half-open interval)", () => {
    // clip.startTime + clip.duration > time required — equality is excluded
    const a = clip("a1", "media-1", "at", "audio", { startTime: 0, duration: 5 });
    const tracks = [track("at", "audio", [a])];

    // time = 5: clip ends exactly at 5, must not be included
    const result = getAudioPlaybackClips(tracks, lookup([media("media-1", "audio", 2)]), 5);

    expect(result).toHaveLength(0);
  });

  it("includes clip that starts exactly at current time + lookAhead", () => {
    // clip.startTime <= time + lookAheadSeconds
    const a = clip("a1", "media-1", "at", "audio", { startTime: 2, duration: 5 });
    const tracks = [track("at", "audio", [a])];

    // time=0, lookAhead=2: startTime(2) <= 0+2 ✓, endTime(7) > 0 ✓
    const result = getAudioPlaybackClips(tracks, lookup([media("media-1", "audio", 2)]), 0, 2);

    expect(result).toHaveLength(1);
  });

  it("excludes clip that starts just past lookAhead window", () => {
    const a = clip("a1", "media-1", "at", "audio", { startTime: 2.01, duration: 5 });
    const tracks = [track("at", "audio", [a])];

    // time=0, lookAhead=2: startTime(2.01) > 0+2 → excluded
    const result = getAudioPlaybackClips(tracks, lookup([media("media-1", "audio", 2)]), 0, 2);

    expect(result).toHaveLength(0);
  });

  // =========================================================================
  // Multi-track scenarios
  // =========================================================================

  it("returns all eligible clips across multiple tracks at once", () => {
    const a1 = clip("a1", "media-1", "at1", "audio");
    const a2 = clip("a2", "media-2", "at2", "audio");
    const tracks = [
      track("at1", "audio", [a1]),
      track("at2", "audio", [a2]),
    ];
    const items = [media("media-1", "audio", 2), media("media-2", "audio", 2)];

    const result = getAudioPlaybackClips(tracks, lookup(items), 0);

    expect(result).toHaveLength(2);
  });

  it("handles mix of audio and video tracks returning only eligible clips", () => {
    const v = clip("v1", "media-1", "vt", "video");
    const a = clip("a1", "media-2", "at", "audio");
    const tracks = [
      track("vt", "video", [v]),
      track("at", "audio", [a]),
    ];
    const items = [media("media-1", "video", 2), media("media-2", "audio", 2)];

    const result = getAudioPlaybackClips(tracks, lookup(items), 0);

    expect(result).toHaveLength(2);
    const ids = result.map((r) => r.clip.id).sort();
    expect(ids).toEqual(["a1", "v1"]);
  });

  it("ignores non-audio, non-video track types", () => {
    // If a track type is e.g. "text" or "image", it should be skipped
    const a = clip("a1", "media-1", "at", "audio");
    const textTrack = {
      id: "tt",
      type: "text" as unknown as "audio",
      name: "tt",
      clips: [a],
      transitions: [],
      locked: false,
      hidden: false,
      muted: false,
      solo: false,
    };
    const tracks = [textTrack as unknown as Track];

    const result = getAudioPlaybackClips(tracks, lookup([media("media-1", "audio", 2)]), 0);

    expect(result).toHaveLength(0);
  });

  it("returns empty array for empty tracks list", () => {
    const result = getAudioPlaybackClips([], lookup([]), 0);
    expect(result).toHaveLength(0);
  });

  it("returns empty array for track with no clips", () => {
    const tracks = [track("at", "audio", [])];
    const result = getAudioPlaybackClips(tracks, lookup([media("media-1", "audio", 2)]), 0);
    expect(result).toHaveLength(0);
  });
});
