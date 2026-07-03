import { describe, expect, it } from "vitest";
import type { MediaItem, Track } from "@openreel/core";
import { getAudioPlaybackClips } from "./preview-audio-playback";

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
): Track["clips"][number] {
  return {
    id,
    type,
    mediaId,
    trackId,
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    effects: [],
    audioEffects: [],
    transform,
    volume: 1,
    keyframes: [],
  };
}

function track(id: string, type: "video" | "audio", clips: Track["clips"]): Track {
  return {
    id,
    type,
    name: id,
    clips,
    transitions: [],
    locked: false,
    hidden: false,
    muted: false,
    solo: false,
  };
}

function media(id: string, type: "video" | "audio", channels: number): MediaItem {
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
      sampleRate: channels > 0 ? 48000 : 0,
      channels,
      fileSize: 1,
    },
    thumbnailUrl: null,
    waveformData: null,
  };
}

describe("getAudioPlaybackClips", () => {
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
});
