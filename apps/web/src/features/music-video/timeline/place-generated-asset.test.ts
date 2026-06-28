import { describe, expect, it, vi } from "vitest";
import type { ActionResult, MediaItem, Project, Track } from "@openreel/core";
import { placeGeneratedAssetOnTimeline, type GeneratedAssetPlacementStore } from "./place-generated-asset";

function makeProject(items: MediaItem[] = []): Project {
  return {
    id: "project-1",
    name: "Placement Test",
    createdAt: 1,
    modifiedAt: 1,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items },
    timeline: { tracks: [], duration: 0, markers: [], subtitles: [] },
  };
}

function makeMedia(id: string, type: "image" | "video", assetGroupId = "group-1"): MediaItem {
  return {
    id,
    name: `${id}.${type === "image" ? "png" : "mp4"}`,
    type,
    fileHandle: null,
    blob: new Blob([id]),
    metadata: { duration: 0, width: 16, height: 16, frameRate: 0, codec: "", sampleRate: 0, channels: 0, fileSize: 1 },
    thumbnailUrl: null,
    waveformData: null,
    assetGroupId,
    isCurrent: true,
  };
}

function makeStore(project = makeProject()) {
  let current = project;
  const store: GeneratedAssetPlacementStore = {
    get project() { return current; },
    addTrack: vi.fn(async (trackType: Track["type"]): Promise<ActionResult> => {
      const track: Track = {
        id: `${trackType}-track-${current.timeline.tracks.length + 1}`,
        type: trackType,
        name: `${trackType} ${current.timeline.tracks.length + 1}`,
        clips: [],
        transitions: [],
        locked: false,
        hidden: false,
        muted: false,
        solo: false,
      };
      current = { ...current, timeline: { ...current.timeline, tracks: [...current.timeline.tracks, track] } };
      return { success: true, actionId: "track-action" };
    }),
    addClip: vi.fn(async (trackId, mediaId, startTime, options) => {
      current = {
        ...current,
        timeline: {
          ...current.timeline,
          tracks: current.timeline.tracks.map((track) =>
            track.id === trackId
              ? {
                  ...track,
                  clips: [
                    ...track.clips,
                    {
                      id: `clip-${track.clips.length + 1}`,
                      mediaId,
                      startTime,
                      duration: options?.duration ?? 0,
                      inPoint: 0,
                      outPoint: options?.duration ?? 0,
                      speed: 1,
                      volume: 1,
                      opacity: 1,
                      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
                      effects: [],
                      transitions: [],
                      keyframes: [],
                      metadata: options?.metadata ?? {},
                    },
                  ],
                }
              : track,
          ),
        },
      };
      return { success: true, actionId: "clip-action" };
    }),
  };
  return store;
}

describe("placeGeneratedAssetOnTimeline", () => {
  it("places an image result on an image track at the shot timing", async () => {
    const media = makeMedia("image-v1", "image", "group-image");
    const store = makeStore(makeProject([media]));

    const result = await placeGeneratedAssetOnTimeline(store, {
      mediaId: media.id,
      shotId: "shot-1",
      startTime: 12,
      duration: 5,
      providerJobId: "job-1",
    });

    expect(result.success).toBe(true);
    expect(store.addTrack).toHaveBeenCalledWith("image");
    const track = store.project.timeline.tracks[0];
    expect(track.type).toBe("image");
    expect(track.clips[0]).toMatchObject({
      mediaId: "image-v1",
      startTime: 12,
      duration: 5,
      metadata: { shotId: "shot-1", assetGroupId: "group-image", providerJobId: "job-1" },
    });
  });

  it("places a video result on a video track", async () => {
    const media = makeMedia("video-v1", "video", "group-video");
    const store = makeStore(makeProject([media]));

    const result = await placeGeneratedAssetOnTimeline(store, {
      mediaId: media.id,
      shotId: "shot-2",
      startTime: 3,
      duration: 7,
    });

    expect(result.success).toBe(true);
    expect(store.project.timeline.tracks[0].type).toBe("video");
    expect(store.project.timeline.tracks[0].clips[0]).toMatchObject({ mediaId: "video-v1", startTime: 3, duration: 7 });
  });

  it("does not duplicate a clip for the same shot and asset group", async () => {
    const media = makeMedia("image-v1", "image", "group-image");
    const store = makeStore(makeProject([media]));

    await placeGeneratedAssetOnTimeline(store, { mediaId: media.id, shotId: "shot-1", startTime: 0, duration: 4 });
    const second = await placeGeneratedAssetOnTimeline(store, { mediaId: media.id, shotId: "shot-1", startTime: 0, duration: 4 });

    expect(second.success).toBe(true);
    expect(second.placed).toBe(false);
    expect(store.project.timeline.tracks[0].clips).toHaveLength(1);
  });
});
