import { describe, expect, it, vi } from "vitest";
import type { ActionResult, MediaItem, Project, Track } from "@openreel/core";
import {
  placeGeneratedAssetOnTimeline,
  type GeneratedAssetPlacementStore,
} from "./place-generated-asset";

function makeProject(items: MediaItem[] = []): Project {
  return {
    id: "project-1",
    name: "Placement Test",
    createdAt: 1,
    modifiedAt: 1,
    settings: {
      width: 1920,
      height: 1080,
      frameRate: 30,
      sampleRate: 48_000,
      channels: 2,
    },
    mediaLibrary: { items },
    generatedImageDefinitions: [],
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
    metadata: {
      duration: 0,
      width: 16,
      height: 16,
      frameRate: 0,
      codec: "",
      sampleRate: 0,
      channels: 0,
      fileSize: 1,
    },
    thumbnailUrl: null,
    assetGroupId,
    isCurrent: true,
  };
}

function makeClip(overrides: Partial<Track["clips"][number]> = {}): Track["clips"][number] {
  return {
    id: "clip-1",
    type: "image",
    mediaId: "old-media",
    trackId: "image-track",
    startTime: 8,
    duration: 3,
    inPoint: 0.25,
    outPoint: 2.5,
    effects: [{ id: "fx-1", type: "blur", params: {}, enabled: true }],
    audioEffects: [{ id: "audio-fx-1", type: "gain", params: {}, enabled: true }],
    transform: {
      position: { x: 4, y: 5 },
      scale: { x: 1.2, y: 0.8 },
      rotation: 12,
      anchor: { x: 0, y: 0 },
      opacity: 0.7,
    },
    volume: 0.6,
    keyframes: [],
    metadata: {
      shotId: "shot-1",
      custom: "keep",
    },
    ...overrides,
  } as Track["clips"][number];
}

function makeStore(project = makeProject()) {
  let current = project;
  const store: GeneratedAssetPlacementStore = {
    get project() {
      return current;
    },
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
      current = {
        ...current,
        timeline: {
          ...current.timeline,
          tracks: [...current.timeline.tracks, track],
        },
      };
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
                      type: options?.type ?? "image",
                      mediaId,
                      trackId,
                      startTime,
                      duration: options?.duration ?? 0,
                      inPoint: 0,
                      outPoint: options?.duration ?? 0,
                      effects: [],
                      audioEffects: [],
                      transform: {
                        position: { x: 0, y: 0 },
                        scale: { x: 1, y: 1 },
                        rotation: 0,
                        anchor: { x: 0, y: 0 },
                        opacity: 1,
                      },
                      volume: 1,
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
    beginHistoryGroup: vi.fn(),
    endHistoryGroup: vi.fn(),
  };
  return store;
}

