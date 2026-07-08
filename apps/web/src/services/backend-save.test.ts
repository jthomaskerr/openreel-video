import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@openreel/core";
import { backendSaveService } from "./backend-save";

const makeProject = (): Project => ({
  id: "project-1",
  name: "Backend Project",
  createdAt: 1,
  modifiedAt: 2,
  settings: {
    width: 1920,
    height: 1080,
    frameRate: 30,
    sampleRate: 48000,
    channels: 2,
  },
  mediaLibrary: {
    items: [
      {
        id: "media-1",
        name: "clip.mp4",
        type: "video",
        fileHandle: null,
        blob: null,
        metadata: {
          duration: 10,
          width: 1920,
          height: 1080,
          frameRate: 30,
          codec: "h264",
          sampleRate: 48000,
          channels: 2,
          fileSize: 100,
        },
        thumbnailUrl: null,
        waveformData: null,
      },
      {
        id: "media-2",
        name: "missing.mp4",
        type: "video",
        fileHandle: null,
        blob: null,
        metadata: {
          duration: 5,
          width: 1920,
          height: 1080,
          frameRate: 30,
          codec: "h264",
          sampleRate: 48000,
          channels: 2,
          fileSize: 50,
        },
        thumbnailUrl: null,
        waveformData: null,
      },
    ],
  },
  timeline: { tracks: [], subtitles: [], duration: 0, markers: [] },
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("backendSaveService.load", () => {
  it("populates remoteUrl for media files returned by the backend", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          project: makeProject(),
          mediaFiles: { "media-1": "media-1.mp4" },
        }),
      }),
    );

    const project = await backendSaveService.load("project-1");

    expect(project?.mediaLibrary.items[0]?.remoteUrl).toBe(
      "http://localhost:4041/api/projects/project-1/media/media-1.mp4",
    );
    expect(project?.mediaLibrary.items[1]?.remoteUrl).toBeUndefined();
  });
});
