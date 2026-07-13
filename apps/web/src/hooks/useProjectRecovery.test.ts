import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useProjectRecovery } from "./useProjectRecovery";
import { useProjectStore } from "../stores/project-store";
import type { AutoSaveMetadata } from "../services/auto-save";
import type { MediaItem, Project } from "@openreel/core";

// ---------------------------------------------------------------------------
// Hoisted mock factories (must precede vi.mock calls)
// ---------------------------------------------------------------------------
const {
  mockAutoSaveRecover,
  mockBackendLoad,
  mockCheckForRecovery,
  mockLoadProjectMedia,
  mockSaveMediaBlob
} = vi.hoisted(() => ({
  mockAutoSaveRecover: vi.fn<[], Promise<Project | null>>(),
  mockBackendLoad: vi.fn<[string], Promise<Project | null>>().mockResolvedValue(null),
  mockCheckForRecovery: vi
    .fn<[], Promise<AutoSaveMetadata[]>>()
    .mockResolvedValue([]),
  mockLoadProjectMedia: vi
    .fn<
      [string],
      Promise<Array<{ id: string; projectId: string; blob: Blob; metadata: unknown }>>
    >()
    .mockResolvedValue([]),
  mockSaveMediaBlob: vi.fn<unknown[], Promise<void>>().mockResolvedValue(undefined)
}));
vi.mock("../services/backend-save", () => ({
  isClientOnlyProjectId: (projectId: string) => /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(projectId),
  backendSaveService: {
    load: (...args: unknown[]) => mockBackendLoad(...(args as [string])),
    create: vi.fn().mockResolvedValue({ id: "mock-backend-project", createdAt: 0, modifiedAt: 0 }),
    uploadMediaAsync: vi.fn(),
    resetForProject: vi.fn(),
    save: vi.fn().mockResolvedValue(undefined),
    isReachable: vi.fn().mockResolvedValue(true)
  }
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
vi.mock("../services/auto-save", () => ({
  autoSaveManager: {
    markPendingProjectCreation: vi.fn(),
    clearPendingProjectCreation: vi.fn(),
    migrateProjectId: vi.fn().mockResolvedValue(undefined),
    getPendingProjectCreation: vi.fn().mockReturnValue(null),
    initialize: vi.fn().mockResolvedValue(undefined),
    checkForRecovery: (...args: unknown[]) => mockCheckForRecovery(...(args as [])),
    recover: (...args: unknown[]) => mockAutoSaveRecover(...(args as [])),
    clearAllSaves: vi.fn().mockResolvedValue(undefined),
    start: vi.fn(),
    markDirty: vi.fn(),
    forceSave: vi.fn().mockResolvedValue(undefined)
  },
  initializeAutoSave: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../services/media-storage", () => ({
  saveMediaBlob: (...args: unknown[]) => mockSaveMediaBlob(...args),
  deleteMediaBlob: vi.fn().mockResolvedValue(undefined),
  loadProjectMedia: (...args: unknown[]) => mockLoadProjectMedia(...(args as [string])),
  clearAllStorage: vi.fn().mockResolvedValue(undefined),
  loadFileHandle: vi.fn().mockResolvedValue(null),
  loadDirectoryHandle: vi.fn().mockResolvedValue(null)
}));

vi.mock("../bridges/effects-bridge", () => ({
  getEffectsBridge: vi.fn(() => ({
    isInitialized: vi.fn(() => false),
    deserializeEffects: vi.fn(),
    clearEffects: vi.fn(),
    getColorGrading: vi.fn(() => ({})),
    resetColorGrading: vi.fn(() => ({ success: true })),
    applyVideoEffect: vi.fn(() => ({ success: false })),
    removeVideoEffect: vi.fn(),
    getEffect: vi.fn(() => null),
    getEffects: vi.fn(() => [])
  }))
}));

vi.mock("../bridges/transition-bridge", () => ({
  getTransitionBridge: vi.fn(() => ({
    isInitialized: vi.fn(() => false),
    setTransitionsForTrack: vi.fn(),
    clearTransitionsForTrack: vi.fn()
  }))
}));

vi.mock("../bridges/media-bridge", () => ({
  getMediaBridge: vi.fn(() => ({
    isInitialized: vi.fn().mockReturnValue(true),
    importFile: vi.fn().mockResolvedValue({ success: true, media: null }),
    generateThumbnailsForMedia: vi.fn().mockResolvedValue([])
  })),
  initializeMediaBridge: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../services/project-manager", () => ({
  projectManager: {
    initialize: vi.fn().mockResolvedValue(undefined),
    addToRecent: vi.fn().mockResolvedValue(undefined),
    getRecentProjects: vi.fn().mockResolvedValue([])
  }
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
function makeMediaItem(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    id: "media-1",
    name: "clip.mp3",
    type: "audio", // audio avoids DOM thumbnail generation
    fileHandle: null,
    blob: null,
    metadata: {
      duration: 10,
      width: 0,
      height: 0,
      frameRate: 0,
      codec: "mp3",
      sampleRate: 44100,
      channels: 2,
      fileSize: 1000
    },
    thumbnailUrl: null,

    ...overrides
  };
}

function makeProject(overrides: {
  name?: string;
  mediaItems?: MediaItem[];
} = {}): Project {
  return {
    id: "test-project-id",
    name: overrides.name ?? "Test Project",
    createdAt: 1000,
    modifiedAt: 2000,
    settings: {
      width: 1920,
      height: 1080,
      frameRate: 30,
      sampleRate: 48000,
      channels: 2
    },
    mediaLibrary: { items: overrides.mediaItems ?? [] },
    timeline: {
      tracks: [],
      subtitles: [],
      duration: 0,
      markers: []
    }
  };
}

function makeSave(
  overrides: Partial<AutoSaveMetadata> = {},
): AutoSaveMetadata {
  return {
    id: "save-1",
    projectId: "test-project-id",
    projectName: "Test Project",
    timestamp: Date.now(),
    slot: 0,
    isRecovery: true,
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// Store-level regression tests
// These call useProjectStore.getState().recoverFromAutoSave directly so they
// isolate the store logic from hook concerns.
// ---------------------------------------------------------------------------
describe("recoverFromAutoSave — store regression", () => {
  beforeEach(() => {
    mockAutoSaveRecover.mockReset();
    mockLoadProjectMedia.mockReset().mockResolvedValue([]);
    useProjectStore.getState().createNewProject();
  });

  it("regression: JSON-deserialized {} blob treated as real Blob when no stored blob exists — media silently broken", async () => {
    // After JSON.parse a saved project, Blob/File fields become {} (an empty
    // truthy object) rather than null.  restoreMediaItem's null-guard
    //   `if (!blob) return item;`
    // is bypassed, so the media item carries an invalid {} blob instead of
    // being correctly marked as missing.
    const deserializedProject = makeProject({
      mediaItems: [
        makeMediaItem({
          blob: {} as unknown as Blob, // simulates JSON.parse output for a File/Blob
        }),
      ]
    });

    mockAutoSaveRecover.mockResolvedValue(deserializedProject);
    // No stored blob — the blob was never persisted to media storage.
    mockLoadProjectMedia.mockResolvedValue([]);

    const success = await useProjectStore
      .getState()
      .recoverFromAutoSave("save-1");

    expect(success).toBe(true);
    const item = useProjectStore.getState().project.mediaLibrary.items[0];
    // Without fix: item.blob === {} (truthy but invalid — media appears broken)
    // With fix:    item.blob === null (correctly missing)
    expect(item?.blob).toBeNull();
  });

  it("regression: recoverFromAutoSave propagates unhandled rejection when autoSaveManager.recover fails", async () => {
    mockAutoSaveRecover.mockRejectedValue(new Error("IndexedDB unavailable"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    let threw = false;
    let result: boolean | undefined;
    try {
      result = await useProjectStore.getState().recoverFromAutoSave("save-1");
    } catch {
      threw = true;
    }

    // Without try-catch: threw === true (unhandled rejection surfaces to caller)
    expect(threw).toBe(false);
    expect(result).toBe(false);
    consoleError.mockRestore();
  });

  it("sets error state in the store when recovery fails", async () => {
    mockAutoSaveRecover.mockRejectedValue(new Error("DB read error"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    // May throw before the fix; catch so the assertion below runs in both states.
    try {
      await useProjectStore.getState().recoverFromAutoSave("save-1");
    } catch {
      /* expected before fix */
    }

    // Without fix: error is null (error never stored)
    expect(useProjectStore.getState().error).toMatch(/DB read error/);
    consoleError.mockRestore();
  });

  it("attaches stored blob from media-storage to the recovered media item", async () => {
    const storedBlob = new Blob(["audio-data"], { type: "audio/mpeg" });
    const deserializedProject = makeProject({
      mediaItems: [
        makeMediaItem({ blob: {} as unknown as Blob }),
      ]
    });

    mockAutoSaveRecover.mockResolvedValue(deserializedProject);
    mockLoadProjectMedia.mockResolvedValue([
      {
        id: "media-1",
        projectId: deserializedProject.id,
        blob: storedBlob,
        metadata: {}
      },
    ]);

    const success = await useProjectStore
      .getState()
      .recoverFromAutoSave("save-1");

    expect(success).toBe(true);
    const item = useProjectStore.getState().project.mediaLibrary.items[0];
    expect(item?.blob).toBe(storedBlob);
  });

  it("restores the project name and settings from the saved record", async () => {
    mockAutoSaveRecover.mockResolvedValue(makeProject({ name: "Recovered Cut" }));

    const success = await useProjectStore
      .getState()
      .recoverFromAutoSave("save-1");

    expect(success).toBe(true);
    expect(useProjectStore.getState().project.name).toBe("Recovered Cut");
  });

  it("returns false without throwing when autoSaveManager.recover returns null", async () => {
    mockAutoSaveRecover.mockResolvedValue(null);

    let threw = false;
    let result: boolean | undefined;
    try {
      result = await useProjectStore.getState().recoverFromAutoSave("save-1");
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(result).toBe(false);
    expect(useProjectStore.getState().error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Hook-level tests
// ---------------------------------------------------------------------------
describe("useProjectRecovery hook", () => {
  beforeEach(() => {
    mockAutoSaveRecover.mockReset();
    mockCheckForRecovery.mockReset().mockResolvedValue([]);
    mockLoadProjectMedia.mockReset().mockResolvedValue([]);
    mockBackendLoad.mockReset().mockResolvedValue(null);
    useProjectStore.getState().createNewProject();
  });

  it("checks for recovery saves on mount and shows dialog when saves exist", async () => {
    mockCheckForRecovery.mockResolvedValue([makeSave()]);

    const { result } = renderHook(() => useProjectRecovery());

    await waitFor(() => {
      expect(result.current.showDialog).toBe(true);
    });
    expect(result.current.availableSaves).toHaveLength(1);
    expect(result.current.isChecking).toBe(false);
  });

  it("does not show dialog when no saves exist", async () => {
    mockCheckForRecovery.mockResolvedValue([]);

    const { result } = renderHook(() => useProjectRecovery());

    await waitFor(() => {
      expect(result.current.isChecking).toBe(false);
    });
    expect(result.current.showDialog).toBe(false);
  });
  it("restores from backend without IndexedDB media hydration", async () => {
    const backendProject = makeProject({
      name: "Backend Cut",
      mediaItems: [makeMediaItem()]
    });

    mockCheckForRecovery.mockResolvedValue([]);
    mockBackendLoad.mockResolvedValue(backendProject);

    const { result } = renderHook(() => useProjectRecovery(backendProject.id));

    await waitFor(() => {
      expect(result.current.isChecking).toBe(false);
    });

    expect(mockBackendLoad).toHaveBeenCalledWith(backendProject.id);
    expect(mockLoadProjectMedia).not.toHaveBeenCalled();
    expect(mockAutoSaveRecover).not.toHaveBeenCalled();
    expect(useProjectStore.getState().project.name).toBe("Backend Cut");
    expect(useProjectStore.getState().project.mediaLibrary.items[0]?.blob).toBeNull();
    expect(result.current.showDialog).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("prompts before replacing a backend project with a newer local autosave", async () => {
    const backendProject = makeProject({ name: "Backend Cut" });
    const newerLocalSave = makeSave({ timestamp: backendProject.modifiedAt + 1 });
    mockCheckForRecovery.mockResolvedValue([newerLocalSave]);
    mockBackendLoad.mockResolvedValue(backendProject);

    const { result } = renderHook(() => useProjectRecovery(backendProject.id));

    await waitFor(() => expect(result.current.isChecking).toBe(false));

    expect(useProjectStore.getState().project.name).toBe("Backend Cut");
    expect(mockAutoSaveRecover).not.toHaveBeenCalled();
    expect(result.current.showDialog).toBe(true);
    expect(result.current.hasBackendConflict).toBe(true);
    expect(result.current.availableSaves).toEqual([newerLocalSave]);
  });

  it("keeps the backend project without prompting when the local autosave is older", async () => {
    const backendProject = makeProject({ name: "Backend Cut" });
    mockCheckForRecovery.mockResolvedValue([
      makeSave({ timestamp: backendProject.modifiedAt - 1 }),
    ]);
    mockBackendLoad.mockResolvedValue(backendProject);

    const { result } = renderHook(() => useProjectRecovery(backendProject.id));

    await waitFor(() => expect(result.current.isChecking).toBe(false));

    expect(result.current.showDialog).toBe(false);
    expect(result.current.hasBackendConflict).toBe(false);
  });

  it("falls back to the matching IDB auto-save when backend restore is unavailable", async () => {
    mockCheckForRecovery.mockResolvedValue([
      makeSave({ id: "other-save", projectId: "other-project-id", timestamp: 1000 }),
      makeSave({ id: "matching-save", projectId: "test-project-id", timestamp: 2000 }),
    ]);
    mockBackendLoad.mockResolvedValue(null);
    mockAutoSaveRecover.mockResolvedValue(makeProject({ name: "Fallback Cut" }));

    const { result } = renderHook(() => useProjectRecovery("test-project-id"));

    // recoverFromAutoSave's backend-reachable branch waits ~1s for
    // fire-and-forget media uploads to settle before falling back to IDB
    // hydration, so the default 1000ms waitFor timeout isn't enough here.
    await waitFor(
      () => {
        expect(result.current.isChecking).toBe(false);
      },
      { timeout: 3000 },
    );

    expect(mockBackendLoad).toHaveBeenCalledWith("test-project-id");
    expect(mockAutoSaveRecover).toHaveBeenCalledWith("matching-save");
    expect(useProjectStore.getState().project.name).toBe("Fallback Cut");
    expect(result.current.showDialog).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("hides dialog and clears error after successful recovery", async () => {
    mockCheckForRecovery.mockResolvedValue([makeSave()]);
    mockAutoSaveRecover.mockResolvedValue(makeProject({ name: "My Video" }));

    const { result } = renderHook(() => useProjectRecovery());
    await waitFor(() => expect(result.current.showDialog).toBe(true));

    await act(async () => {
      await result.current.recover("save-1");
    });

    expect(result.current.showDialog).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("regression: hook exposes no error state when recovery fails — recovery errors are invisible to the UI", async () => {
    mockCheckForRecovery.mockResolvedValue([makeSave()]);
    mockAutoSaveRecover.mockRejectedValue(new Error("DB unavailable"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { result } = renderHook(() => useProjectRecovery());
    await waitFor(() => expect(result.current.showDialog).toBe(true));

    await act(async () => {
      await result.current.recover("save-1");
    });

    // Without fix: result.current.error is undefined (hook has no error state)
    // With fix:    result.current.error is a non-empty string
    expect(result.current.error).toBeTruthy();
    consoleError.mockRestore();
  });
});