describe("placeGeneratedAssetOnTimeline", () => {
  it("skips timeline mutation for the none policy", async () => {
    const media = makeMedia("image-v1", "image");
    const store = makeStore(makeProject([media]));

    const result = await placeGeneratedAssetOnTimeline(store, {
      mediaId: media.id,
      shotId: "shot-1",
      startTime: 0,
      duration: 4,
      policy: "none",
    });

    expect(result).toMatchObject({
      success: true,
      placed: false,
      status: "skipped",
    });
    expect(store.addTrack).not.toHaveBeenCalled();
  });

  it.each([
    { startTime: 0, label: "zero" },
    { startTime: 12, label: "non-zero" },
  ])("creates a linked clip at %s timing", async ({ startTime, label }) => {
    const media = makeMedia(`image-${label}`, "image", `group-${label}`);
    const store = makeStore(makeProject([media]));

    const result = await placeGeneratedAssetOnTimeline(store, {
      mediaId: media.id,
      shotId: "shot-1",
      startTime,
      duration: 5,
      providerJobId: "job-1",
      idempotencyKey: `placement-${label}`,
    });

    expect(result).toMatchObject({
      success: true,
      placed: true,
      status: "applied",
    });
    expect(store.addTrack).toHaveBeenCalledWith("image");
    const track = store.project.timeline.tracks[0];
    expect(track.type).toBe("image");
    expect(track.clips[0]).toMatchObject({
      mediaId: media.id,
      startTime,
      duration: 5,
      metadata: {
        shotId: "shot-1",
        assetGroupId: `group-${label}`,
        providerJobId: "job-1",
        idempotencyKey: `placement-${label}`,
      },
    });
  });

  it("replays duplicate linked-clip keys without creating a second clip", async () => {
    const media = makeMedia("image-v1", "image", "group-image");
    const store = makeStore(makeProject([media]));

    const input = {
      mediaId: media.id,
      shotId: "shot-1",
      startTime: 0,
      duration: 4,
      idempotencyKey: "placement-replay",
    } as const;

    const first = await placeGeneratedAssetOnTimeline(store, input);
    const second = await placeGeneratedAssetOnTimeline(store, input);

    expect(first).toMatchObject({
      success: true,
      placed: true,
      status: "applied",
    });
    expect(second).toMatchObject({
      success: true,
      placed: false,
      status: "skipped",
    });
    expect(store.project.timeline.tracks).toHaveLength(1);
    expect(store.project.timeline.tracks[0].clips).toHaveLength(1);
  });

  it("replaces only mediaId and retains clip identity, state, and undo grouping", async () => {
    const oldMedia = makeMedia("image-old", "image");
    const newMedia = makeMedia("image-new", "image");
    const store = makeStore(makeProject([oldMedia, newMedia]));
    const selectedClip = makeClip({ mediaId: oldMedia.id });
    let track: Track = {
      id: "image-track",
      type: "image",
      name: "Images",
      clips: [selectedClip],
      transitions: [],
      locked: false,
      hidden: false,
      muted: false,
      solo: false,
    };
    const baseProject = store.project;
    Object.defineProperty(store, "project", {
      get: () => ({
        ...baseProject,
        timeline: { ...baseProject.timeline, tracks: [track] },
      }),
    });

    store.replaceClipMedia = vi.fn(async (clipId, mediaId, idempotencyKey) => {
      track = {
        ...track,
        clips: track.clips.map((clip) =>
          clip.id === clipId
            ? {
                ...clip,
                mediaId,
                metadata: { ...clip.metadata, idempotencyKey },
              }
            : clip,
        ) as Track["clips"],
      };
      return { success: true, actionId: "replace-action" };
    });

    const result = await placeGeneratedAssetOnTimeline(store, {
      mediaId: newMedia.id,
      shotId: "shot-1",
      startTime: 8,
      duration: 3,
      policy: "replace-selected-clip-media",
      clipId: "clip-1",
      idempotencyKey: "replace-key",
    });

    expect(result).toMatchObject({
      success: true,
      placed: true,
      clipId: "clip-1",
      status: "applied",
    });
    expect(store.beginHistoryGroup).toHaveBeenCalledTimes(1);
    expect(store.endHistoryGroup).toHaveBeenCalledTimes(1);
    expect(store.replaceClipMedia).toHaveBeenCalledWith(
      "clip-1",
      newMedia.id,
      "replace-key",
    );

    expect(track.clips[0]).toMatchObject({
      id: "clip-1",
      mediaId: newMedia.id,
      trackId: "image-track",
      startTime: 8,
      duration: 3,
      inPoint: 0.25,
      outPoint: 2.5,
      effects: [{ id: "fx-1", type: "blur", params: {}, enabled: true }],
      audioEffects: [{ id: "audio-fx-1", type: "gain", params: {}, enabled: true }],
      transform: {
        position: { x: 4, y: 5 },
        scale: { x: 1.2, y: 0.8 },
        rotation: 12,
        anchor: { x: 0, y: 0 },
        opacity: 0.7,
      },
      metadata: {
        shotId: "shot-1",
        custom: "keep",
      },
    });
  });

  it("skips a repeated replacement when the selected clip already has the generated media", async () => {
    const oldMedia = makeMedia("image-old", "image");
    const newMedia = makeMedia("image-new", "image");
    const store = makeStore(makeProject([oldMedia, newMedia]));
    const selectedClip = makeClip({ mediaId: oldMedia.id });
    let track: Track = {
      id: "image-track",
      type: "image",
      name: "Images",
      clips: [selectedClip],
      transitions: [],
      locked: false,
      hidden: false,
      muted: false,
      solo: false,
    };
    const baseProject = store.project;
    Object.defineProperty(store, "project", {
      get: () => ({
        ...baseProject,
        timeline: { ...baseProject.timeline, tracks: [track] },
      }),
    });

    store.replaceClipMedia = vi.fn(async (clipId, mediaId, idempotencyKey) => {
      track = {
        ...track,
        clips: track.clips.map((clip) =>
          clip.id === clipId
            ? {
                ...clip,
                mediaId,
                metadata: { ...clip.metadata, idempotencyKey },
              }
            : clip,
        ) as Track["clips"],
      };
      return { success: true, actionId: "replace-action" };
    });

    const input = {
      mediaId: newMedia.id,
      shotId: "shot-1",
      startTime: 8,
      duration: 3,
      policy: "replace-selected-clip-media" as const,
      clipId: "clip-1",
      idempotencyKey: "replace-key",
    };

    const first = await placeGeneratedAssetOnTimeline(store, input);
    const second = await placeGeneratedAssetOnTimeline(store, input);

    expect(first).toMatchObject({
      success: true,
      placed: true,
      status: "applied",
    });
    expect(second).toMatchObject({
      success: true,
      placed: false,
      status: "skipped",
    });
    expect(store.replaceClipMedia).toHaveBeenCalledTimes(1);
    expect(store.beginHistoryGroup).toHaveBeenCalledTimes(1);
    expect(store.endHistoryGroup).toHaveBeenCalledTimes(1);
    expect(track.clips[0]).toMatchObject({
      id: "clip-1",
      mediaId: newMedia.id,
    });
  });

  it("rejects replacement when the selected clip belongs to another shot", async () => {
    const media = makeMedia("image-v1", "image");
    const store = makeStore(makeProject([media]));
    const track: Track = {
      id: "image-track",
      type: "image",
      name: "Images",
      clips: [
        makeClip({
          id: "c",
          mediaId: media.id,
          metadata: { shotId: "other" },
        }),
      ],
      transitions: [],
      locked: false,
      hidden: false,
      muted: false,
      solo: false,
    };
    const baseProject = store.project;
    Object.defineProperty(store, "project", {
      get: () => ({
        ...baseProject,
        timeline: { ...baseProject.timeline, tracks: [track] },
      }),
    });

    store.replaceClipMedia = vi.fn();

    const result = await placeGeneratedAssetOnTimeline(store, {
      mediaId: media.id,
      shotId: "requested",
      startTime: 0,
      duration: 1,
      policy: "replace-selected-clip-media",
      clipId: "c",
    });

    expect(result).toMatchObject({
      success: false,
      placed: false,
      trackId: "image-track",
      clipId: "c",
    });
    expect(result.error?.code).toBe("INVALID_PARAMS");
    expect(store.replaceClipMedia).not.toHaveBeenCalled();
  });
});
