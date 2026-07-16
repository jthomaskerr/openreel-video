import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, ProjectSaveReceipt } from "@openreel/core";
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

const makeReceipt = (
  overrides: Partial<ProjectSaveReceipt> = {},
): ProjectSaveReceipt => ({
  saved: true,
  projectId: "vintage-tokyo",
  persistedAt: 1_234,
  sourceModifiedAt: 2,
  commitSha: "0123456789abcdef0123456789abcdef01234567",
  treeSha: "89abcdef0123456789abcdef0123456789abcdef",
  projectBlobSha: "fedcba9876543210fedcba9876543210fedcba98",
  mediaManifestDigest: "sha256:manifest-digest",
  lfsPayloads: [],
  committed: true,
  commitDueAt: null,
  ...overrides,
});

const makeBackendProjectResponse = (
  project: Project,
  mediaFiles: Record<string, string> = {},
) => ({
  project,
  mediaFiles,
  ...makeReceipt({ projectId: project.id, sourceModifiedAt: project.modifiedAt }),
});

const makeSaveProject = (): Project => ({
  ...makeProject(),
  id: "vintage-tokyo",
  mediaLibrary: { items: [] },
});

beforeEach(() => {
  usePersistenceStatusStore.getState().confirmReceipt(
    "vintage-tokyo",
    makeReceipt({ sourceModifiedAt: 1 }),
  );
});

afterEach(() => {
  backendSaveService.resetForProject();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("backendSaveService.load", () => {
  it("preserves a matching confirmed base while clearing project-scoped queues", () => {
    const receipt = makeReceipt();
    usePersistenceStatusStore.getState().confirmReceipt("project-1", receipt);

    backendSaveService.resetForProject("project-1");
    expect(usePersistenceStatusStore.getState().baseRevision?.commitSha).toBe(receipt.commitSha);

    backendSaveService.resetForProject("another-project");
    expect(usePersistenceStatusStore.getState().baseRevision).toBeNull();
  });

  it("populates remoteUrl and blob for media files returned by the backend", async () => {
    const mediaBlob = new Blob(["video"], { type: "video/mp4" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        if (url.endsWith("/media/clip.mp4")) {
          return { ok: true, blob: async () => mediaBlob };
        }

        return {
          ok: true,
          json: async () => makeBackendProjectResponse(
            makeProject(),
            { "media-1": "clip.mp4" },
          ),
        };
      }),
    );

    const project = await backendSaveService.load("project-1");

    expect(project?.mediaLibrary.items[0]?.remoteUrl).toBe(
      "http://localhost:4041/api/projects/project-1/media/clip.mp4",
    );
    expect(project?.mediaLibrary.items[0]?.blob).toBe(mediaBlob);
    expect(project?.mediaLibrary.items[1]?.remoteUrl).toBeUndefined();
    expect(usePersistenceStatusStore.getState()).toMatchObject({
      projectId: "project-1",
      baseRevision: { commitSha: makeReceipt().commitSha },
    });
  });

  it("regenerates persisted video thumbnails from the backend URL instead of a WebKit-incompatible blob URL", async () => {
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
    mockGenerateThumbnailFromUrl.mockResolvedValueOnce("data:image/jpeg;base64,regenerated");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        if (url.endsWith("/media/clip.mp4")) {
          return { ok: true, blob: async () => mediaBlob };
        }

        return {
          ok: true,
          json: async () => makeBackendProjectResponse(
            staleProject,
            { "media-1": "clip.mp4" },
          ),
        };
      }),
    );

    const project = await backendSaveService.load("project-1");

    expect(mockGenerateThumbnailFromUrl).toHaveBeenCalledWith(
      "http://localhost:4041/api/projects/project-1/media/clip.mp4",
      "video",
    );
    expect(mockGenerateThumbnailFromBlob).not.toHaveBeenCalled();
    expect(project?.mediaLibrary.items[0]?.thumbnailUrl).toBe(
      "data:image/jpeg;base64,regenerated",
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
      json: async () => makeBackendProjectResponse(staleProject),
    }));

    const project = await backendSaveService.load("project-1");

    expect(project?.mediaLibrary.items[0]?.thumbnailUrl).toBeNull();
    expect(project?.mediaLibrary.items[0]?.filmstripThumbnails).toBeUndefined();
  });
});

