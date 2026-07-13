import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@openreel/core";
import { generateThumbnailFromBlob, generateThumbnailFromUrl } from "../utils/media-recovery";
import { backendSaveService } from "./backend-save";
import { useNotificationStore } from "../stores/notification-store";
import { usePersistenceStatusStore } from "../stores/persistence-status-store";

vi.mock("../utils/media-recovery", () => ({
  generateThumbnailFromBlob: vi.fn().mockResolvedValue(null),
  generateThumbnailFromUrl: vi.fn().mockResolvedValue(null),
  shouldRegenerateThumbnail: vi.fn((item: { thumbnailUrl: string | null; type: string }) =>
    (item.type === "video" || item.type === "image") &&
    (!item.thumbnailUrl || item.thumbnailUrl.startsWith("blob:")),
  ),
}));

const mockGenerateThumbnailFromBlob = vi.mocked(generateThumbnailFromBlob);
const mockGenerateThumbnailFromUrl = vi.mocked(generateThumbnailFromUrl);

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
  backendSaveService.resetForProject();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("backendSaveService.load", () => {
  it("populates remoteUrl and blob for media files returned by the backend", async () => {
    const mediaBlob = new Blob(["video"], { type: "video/mp4" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        if (url.endsWith("/media/media-1.mp4")) {
          return { ok: true, blob: async () => mediaBlob };
        }

        return {
          ok: true,
          json: async () => ({
            project: makeProject(),
            mediaFiles: { "media-1": "media-1.mp4" },
          }),
        };
      }),
    );

    const project = await backendSaveService.load("project-1");

    expect(project?.mediaLibrary.items[0]?.remoteUrl).toBe(
      "http://localhost:4041/api/projects/project-1/media/media-1.mp4",
    );
    expect(project?.mediaLibrary.items[0]?.blob).toBe(mediaBlob);
    expect(project?.mediaLibrary.items[1]?.remoteUrl).toBeUndefined();
  });

  it("regenerates missing or stale blob thumbnails from downloaded backend media", async () => {
    const baseProject = makeProject();
    const staleProject: Project = {
      ...baseProject,
      mediaLibrary: {
        ...baseProject.mediaLibrary,
        items: [
          {
            ...baseProject.mediaLibrary.items[0]!,
            thumbnailUrl: "blob:stale-thumbnail",
          },
        ],
      },
    };
    const mediaBlob = new Blob(["video"], { type: "video/mp4" });
    mockGenerateThumbnailFromBlob.mockResolvedValueOnce("blob:regenerated-thumbnail");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        if (url.endsWith("/media/media-1.mp4")) {
          return { ok: true, blob: async () => mediaBlob };
        }

        return {
          ok: true,
          json: async () => ({
            project: staleProject,
            mediaFiles: { "media-1": "media-1.mp4" },
          }),
        };
      }),
    );

    const project = await backendSaveService.load("project-1");

    expect(mockGenerateThumbnailFromBlob).toHaveBeenCalledWith(mediaBlob, "video");
    expect(mockGenerateThumbnailFromUrl).not.toHaveBeenCalled();
    expect(project?.mediaLibrary.items[0]?.thumbnailUrl).toBe(
      "blob:regenerated-thumbnail",
    );
  });

  it("clears stale blob thumbnails when the backend has no media binary", async () => {
    const baseProject = makeProject();
    const staleProject: Project = {
      ...baseProject,
      mediaLibrary: {
        items: [{
          ...baseProject.mediaLibrary.items[0]!,
          thumbnailUrl: "blob:stale-thumbnail",
          filmstripThumbnails: [{ timestamp: 0, url: "blob:stale-frame" }],
        }],
      },
    };

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ project: staleProject, mediaFiles: {} }),
    }));

    const project = await backendSaveService.load("project-1");

    expect(project?.mediaLibrary.items[0]?.thumbnailUrl).toBeNull();
    expect(project?.mediaLibrary.items[0]?.filmstripThumbnails).toBeUndefined();
  });
});

