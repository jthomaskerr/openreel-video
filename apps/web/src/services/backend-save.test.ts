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

describe("backendSaveService.create", () => {
  it("creates a project on the backend and returns the orchestrator-assigned project", async () => {
    const returned: Project = {
      ...makeProject(),
      id: "my-new-project", // slug, not a UUID
      name: "My New Project",
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => returned,
      }),
    );

    const project = await backendSaveService.create("My New Project");

    expect(project.id).toBe("my-new-project");
    expect(project.name).toBe("My New Project");
  });

  it("passes settings through to POST body", async () => {
    const returned: Project = {
      ...makeProject(),
      id: "widescreen-project",
      name: "Widescreen",
      settings: { ...makeProject().settings, width: 2560, height: 1440 },
    };

    let capturedBody: string | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        capturedBody = init?.body as string;
        return {
          ok: true,
          json: async () => returned,
        };
      }),
    );

    await backendSaveService.create("Widescreen", { width: 2560, height: 1440 });

    const parsed = JSON.parse(capturedBody!);
    expect(parsed.name).toBe("Widescreen");
    expect(parsed.settings).toEqual({ width: 2560, height: 1440 });
  });

  it("throws with a descriptive error on HTTP failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: "Failed to create", detail: "branch collision" }),
      }),
    );

    await expect(backendSaveService.create("Doomed")).rejects.toThrow(
      "Backend create failed: HTTP 500 — branch collision",
    );
  });

  it("throws even when the error body is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => {
          throw new Error("not json");
        },
      }),
    );

    await expect(backendSaveService.create("Doomed")).rejects.toThrow(
      "Backend create failed: HTTP 502",
    );
  });
});