import { describe, expect, it, vi } from "vitest";
import type { ActionResult, MediaItem, Project, Track } from "@openreel/core";
import type { GenerationJob } from "./generation-job-store";
import { processGenerationJobOnce, type GenerationPollerProjectStore } from "../hooks/useGenerationJobPoller";

function makeMedia(id: string): MediaItem {
  return {
    id,
    name: `${id}.png`,
    type: "image",
    fileHandle: null,
    blob: new Blob([id], { type: "image/png" }),
    metadata: { duration: 0, width: 16, height: 16, frameRate: 0, codec: "png", sampleRate: 0, channels: 0, fileSize: 1 },
    thumbnailUrl: null,
    waveformData: null,
    assetGroupId: id,
    isCurrent: true,
  };
}

function makeProject(source: MediaItem): Project {
  return {
    id: "project-1",
    name: "Poller Test",
    createdAt: 1,
    modifiedAt: 1,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items: [source] },
    timeline: { tracks: [], duration: 0, markers: [], subtitles: [] },
  };
}

function makeJob(overrides: Partial<GenerationJob> = {}): GenerationJob {
  return {
    id: "job-local-1",
    provider: "wavespeed",
    providerJobId: "provider-job-1",
    model: "image-model",
    prompt: "generate shot",
    inputs: { shotId: "shot-1", startTime: 9, duration: 4 },
    projectId: "project-1",
    linkedMediaIds: ["asset-v1"],
    status: "running",
    createdAt: 1,
    updatedAt: 1,
    retryHistory: [],
    ...overrides,
  };
}

function makeStore(project = makeProject(makeMedia("asset-v1"))) {
  let current = project;
  const store: GenerationPollerProjectStore = {
    get project() { return current; },
    getMediaItem: vi.fn((id: string) => current.mediaLibrary.items.find((item) => item.id === id)),
    addAssetVersion: vi.fn(async (sourceMediaId: string, item: MediaItem, blob: Blob): Promise<ActionResult> => {
      const source = current.mediaLibrary.items.find((candidate) => candidate.id === sourceMediaId)!;
      const assetGroupId = source.assetGroupId ?? source.id;
      current = {
        ...current,
        mediaLibrary: {
          items: [
            ...current.mediaLibrary.items.map((existing) =>
              (existing.assetGroupId ?? existing.id) === assetGroupId
                ? { ...existing, assetGroupId, isCurrent: false }
                : existing,
            ),
            { ...item, blob, assetGroupId, isCurrent: true },
          ],
        },
      };
      return { success: true, actionId: "version-action" };
    }),
    addTrack: vi.fn(async (trackType: Track["type"]): Promise<ActionResult> => {
      const track: Track = {
        id: `${trackType}-track`,
        type: trackType,
        name: `${trackType} 1`,
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
    addClip: vi.fn(async (trackId, mediaId, startTime, options): Promise<ActionResult> => {
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

describe("processGenerationJobOnce", () => {
  it("completes a WaveSpeed job, creates an asset version, and places it at shot timing", async () => {
    const store = makeStore();
    const complete = vi.fn();
    const fail = vi.fn();
    const updateStatus = vi.fn();
    const outputBlob = new Blob(["result"], { type: "image/png" });

    await processGenerationJobOnce({
      job: makeJob(),
      projectStore: store,
      jobActions: { complete, fail, updateStatus },
      pollWavespeedJob: vi.fn().mockResolvedValue({ status: "completed", outputUrl: "http://localhost/result.png" }),
      pollKieaiTask: vi.fn(),
      getKieaiResultUrl: vi.fn(),
      fetchOutputBlob: vi.fn().mockResolvedValue(outputBlob),
    });

    expect(store.addAssetVersion).toHaveBeenCalledWith(
      "asset-v1",
      expect.objectContaining({
        type: "image",
        originalUrl: "http://localhost/result.png",
        generationMeta: expect.objectContaining({ provider: "wavespeed", model: "image-model", jobId: "provider-job-1" }),
      }),
      outputBlob,
    );
    const version = store.project.mediaLibrary.items.find((item) => item.id !== "asset-v1")!;
    expect(version.assetGroupId).toBe("asset-v1");
    expect(store.project.timeline.tracks[0].clips[0]).toMatchObject({
      mediaId: version.id,
      startTime: 9,
      duration: 4,
      metadata: { shotId: "shot-1", assetGroupId: "asset-v1", providerJobId: "provider-job-1" },
    });
    expect(complete).toHaveBeenCalledWith("job-local-1", "http://localhost/result.png");
    expect(fail).not.toHaveBeenCalled();
  });

  it("marks a failed provider job as failed", async () => {
    const fail = vi.fn();
    await processGenerationJobOnce({
      job: makeJob(),
      projectStore: makeStore(),
      jobActions: { complete: vi.fn(), fail, updateStatus: vi.fn() },
      pollWavespeedJob: vi.fn().mockResolvedValue({ status: "failed", error: "provider failed" }),
      pollKieaiTask: vi.fn(),
      getKieaiResultUrl: vi.fn(),
      fetchOutputBlob: vi.fn(),
    });

    expect(fail).toHaveBeenCalledWith("job-local-1", "provider failed");
  });
});