describe("backendSaveService.save", () => {
  const persistedResponse = () => ({
    ok: true,
    json: async () => ({
      saved: true,
      projectId: "vintage-tokyo",
      persistedAt: 1234,
      sourceModifiedAt: 2,
    }),
  });

  it("schedules a backend PUT without waiting for an IndexedDB save event", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      return {
        ok: true,
        json: async () => ({
          saved: true,
          projectId: "vintage-tokyo",
          persistedAt: 1234,
          sourceModifiedAt: body.modifiedAt,
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    backendSaveService.scheduleSave({ ...makeProject(), id: "vintage-tokyo" }, 100);
    expect(fetchMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4041/api/projects/vintage-tokyo",
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("cannot starve a backend PUT when project mutations keep resetting the debounce", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      return {
        ok: true,
        json: async () => ({
          saved: true,
          projectId: "vintage-tokyo",
          persistedAt: 1234,
          sourceModifiedAt: body.modifiedAt,
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    for (let second = 0; second < 8; second += 1) {
      backendSaveService.scheduleSave(
        { ...makeProject(), id: "vintage-tokyo", modifiedAt: second },
        2_000,
      );
      await vi.advanceTimersByTimeAsync(1_000);
    }

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4041/api/projects/vintage-tokyo",
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("fails visibly if a queued save exceeds its deadline", async () => {
    vi.useFakeTimers();
    const service = backendSaveService as unknown as { maxScheduleWaitMs: number };
    service.maxScheduleWaitMs = 10_000;
    useNotificationStore.getState().clearAll();

    backendSaveService.scheduleSave(
      { ...makeProject(), id: "vintage-tokyo" },
      10_000,
    );
    await vi.advanceTimersByTimeAsync(7_000);

    expect(usePersistenceStatusStore.getState()).toMatchObject({
      phase: "failed",
      projectId: "vintage-tokyo",
      error: expect.stringContaining("no backend PUT began"),
    });
    expect(useNotificationStore.getState().notifications.at(-1)).toMatchObject({
      type: "error",
      title: "Backend persistence queue timed out",
    });
    service.maxScheduleWaitMs = 5_000;
  });

  it("retries a failed scheduled PUT without requiring another edit", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("temporary outage"))
      .mockResolvedValue(persistedResponse());
    vi.stubGlobal("fetch", fetchMock);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    backendSaveService.scheduleSave({ ...makeProject(), id: "vintage-tokyo" }, 0);
    await vi.runAllTimersAsync();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    consoleError.mockRestore();
  });

  it("does not PUT client-only UUID project ids to the backend", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await backendSaveService.save({
      ...makeProject(),
      id: "14aec9eb-469f-4db6-9652-00dee0d243fc",
      name: "Vintage Tokyo",
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("PUTs slug project ids to the backend", async () => {
    const fetchMock = vi.fn().mockResolvedValue(persistedResponse());
    vi.stubGlobal("fetch", fetchMock);

    await backendSaveService.save({ ...makeProject(), id: "vintage-tokyo" });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4041/api/projects/vintage-tokyo",
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("persists durable filmstrip thumbnails but strips page-scoped blob URLs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(persistedResponse());
    vi.stubGlobal("fetch", fetchMock);

    await backendSaveService.save({
      ...makeProject(),
      id: "vintage-tokyo",
      mediaLibrary: {
        items: [{
          ...makeProject().mediaLibrary.items[0]!,
          filmstripThumbnails: [
            { timestamp: 0, url: "data:image/jpeg;base64,frame" },
            { timestamp: 5, url: "https://cdn.example/frame.jpg" },
          ],
        }],
      },
    });

    const body = JSON.parse(fetchMock.mock.calls.at(-1)?.[1]?.body as string);
    expect(body.mediaLibrary.items[0].filmstripThumbnails).toHaveLength(2);

    await backendSaveService.save({
      ...makeProject(),
      id: "vintage-tokyo",
      mediaLibrary: {
        items: [{
          ...makeProject().mediaLibrary.items[0]!,
          filmstripThumbnails: [{ timestamp: 0, url: "blob:session-only" }],
        }],
      },
    });

    const blobBody = JSON.parse(fetchMock.mock.calls.at(-1)?.[1]?.body as string);
    expect(blobBody.mediaLibrary.items[0].filmstripThumbnails).toBeUndefined();
  });

  it("uploads media blobs before saving project JSON", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") calls.push("media");
      if (init?.method === "PUT") calls.push("project");
      return init?.method === "PUT" ? persistedResponse() : { ok: true };
    });
    vi.stubGlobal("fetch", fetchMock);

    await backendSaveService.save({
      ...makeProject(),
      id: "vintage-tokyo",
      mediaLibrary: {
        items: [
          {
            ...makeProject().mediaLibrary.items[0]!,
            blob: new Blob(["clip"], { type: "video/mp4" }),
          },
        ],
      },
    });

    expect(calls).toEqual(["media", "project"]);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://localhost:4041/api/projects/vintage-tokyo/media/media-1",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://localhost:4041/api/projects/vintage-tokyo",
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("does not re-upload blobs that were loaded from the same backend project", async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "HEAD" ? { ok: true, status: 200 } : persistedResponse()
    );
    vi.stubGlobal("fetch", fetchMock);

    await backendSaveService.save({
      ...makeProject(),
      id: "vintage-tokyo",
      mediaLibrary: {
        items: [{
          ...makeProject().mediaLibrary.items[0]!,
          blob: new Blob(["already remote"], { type: "video/mp4" }),
          remoteUrl: "http://localhost:4041/api/projects/vintage-tokyo/media/media-1.mp4",
        }],
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4041/api/projects/vintage-tokyo",
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("re-uploads a blob when its backend URL is no longer current", async () => {
    const methods: string[] = [];
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      methods.push(init?.method ?? "GET");
      if (init?.method === "HEAD") return { ok: false, status: 404 };
      if (init?.method === "POST") return { ok: true };
      return persistedResponse();
    });
    vi.stubGlobal("fetch", fetchMock);

    await backendSaveService.save({
      ...makeProject(),
      id: "vintage-tokyo",
      mediaLibrary: {
        items: [{
          ...makeProject().mediaLibrary.items[0]!,
          blob: new Blob(["needs upload"], { type: "video/mp4" }),
          remoteUrl: "http://localhost:4041/api/projects/vintage-tokyo/media/media-1.mp4",
        }],
      },
    });

    expect(methods).toEqual(["HEAD", "POST", "PUT"]);
  });
});

describe("backendSaveService.uploadMediaAsync", () => {
  it("does not upload media for client-only UUID project ids", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    backendSaveService.uploadMediaAsync(
      "14aec9eb-469f-4db6-9652-00dee0d243fc",
      "media-1",
      new Blob(["clip"]),
      "clip.mp4",
    );

    expect(fetchMock).not.toHaveBeenCalled();
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
        text: async () => "branch collision",
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
        text: async () => "",
      }),
    );

    await expect(backendSaveService.create("Doomed")).rejects.toThrow(
      "Backend create failed: HTTP 502",
    );
  });
});
