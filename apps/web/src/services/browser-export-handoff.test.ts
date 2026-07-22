import { afterEach, describe, expect, it, vi } from "vitest";
import { createHandoffFixtureProject } from "../../../../packages/core/src/export/handoff/__fixtures__/projects";
import { createBrowserHandoffDependencies } from "./browser-export-handoff";
import { loadMediaBlob } from "./media-storage";
import { requestMediaVerification } from "./media-verification";

vi.mock("./media-storage", () => ({ loadMediaBlob: vi.fn() }));
vi.mock("./media-verification", () => ({ requestMediaVerification: vi.fn() }));

const loadMediaBlobMock = vi.mocked(loadMediaBlob);
const verifyMock = vi.mocked(requestMediaVerification);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  loadMediaBlobMock.mockReset();
  verifyMock.mockReset();
  delete (window as Window & { showDirectoryPicker?: unknown }).showDirectoryPicker;
});

describe("browser handoff adapters", () => {
  it("uses live, persisted, file-handle, then verified URL media recovery without repeating inspection work", async () => {
    const base = createHandoffFixtureProject().mediaLibrary.items[0];
    const liveBlob = new Blob(["live"], { type: "video/quicktime" });
    const live = { ...base, id: "live", blob: liveBlob, fileHandle: null };
    const persisted = { ...base, id: "persisted", blob: null, fileHandle: null };
    const persistedBlob = new Blob(["persisted"], { type: "video/quicktime" });
    const file = new File(["file"], "file.mov", { type: "video/quicktime" });
    const fileHandle = {
      queryPermission: vi.fn(async () => "granted" as PermissionState),
      requestPermission: vi.fn(),
      getFile: vi.fn(async () => file),
    } as unknown as FileSystemFileHandle;
    const retained = { ...base, id: "retained", blob: null, fileHandle };
    const remote = { ...base, id: "remote", blob: null, fileHandle: null, remoteUrl: "/media/remote.mov" };
    loadMediaBlobMock.mockImplementation(async (id) => id === "persisted" ? persistedBlob : null);
    verifyMock.mockResolvedValue({
      projectId: "project-1",
      outcomes: [{ mediaId: "remote", status: "available", evidence: { authoritative: true, mapping: "present", object: "present" } }],
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "content-type": "video/quicktime", "content-length": "3" },
    })));
    const dependencies = createBrowserHandoffDependencies("project-1");
    const signal = new AbortController().signal;

    await expect(dependencies.mediaResolver.inspect(live, signal)).resolves.toMatchObject({ source: "blob" });
    expect(loadMediaBlobMock).not.toHaveBeenCalled();
    await expect(dependencies.mediaResolver.inspect(persisted, signal)).resolves.toMatchObject({ source: "persisted-blob" });
    await expect(dependencies.mediaResolver.inspect(retained, signal)).resolves.toMatchObject({ source: "file-handle" });
    await expect(dependencies.mediaResolver.inspect(remote, signal)).resolves.toMatchObject({ source: "verified-url" });
    const persistedCalls = loadMediaBlobMock.mock.calls.filter(([id]) => id === "persisted").length;
    await expect(dependencies.mediaResolver.open(persisted, signal)).resolves.toMatchObject({ mediaId: "persisted" });
    expect(loadMediaBlobMock.mock.calls.filter(([id]) => id === "persisted")).toHaveLength(persistedCalls);
  });

  it("requires explicit confirmation for an existing Resolve folder", async () => {
    const existing = {} as FileSystemDirectoryHandle;
    const parent = {
      getDirectoryHandle: vi.fn(async () => existing),
    } as unknown as FileSystemDirectoryHandle;
    (window as unknown as Window & { showDirectoryPicker(): Promise<FileSystemDirectoryHandle> }).showDirectoryPicker = vi.fn(async () => parent);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const dependencies = createBrowserHandoffDependencies("project-1");
    await expect(dependencies.resolveDestination.createProjectDirectory("Safe Project")).rejects.toMatchObject({ name: "AbortError" });
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("Safe Project"));
  });

  it("surfaces denied handle permission and failed URL verification as unavailable", async () => {
    const base = createHandoffFixtureProject().mediaLibrary.items[0];
    const deniedHandle = {
      queryPermission: vi.fn(async () => "denied" as PermissionState),
      requestPermission: vi.fn(),
      getFile: vi.fn(),
    } as unknown as FileSystemFileHandle;
    const media = {
      ...base,
      id: "denied-remote",
      blob: null,
      fileHandle: deniedHandle,
      remoteUrl: "/media/denied.mov",
    };
    loadMediaBlobMock.mockResolvedValue(null);
    verifyMock.mockResolvedValue({
      projectId: "project-1",
      outcomes: [{ mediaId: media.id, status: "unauthorized", evidence: { authoritative: false, mapping: "unknown", object: "unknown" } }],
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const dependencies = createBrowserHandoffDependencies("project-1");
    await expect(
      dependencies.mediaResolver.inspect(media, new AbortController().signal),
    ).resolves.toEqual({ available: false });
    expect(deniedHandle.getFile).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects plain and encoded traversal before creating any artifact handle", async () => {
    const root = { getDirectoryHandle: vi.fn(), getFileHandle: vi.fn() } as unknown as FileSystemDirectoryHandle;
    const parent = {
      getDirectoryHandle: vi.fn(async (_name: string, options?: { create?: boolean }) => {
        if (!options?.create) throw new DOMException("missing", "NotFoundError");
        return root;
      }),
    } as unknown as FileSystemDirectoryHandle;
    (window as unknown as Window & { showDirectoryPicker(): Promise<FileSystemDirectoryHandle> }).showDirectoryPicker = vi.fn(async () => parent);
    const dependencies = createBrowserHandoffDependencies("project-1");
    const writer = await dependencies.resolveDestination.createProjectDirectory("Safe Project");
    const signal = new AbortController().signal;
    await expect(writer.write("../escape.mov", "bad", signal)).rejects.toThrow(/stay inside/i);
    await expect(writer.write("Media/%2e%2e/escape.mov", "bad", signal)).rejects.toThrow(/stay inside/i);
    expect(root.getFileHandle).not.toHaveBeenCalled();
  });
});