describe("backendSaveService.save", () => {
  const persistedResponse = () => ({
    ok: true,
    json: async () => ({ project: makeSaveProject(), ...makeReceipt() }),
  });

  it("does not PUT a snapshot whose original cannot be proven", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const project = {
      ...makeSaveProject(),
      mediaLibrary: { items: [makeProject().mediaLibrary.items[0]!] },
    };

    await expect(backendSaveService.save(project)).rejects.toThrow("original is unavailable");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(usePersistenceStatusStore.getState()).toMatchObject({
      phase: "incomplete",
      projectId: "vintage-tokyo",
      error: expect.stringContaining("media-1"),
    });
  });

  it.each([
    ["wrong byte size", { "content-length": "99", "content-type": "video/mp4" }],
    ["HTML body metadata", { "content-length": "100", "content-type": "text/html" }],
  ])("rejects a 200 HEAD false proof with %s", async (_label, headers) => {
    const project = {
      ...makeSaveProject(),
      mediaLibrary: {
        items: [{
          ...makeProject().mediaLibrary.items[0]!,
          remoteUrl: "http://localhost:4041/api/projects/vintage-tokyo/media/clip.mp4",
        }],
      },
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(headers),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(backendSaveService.save(project)).rejects.toThrow("original is unavailable");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
  });

  it("rejects a remote URL outside the exact project media path without issuing HEAD", async () => {
    const project = {
      ...makeSaveProject(),
      mediaLibrary: {
        items: [{
          ...makeProject().mediaLibrary.items[0]!,
          remoteUrl: "http://localhost:4041/api/projects/other-project/media/clip.mp4",
        }],
      },
    };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(backendSaveService.save(project)).rejects.toThrow("original is unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reuploads when an authoritative HEAD says a session-uploaded id is absent", async () => {
    const blob = new Blob(["clip"], { type: "video/mp4" });
    const project = {
      ...makeSaveProject(),
      mediaLibrary: { items: [{ ...makeProject().mediaLibrary.items[0]!, blob }] },
    };
    const remoteProject = {
      ...project,
      mediaLibrary: {
        items: [{
          ...project.mediaLibrary.items[0]!,
          remoteUrl: "http://localhost:4041/api/projects/vintage-tokyo/media/clip.mp4",
        }],
      },
    };
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") return { ok: false, status: 404 };
      if (init?.method === "POST") return { ok: true, json: async () => ({ pending: true, mediaId: "media-1", originalFilename: "clip.mp4", byteSize: 4 }) };
      return { ok: true, json: async () => ({ project: remoteProject, ...makeReceipt() }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    await backendSaveService.save(project);
    await backendSaveService.save(remoteProject);

    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2);
  });

  it("sends confirmed base and intent, then confirms the canonical response project", async () => {
    const project = {
      ...makeSaveProject(),
      mediaLibrary: {
        items: [{
          ...makeProject().mediaLibrary.items[0]!,
          blob: new Blob(["clip"], { type: "video/mp4" }),
        }],
      },
    };
    const canonicalProject = {
      ...project,
      mediaLibrary: {
        items: [{ ...makeProject().mediaLibrary.items[0]!, name: "City Walk 2.mp4" }],
      },
    };
    const nextReceipt = makeReceipt({
      commitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      sourceModifiedAt: project.modifiedAt,
    });
    let requestBody: Record<string, unknown> | undefined;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return { ok: true, json: async () => ({ pending: true, mediaId: "media-1" }) };
      }
      requestBody = JSON.parse(String(init?.body));
      return { ok: true, json: async () => ({ project: canonicalProject, ...nextReceipt }) };
    }));

    await backendSaveService.save(project, "user");

    expect(requestBody).toMatchObject({
      projectId: "vintage-tokyo",
      saveIntent: "user",
      baseRevision: { commitSha: makeReceipt().commitSha },
      requiredMediaManifest: [{
        mediaId: "media-1",
        semanticFilename: "clip.mp4",
        relativePhysicalPath: "media/clip.mp4",
        expectedByteSize: 4,
      }],
    });
    expect(usePersistenceStatusStore.getState()).toMatchObject({
      phase: "persisted",
      confirmedReceipt: nextReceipt,
      baseRevision: { commitSha: nextReceipt.commitSha },
    });
    expect(project.mediaLibrary.items[0]?.name).toBe("City Walk 2.mp4");
  });

  it("does not apply canonical filenames or advance base until the whole receipt validates", async () => {
    const project = {
      ...makeSaveProject(),
      mediaLibrary: {
        items: [{
          ...makeProject().mediaLibrary.items[0]!,
          blob: new Blob(["clip"], { type: "video/mp4" }),
        }],
      },
    };
    const canonical = {
      ...project,
      mediaLibrary: {
        items: [{ ...project.mediaLibrary.items[0]!, name: "Canonical.mp4" }],
      },
    };
    const previousReceipt = usePersistenceStatusStore.getState().confirmedReceipt;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? { ok: true, json: async () => ({ pending: true, mediaId: "media-1" }) }
        : {
            ok: true,
            json: async () => ({
              project: canonical,
              ...makeReceipt({ persistedAt: null }),
            }),
          }
    ));

    await expect(backendSaveService.save(project)).rejects.toThrow("invalid committed persistence response");

    expect(project.mediaLibrary.items[0]?.name).toBe("clip.mp4");
    expect(usePersistenceStatusStore.getState().confirmedReceipt).toBe(previousReceipt);
  });

  it("rejects a committed receipt whose LFS payload is not locally verified", async () => {
    const project = makeSaveProject();
    const previousReceipt = usePersistenceStatusStore.getState().confirmedReceipt;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        project,
        ...makeReceipt({
          lfsPayloads: [{
            mediaId: "media-1",
            semanticFilename: "clip.mp4",
            relativePhysicalPath: "media/clip.mp4",
            oid: "sha256:abc",
            pointerSize: 128,
            local: { state: "missing", actualSize: null },
            remote: { state: "local-only", remote: null },
          }],
        }),
      }),
    }));

    await expect(backendSaveService.save(project)).rejects.toThrow("invalid committed persistence response");
    expect(usePersistenceStatusStore.getState().confirmedReceipt).toBe(previousReceipt);
  });

  it("recovers MEDIA_INCOMPLETE once, rebuilds the snapshot, and retries non-recursively", async () => {
    const recovered = new Blob(["recovered"], { type: "video/mp4" });
    const getFile = vi.fn().mockResolvedValue(recovered);
    const project = {
      ...makeSaveProject(),
      mediaLibrary: {
        items: [{
          ...makeProject().mediaLibrary.items[0]!,
          fileHandle: { getFile } as unknown as FileSystemFileHandle,
          remoteUrl: "http://localhost:4041/api/projects/vintage-tokyo/media/clip.mp4",
        }],
      },
    };
    const putBodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "content-length": "100", "content-type": "video/mp4" }),
        };
      }
      if (init?.method === "POST") {
        return { ok: true, json: async () => ({ pending: true, mediaId: "media-1" }) };
      }
      putBodies.push(JSON.parse(String(init?.body)));
      if (putBodies.length === 1) {
        return {
          ok: false,
          status: 409,
          text: async () => JSON.stringify({
            code: "MEDIA_INCOMPLETE",
            missingItems: [{ mediaId: "media-1" }],
          }),
        };
      }
      return { ok: true, json: async () => ({ project, ...makeReceipt() }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    await backendSaveService.save(project);

    expect(getFile).toHaveBeenCalledTimes(1);
    expect(putBodies).toHaveLength(2);
    expect(putBodies.map((body) => body.saveIntent)).toEqual(["autosave", "recovery"]);
  });

  it("stops after the single MEDIA_INCOMPLETE recovery retry", async () => {
    const project = {
      ...makeSaveProject(),
      mediaLibrary: {
        items: [{
          ...makeProject().mediaLibrary.items[0]!,
          blob: new Blob(["clip"], { type: "video/mp4" }),
        }],
      },
    };
    let putCount = 0;
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return { ok: true, json: async () => ({ pending: true, mediaId: "media-1" }) };
      }
      putCount += 1;
      return {
        ok: false,
        status: 409,
        text: async () => JSON.stringify({
          code: "MEDIA_INCOMPLETE",
          missingItems: [{ mediaId: "media-1" }],
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(backendSaveService.save(project)).rejects.toThrow("retry exhausted");

    expect(putCount).toBe(2);
  });

  it("surfaces PROJECT_CONFLICT and preserves the newer server project without advancing base", async () => {
    const newerProject = { ...makeSaveProject(), name: "Newer server project", modifiedAt: 99 };
    const originalBase = usePersistenceStatusStore.getState().baseRevision;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        text: async () => JSON.stringify({ code: "PROJECT_CONFLICT" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ project: newerProject, mediaFiles: {} }),
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(backendSaveService.save(makeSaveProject())).rejects.toThrow("Project conflict");

    expect(usePersistenceStatusStore.getState()).toMatchObject({
      phase: "conflict",
      conflictingProject: newerProject,
      baseRevision: originalBase,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("treats a modifiedAt-only backend write as deferred rather than Git-persisted", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ...makeReceipt({
          committed: false,
          commitDueAt: null,
        }),
        project: makeSaveProject(),
      }),
    }));

    await backendSaveService.save(makeSaveProject());

    expect(usePersistenceStatusStore.getState()).toMatchObject({
      phase: "deferred",
      projectId: "vintage-tokyo",
      persistedAt: 1_234,
      baseRevision: {
        sourceModifiedAt: 2,
      },
    });
  });

  it("schedules a backend PUT without waiting for an IndexedDB save event", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      return {
        ok: true,
        json: async () => makeReceipt({ sourceModifiedAt: body.project.modifiedAt }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    backendSaveService.scheduleSave(makeSaveProject(), 100);
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
        json: async () => makeReceipt({ sourceModifiedAt: body.project.modifiedAt }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    for (let second = 0; second < 8; second += 1) {
      backendSaveService.scheduleSave(
        { ...makeSaveProject(), modifiedAt: second },
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
      makeSaveProject(),
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

    backendSaveService.scheduleSave(makeSaveProject(), 0);
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
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "HEAD"
        ? {
            ok: true,
            status: 200,
            headers: new Headers({ "content-length": "100", "content-type": "video/mp4" }),
          }
        : persistedResponse()
    );
    vi.stubGlobal("fetch", fetchMock);

    await backendSaveService.save(makeSaveProject());

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4041/api/projects/vintage-tokyo",
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("persists durable filmstrip thumbnails but strips page-scoped blob URLs", async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "HEAD"
        ? {
            ok: true,
            status: 200,
            headers: new Headers({ "content-length": "100", "content-type": "video/mp4" }),
          }
        : persistedResponse()
    );
    vi.stubGlobal("fetch", fetchMock);

    await backendSaveService.save({
      ...makeSaveProject(),
      mediaLibrary: {
        items: [{
          ...makeProject().mediaLibrary.items[0]!,
          remoteUrl: "http://localhost:4041/api/projects/vintage-tokyo/media/clip.mp4",
          filmstripThumbnails: [
            { timestamp: 0, url: "data:image/jpeg;base64,frame" },
            { timestamp: 5, url: "https://cdn.example/frame.jpg" },
          ],
        }],
      },
    });

    const body = JSON.parse(fetchMock.mock.calls.at(-1)?.[1]?.body as string);
    expect(body.project.mediaLibrary.items[0].filmstripThumbnails).toHaveLength(2);

    await backendSaveService.save({
      ...makeSaveProject(),
      mediaLibrary: {
        items: [{
          ...makeProject().mediaLibrary.items[0]!,
          remoteUrl: "http://localhost:4041/api/projects/vintage-tokyo/media/clip.mp4",
          filmstripThumbnails: [{ timestamp: 0, url: "blob:session-only" }],
        }],
      },
    });

    const blobBody = JSON.parse(fetchMock.mock.calls.at(-1)?.[1]?.body as string);
    expect(blobBody.project.mediaLibrary.items[0].filmstripThumbnails).toBeUndefined();
  });

  it("uploads media blobs before saving project JSON", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") calls.push("media");
      if (init?.method === "PUT") calls.push("project");
      return init?.method === "PUT"
        ? persistedResponse()
        : { ok: true, json: async () => ({ pending: true, mediaId: "media-1" }) };
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
      init?.method === "HEAD"
        ? {
            ok: true,
            status: 200,
            headers: new Headers({ "content-length": "100", "content-type": "video/mp4" }),
          }
        : persistedResponse()
    );
    vi.stubGlobal("fetch", fetchMock);

    await backendSaveService.save({
      ...makeProject(),
      id: "vintage-tokyo",
      mediaLibrary: {
        items: [{
          ...makeProject().mediaLibrary.items[0]!,
          blob: new Blob(["already remote"], { type: "video/mp4" }),
          remoteUrl: "http://localhost:4041/api/projects/vintage-tokyo/media/clip.mp4",
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
      if (init?.method === "POST") {
        return { ok: true, json: async () => ({ pending: true, mediaId: "media-1" }) };
      }
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
          remoteUrl: "http://localhost:4041/api/projects/vintage-tokyo/media/clip.mp4",
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
        json: async () => ({
          project: returned,
          ...makeReceipt({ projectId: returned.id, sourceModifiedAt: returned.modifiedAt }),
        }),
      }),
    );

    const project = await backendSaveService.create("My New Project");

    expect(project.id).toBe("my-new-project");
    expect(project.name).toBe("My New Project");
    expect(usePersistenceStatusStore.getState().baseRevision?.commitSha).toBe(makeReceipt().commitSha);
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
          json: async () => ({
            project: returned,
            ...makeReceipt({ projectId: returned.id, sourceModifiedAt: returned.modifiedAt }),
          }),
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
