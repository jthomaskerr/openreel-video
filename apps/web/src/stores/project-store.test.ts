import { describe, it, expect, beforeEach, vi } from "vitest";
import { useProjectStore } from "./project-store";
import { useEngineStore } from "./engine-store";
import { backendSaveService } from "../services/backend-save";
import { autoSaveManager, initializeAutoSave as initializeAutoSaveStorage } from "../services/auto-save";
import { getMediaBridge } from "../bridges/media-bridge";
import type { Project, Clip, MediaItem, Transition } from "@openreel/core";
import { usePersistenceStatusStore } from "./persistence-status-store";

const {
  mockEffectsBridge,
  mockEffectsBridgeState,
  mockSaveMediaBlob,
  mockTransitionBridge,
  mockTransitionBridgeState
        } = vi.hoisted(() => {
  const clipEffects = new Map<string, Array<{
    id: string;
    type: string;
    enabled: boolean;
    params: Record<string, unknown>;
    order: number;
  }>>();

  const getDefaultParams = (effectType: string): Record<string, unknown> => {
    switch (effectType) {
      case "brightness":
        return { value: 0 };
      case "contrast":
        return { value: 1 };
      case "saturation":
        return { value: 1 };
      case "blur":
        return { radius: 0, type: "gaussian" };
      default:
        return {};
    }
  };

  const effectsBridge = {
    isInitialized: vi.fn(() => true),
    applyVideoEffect: vi.fn(
      (clipId: string, effectType: string, params: Record<string, unknown> = {}) => {
        const effects = clipEffects.get(clipId) || [];
        const effect = {
          id: `effect-${effects.length + 1}`,
          type: effectType,
          enabled: true,
          params: { ...getDefaultParams(effectType), ...params },
          order: effects.length
        };
        clipEffects.set(clipId, [...effects, effect]);
        return { success: true, effectId: effect.id };
      },
    ),
    getEffects: vi.fn((clipId: string) => [...(clipEffects.get(clipId) || [])]),
    getEffect: vi.fn((clipId: string, effectId: string) =>
      (clipEffects.get(clipId) || []).find((effect) => effect.id === effectId),
    ),
    deserializeEffects: vi.fn(
      (
        clipId: string,
        data: {
          effects: Array<{
            id: string;
            type: string;
            enabled: boolean;
            params: Record<string, unknown>;
            order: number;
          }>;
        },
      ) => {
        clipEffects.set(
          clipId,
          data.effects.map((effect) => ({ ...effect })),
        );
        return { success: true };
      },
    ),
    clearEffects: vi.fn((clipId: string) => {
      clipEffects.delete(clipId);
    }),
    getColorGrading: vi.fn(() => ({}))
        };

  const trackTransitions = new Map<string, Transition[]>();
  const transitionBridge = {
    isInitialized: vi.fn(() => true),
    setTransitionsForTrack: vi.fn(
      (trackId: string, transitions: Transition[]) => {
        trackTransitions.set(
          trackId,
          transitions.map((transition) => ({
            ...transition,
            params: { ...transition.params }
        })),
        );
      },
    ),
    clearTransitionsForTrack: vi.fn((trackId: string) => {
      trackTransitions.delete(trackId);
    })
        };

  return {
    mockEffectsBridge: effectsBridge,
    mockEffectsBridgeState: { clipEffects },
    mockSaveMediaBlob: vi.fn().mockResolvedValue(undefined),
    mockTransitionBridge: transitionBridge,
    mockTransitionBridgeState: { trackTransitions }
        };
});

vi.mock("../services/auto-save", () => ({
  autoSaveManager: {
    isStarted: vi.fn().mockReturnValue(false),
    on: vi.fn(),
    start: vi.fn(),
    markDirty: vi.fn(),
    startAutoSave: vi.fn(),
    stopAutoSave: vi.fn(),
    triggerSave: vi.fn(),
    getRecentSaves: vi.fn().mockResolvedValue([]),
    loadSave: vi.fn(),
    deleteSave: vi.fn()
        },
  initializeAutoSave: vi.fn().mockResolvedValue(undefined)
        }));

vi.mock("../bridges/media-bridge", () => ({
  getMediaBridge: vi.fn(() => ({
    isInitialized: vi.fn().mockReturnValue(true),
    importFile: vi.fn().mockResolvedValue({
      success: true,
      media: {
        id: "mock-media-id",
        name: "test-video.mp4",
        type: "video",
        duration: 10,
        width: 1920,
        height: 1080,
        frameRate: 30,
        metadata: {
          hasVideo: true,
          hasAudio: false,
          duration: 10,
          width: 1920,
          height: 1080,
          frameRate: 30,
          codec: "h264",
          sampleRate: 0,
          channels: 0
        }
        }
        }),
    generateThumbnailsForMedia: vi.fn().mockResolvedValue([])
        })),
  initializeMediaBridge: vi.fn().mockResolvedValue(undefined)
        }));

vi.mock("../services/media-storage", () => ({
  saveMediaBlob: mockSaveMediaBlob,
  deleteMediaBlob: vi.fn().mockResolvedValue(undefined),
  loadProjectMedia: vi.fn().mockResolvedValue([]),
  loadFileHandle: vi.fn().mockResolvedValue(null),
  loadDirectoryHandle: vi.fn().mockResolvedValue(null)
        }));

vi.mock("../bridges/effects-bridge", () => ({
  getEffectsBridge: vi.fn(() => mockEffectsBridge)
        }));

vi.mock("../bridges/transition-bridge", () => ({
  getTransitionBridge: vi.fn(() => mockTransitionBridge)
        }));

let createdProjectSequence = 0;

function mockConfirmedBackendCreate() {
  return vi.spyOn(backendSaveService, "create").mockImplementation(async (name, settings) => {
    const now = Date.now();
    const project: Project = {
      id: `backend-project-${++createdProjectSequence}`,
      name,
      createdAt: now,
      modifiedAt: now,
      settings: {
        width: 1920,
        height: 1080,
        frameRate: 30,
        sampleRate: 48000,
        channels: 2,
        ...settings,
      },
      mediaLibrary: { items: [] },
      generatedImageDefinitions: [],
      timeline: { tracks: [], subtitles: [], duration: 0, markers: [] },
    };
    usePersistenceStatusStore.getState().confirmReceipt(project.id, {
      saved: true,
      committed: true,
      projectId: project.id,
      persistedAt: now,
      sourceModifiedAt: project.modifiedAt,
      commitSha: "a".repeat(40),
      treeSha: "b".repeat(40),
      projectBlobSha: "c".repeat(40),
      mediaManifestDigest: "sha256:test",
      lfsPayloads: [],
    });
    return project;
  });
}

describe("ProjectStore", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    mockEffectsBridgeState.clipEffects.clear();
    mockTransitionBridgeState.trackTransitions.clear();
    mockSaveMediaBlob.mockClear();
    mockConfirmedBackendCreate();
    await useProjectStore.getState().createNewProject();
  });

  describe("project creation", () => {
    it("should create a new project with default settings", () => {
      const { project } = useProjectStore.getState();

      expect(project).toBeDefined();
      expect(project.name).toBeDefined();
      expect(project.name.length).toBeGreaterThan(0);
      expect(project.settings.width).toBe(1920);
      expect(project.settings.height).toBe(1080);
      expect(project.settings.frameRate).toBe(30);
    });

    it("should create project with custom name", async () => {
      await useProjectStore.getState().createNewProject("My Custom Project");
      const { project } = useProjectStore.getState();

      expect(project.name).toBe("My Custom Project");
    });

    it("should create project with custom settings", async () => {
      await useProjectStore.getState().createNewProject("4K Project", {
        width: 3840,
        height: 2160,
        frameRate: 60
        });
      const { project } = useProjectStore.getState();

      expect(project.settings.width).toBe(3840);
      expect(project.settings.height).toBe(2160);
      expect(project.settings.frameRate).toBe(60);
    });

    it("should create project with empty timeline", () => {
      const { project } = useProjectStore.getState();

      expect(project.timeline).toBeDefined();
      expect(project.timeline.tracks).toBeDefined();
      expect(Array.isArray(project.timeline.tracks)).toBe(true);
    });

    it("should have unique project id", async () => {
      const firstProject = useProjectStore.getState().project;
      await useProjectStore.getState().createNewProject();
      const secondProject = useProjectStore.getState().project;

      expect(firstProject.id).not.toBe(secondProject.id);
    });

    it("should reset action history on new project", () => {
      const store = useProjectStore.getState();
      expect(store.canUndo()).toBe(false);
      expect(store.canRedo()).toBe(false);
    });

    describe("backend project creation", () => {
      it("activates only the backend slug after its receipt is confirmed", async () => {
        const now = Date.now();
        const backendProject: Project = {
          id: "my-new-slug",
          name: "My New Project",
          createdAt: now,
          modifiedAt: now,
          settings: {
            width: 1920, height: 1080, frameRate: 30,
            sampleRate: 48000, channels: 2,
          },
          mediaLibrary: { items: [] },
          generatedImageDefinitions: [],
          timeline: { tracks: [], subtitles: [], duration: 0, markers: [] },
        };

        vi.spyOn(backendSaveService, "create").mockImplementation(async () => {
          usePersistenceStatusStore.getState().confirmReceipt(backendProject.id, {
            saved: true, committed: true, projectId: backendProject.id,
            persistedAt: now, sourceModifiedAt: now,
            commitSha: "a".repeat(40), treeSha: "b".repeat(40),
            projectBlobSha: "c".repeat(40), mediaManifestDigest: "sha256:test",
            lfsPayloads: [],
          });
          return backendProject;
        });

        await expect(useProjectStore.getState().createNewProject("My New Project")).resolves.toBe(true);
        expect(useProjectStore.getState().project.id).toBe("my-new-slug");
        expect(useProjectStore.getState().explicitlyCreated).toBe(true);
        expect(usePersistenceStatusStore.getState().baseRevision).not.toBeNull();
      });

      it("does not activate or autosave a project when backend creation fails", async () => {
        const previousProject = useProjectStore.getState().project;
        vi.spyOn(backendSaveService, "create").mockRejectedValue(new Error("Backend unavailable"));

        await expect(useProjectStore.getState().createNewProject("Offline Project")).resolves.toBe(false);

        expect(useProjectStore.getState().project).toBe(previousProject);
        expect(useProjectStore.getState().explicitlyCreated).toBe(false);
        expect(autoSaveManager.markDirty).not.toHaveBeenCalled();
      });
    });
  });

  describe("backend autosave binding", () => {
    it("schedules edits to an existing backend project when IndexedDB initialization fails", async () => {
      vi.mocked(initializeAutoSaveStorage).mockRejectedValueOnce(
        new Error("IndexedDB blocked"),
      );
      const scheduleSaveSpy = vi
        .spyOn(backendSaveService, "scheduleSave")
        .mockImplementation(() => undefined);

      await expect(
        useProjectStore.getState().initializeAutoSave(),
      ).rejects.toThrow("IndexedDB blocked");

      const existing = useProjectStore.getState().project;
      useProjectStore.getState().loadProject({
        ...existing,
        id: "existing-backend-project",
      });
      await useProjectStore.getState().addTrack("video");
      const trackId = useProjectStore.getState().project.timeline.tracks[0]!.id;
      scheduleSaveSpy.mockClear();

      useProjectStore.getState().renameTrack(trackId, "Persisted track");

      expect(autoSaveManager.markDirty).toHaveBeenCalled();
      expect(scheduleSaveSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "existing-backend-project",
          timeline: expect.objectContaining({
            tracks: [expect.objectContaining({ name: "Persisted track" })],
          }),
        }),
        0,
      );
    });

    it("quarantines a recovered UUID instead of reconciling or saving it", () => {
      const initialProject = useProjectStore.getState().project;
      const recovered = {
        ...initialProject,
        id: "14aec9eb-469f-4db6-9652-00dee0d243fc",
        name: "Vintage Tokyo",
      };
      const listSpy = vi.spyOn(backendSaveService, "listProjects").mockResolvedValue([
        { id: "vintage-tokyo", name: "Vintage Tokyo", createdAt: 1, modifiedAt: 2 },
      ]);
      const loadSpy = vi.spyOn(backendSaveService, "load");
      const scheduleSaveSpy = vi
        .spyOn(backendSaveService, "scheduleSave")
        .mockImplementation(() => undefined);

      useProjectStore.getState().loadProject(recovered);

      expect(useProjectStore.getState().project).toBe(initialProject);
      expect(useProjectStore.getState().error).toMatch(/UUID project .* quarantined/i);
      expect(listSpy).not.toHaveBeenCalled();
      expect(loadSpy).not.toHaveBeenCalled();
      expect(scheduleSaveSpy).not.toHaveBeenCalled();
      listSpy.mockRestore();
      loadSpy.mockRestore();
      scheduleSaveSpy.mockRestore();
    });
  });

  describe("project loading", () => {
    it("does not schedule persistence while installing an authoritative project", () => {
      const scheduleSaveSpy = vi
        .spyOn(backendSaveService, "scheduleSave")
        .mockImplementation(() => undefined);
      const existing = useProjectStore.getState().project;

      useProjectStore.getState().loadProject({
        ...existing,
        id: "authoritative-project",
      });

      expect(scheduleSaveSpy).not.toHaveBeenCalled();
      expect(autoSaveManager.markDirty).not.toHaveBeenCalled();
      scheduleSaveSpy.mockRestore();
    });

    it("retains the confirmed backend base revision for the loaded project", () => {
      const existing = useProjectStore.getState().project;
      usePersistenceStatusStore.getState().confirmReceipt("backend-project", {
        saved: true,
        projectId: "backend-project",
        persistedAt: 10,
        sourceModifiedAt: existing.modifiedAt,
        commitSha: "a".repeat(40),
        treeSha: "b".repeat(40),
        projectBlobSha: "c".repeat(40),
        mediaManifestDigest: "sha256:test",
        lfsPayloads: [],
        committed: true,
      });

      useProjectStore.getState().loadProject({ ...existing, id: "backend-project" });

      expect(usePersistenceStatusStore.getState()).toMatchObject({
        projectId: "backend-project",
        baseRevision: { commitSha: "a".repeat(40) },
      });
    });

    it("should load an existing project", () => {
      const existingProject: Project = {
        id: "existing-project-id",
        name: "Loaded Project",
        createdAt: Date.now() - 1000,
        modifiedAt: Date.now(),
        settings: {
          width: 1280,
          height: 720,
          frameRate: 24,
          sampleRate: 44100,
          channels: 2
        },
        mediaLibrary: { items: [] },
        generatedImageDefinitions: [],
        timeline: {
          tracks: [],
          subtitles: [],
          duration: 0,
          markers: []
        }
        };

      useProjectStore.getState().loadProject(existingProject);
      const { project } = useProjectStore.getState();

      expect(project.id).toBe("existing-project-id");
      expect(project.name).toBe("Loaded Project");
      expect(project.settings.width).toBe(1280);
    });

    it("should preserve project data on load", () => {
      const mockMediaItem: MediaItem = {
        id: "media-1",
        name: "test.mp4",
        type: "video",
        fileHandle: null,
        blob: null,
        metadata: {
          duration: 30,
          width: 1920,
          height: 1080,
          frameRate: 30,
          codec: "h264",
          sampleRate: 48000,
          channels: 2,
          fileSize: 1000000
        },
        thumbnailUrl: null};

      const projectWithMedia: Project = {
        id: "project-with-media",
        name: "Media Project",
        createdAt: Date.now(),
        modifiedAt: Date.now(),
        settings: {
          width: 1920,
          height: 1080,
          frameRate: 30,
          sampleRate: 48000,
          channels: 2
        },
        mediaLibrary: { items: [mockMediaItem] },
        generatedImageDefinitions: [],
        timeline: {
          tracks: [
            {
              id: "track-1",
              type: "video",
              name: "Video 1",
              clips: [],
              transitions: [],
              locked: false,
              hidden: false,
              muted: false,
              solo: false
        },
          ],
          subtitles: [],
          duration: 30,
          markers: []
        }
        };

      useProjectStore.getState().loadProject(projectWithMedia);
      const { project } = useProjectStore.getState();

      expect(project.mediaLibrary.items.length).toBe(1);
      expect(project.mediaLibrary.items[0].name).toBe("test.mp4");
    });
  });

  describe("media import duplicate handling", () => {
    function seedProjectWithMedia(item: MediaItem, clip?: Clip) {
      const base = useProjectStore.getState().project;
      useProjectStore.getState().loadProject({
        ...base,
        mediaLibrary: { items: [item] },
        timeline: {
          ...base.timeline,
          tracks: [
            {
              id: "track-1",
              type: "video",
              name: "Video 1",
              clips: clip ? [clip] : [],
              transitions: [],
              locked: false,
              hidden: false,
              muted: false,
              solo: false,
            },
          ],
        },
      });
    }

    it("replaces an existing media item when imported file name and size match", async () => {
      const oldBlob = new Blob(["old"], { type: "video/mp4" });
      const replacement = new File(["same"], "test-video.mp4", { type: "video/mp4" });
      const existing: MediaItem = {
        id: "existing-media",
        name: "test-video.mp4",
        type: "video",
        fileHandle: null,
        blob: oldBlob,
        metadata: {
          duration: 5,
          width: 1280,
          height: 720,
          frameRate: 24,
          codec: "h264",
          sampleRate: 0,
          channels: 0,
          fileSize: replacement.size,
        },
        thumbnailUrl: "old-thumb",
        title: "User title",
        tags: ["keep"],
      };
      const clip: Clip = {
        id: "clip-1",
        mediaId: existing.id,
        trackId: "track-1",
        startTime: 0,
        duration: 5,
        inPoint: 0,
        outPoint: 5,
        type: "video",
        effects: [],
        audioEffects: [],
        transform: {
          position: { x: 0.5, y: 0.5 },
          scale: { x: 1, y: 1 },
          rotation: 0,
          anchor: { x: 0.5, y: 0.5 },
          opacity: 1,
        },
        volume: 1,
        keyframes: [],
      };
      seedProjectWithMedia(existing, clip);

      const result = await useProjectStore.getState().importMedia(replacement);

      expect(result.success).toBe(true);
      const state = useProjectStore.getState();
      const items = state.project.mediaLibrary.items;
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        id: "existing-media",
        name: "test-video.mp4",
        title: "User title",
        tags: ["keep"],
      });
      expect(items[0].blob).toBe(replacement);
      expect(items[0].metadata.fileSize).toBe(replacement.size);
      expect(state.project.timeline.tracks[0]?.clips[0]?.mediaId).toBe("existing-media");
      expect(mockSaveMediaBlob).toHaveBeenLastCalledWith(
        state.project.id,
        "existing-media",
        replacement,
        items[0].metadata,
      );
    });

    it("adds a new media item when filename matches but size differs", async () => {
      const existing: MediaItem = {
        id: "existing-media",
        name: "test-video.mp4",
        type: "video",
        fileHandle: null,
        blob: new Blob(["old"], { type: "video/mp4" }),
        metadata: {
          duration: 5,
          width: 1280,
          height: 720,
          frameRate: 24,
          codec: "h264",
          sampleRate: 0,
          channels: 0,
          fileSize: 3,
        },
        thumbnailUrl: null,
      };
      seedProjectWithMedia(existing);

      const result = await useProjectStore
        .getState()
        .importMedia(new File(["different-size"], "test-video.mp4", { type: "video/mp4" }));

      expect(result.success).toBe(true);
      const items = useProjectStore.getState().project.mediaLibrary.items;
      expect(items).toHaveLength(2);
      expect(items[0]?.id).toBe("existing-media");
      expect(items[1]?.id).not.toBe("existing-media");
      expect(items[1]?.name).toBe("test-video.mp4");
    });
  });

  describe("media import — title derivation", () => {
    it("uses the container metadata title when present", async () => {
      vi.mocked(getMediaBridge).mockReturnValueOnce({
        isInitialized: vi.fn().mockReturnValue(true),
        importFile: vi.fn().mockResolvedValue({
          success: true,
          media: {
            id: "mock-media-id",
            name: "some_raw_file_name.mp4",
            type: "video",
            duration: 10,
            width: 1920,
            height: 1080,
            frameRate: 30,
            metadata: {
              hasVideo: true,
              hasAudio: false,
              duration: 10,
              width: 1920,
              height: 1080,
              frameRate: 30,
              codec: "h264",
              sampleRate: 0,
              channels: 0,
              title: "My Great Video",
            },
          },
        }),
        generateThumbnailsForMedia: vi.fn().mockResolvedValue([]),
      } as unknown as ReturnType<typeof getMediaBridge>);

      const result = await useProjectStore
        .getState()
        .importMedia(new File(["x"], "some_raw_file_name.mp4", { type: "video/mp4" }));

      expect(result.success).toBe(true);
      const item = useProjectStore.getState().project.mediaLibrary.items.at(-1);
      expect(item?.name).toBe("some_raw_file_name.mp4");
      expect(item?.title).toBe("My Great Video");
    });

    it("derives the title from the filename when no metadata title is present", async () => {
      vi.mocked(getMediaBridge).mockReturnValueOnce({
        isInitialized: vi.fn().mockReturnValue(true),
        importFile: vi.fn().mockResolvedValue({
          success: true,
          media: {
            id: "mock-media-id",
            name: "my_cool_clip.mp4",
            type: "video",
            duration: 10,
            width: 1920,
            height: 1080,
            frameRate: 30,
            metadata: {
              hasVideo: true,
              hasAudio: false,
              duration: 10,
              width: 1920,
              height: 1080,
              frameRate: 30,
              codec: "h264",
              sampleRate: 0,
              channels: 0,
            },
          },
        }),
        generateThumbnailsForMedia: vi.fn().mockResolvedValue([]),
      } as unknown as ReturnType<typeof getMediaBridge>);

      const result = await useProjectStore
        .getState()
        .importMedia(new File(["x"], "my_cool_clip.mp4", { type: "video/mp4" }));

      expect(result.success).toBe(true);
      const item = useProjectStore.getState().project.mediaLibrary.items.at(-1);
      expect(item?.name).toBe("my_cool_clip.mp4");
      expect(item?.title).toBe("My cool clip");
    });
  });

  describe("generated media", () => {
    it("adds available generated media and persists its blob", async () => {
      const blob = new Blob(["generated"], { type: "image/png" });
      const item: MediaItem = {
        id: "generated-media-1",
        name: "Scene metadata.png",
        type: "image",
        fileHandle: null,
        blob,
        metadata: {
          duration: 0,
          width: 16,
          height: 16,
          frameRate: 0,
          codec: "png",
          sampleRate: 0,
          channels: 0,
          fileSize: blob.size
        },
        thumbnailUrl: "data:image/png;base64,abc"};

      const result = await useProjectStore.getState().addGeneratedMedia(item, blob);

      expect(result.success).toBe(true);
      const stored = useProjectStore.getState().project.mediaLibrary.items[0];
      expect(stored).toMatchObject({
        id: "generated-media-1",
        name: "Scene metadata.png",
        type: "image"
        });
      expect(mockSaveMediaBlob).toHaveBeenCalledWith(
        useProjectStore.getState().project.id,
        "generated-media-1",
        blob,
        stored.metadata,
      );
    });

    it("creates a distinct current version in the same asset group without overwriting the original", async () => {
      const originalBlob = new Blob(["v1"], { type: "image/png" });
      const versionBlob = new Blob(["v2"], { type: "image/png" });
      const original: MediaItem = {
        id: "asset-v1",
        name: "Shot v1.png",
        type: "image",
        fileHandle: null,
        blob: originalBlob,
        metadata: {
          duration: 0,
          width: 16,
          height: 16,
          frameRate: 0,
          codec: "png",
          sampleRate: 0,
          channels: 0,
          fileSize: originalBlob.size
        },
        thumbnailUrl: null,
        isCurrent: true
        };
      await useProjectStore.getState().addGeneratedMedia(original, originalBlob);

      const version: MediaItem = {
        ...original,
        id: "asset-v2",
        name: "Shot v2.png",
        blob: versionBlob,
        metadata: { ...original.metadata, fileSize: versionBlob.size },
        generationMeta: {
          provider: "wavespeed",
          model: "image-model",
          prompt: "new version",
          jobId: "job-1"
        }
        };

      const result = await useProjectStore.getState().addAssetVersion("asset-v1", version, versionBlob);

      expect(result.success).toBe(true);
      const items = useProjectStore.getState().project.mediaLibrary.items;
      expect(items).toHaveLength(2);
      expect(items[0]).toMatchObject({
        id: "asset-v1",
        assetGroupId: "asset-v1",
        isCurrent: false
        });
      expect(items[1]).toMatchObject({
        id: "asset-v2",
        assetGroupId: "asset-v1",
        isCurrent: true,
        generationMeta: expect.objectContaining({ provider: "wavespeed", jobId: "job-1" })
        });
      expect(items[0].blob).toBe(originalBlob);
      expect(items[1].blob).toBe(versionBlob);
      expect(mockSaveMediaBlob).toHaveBeenLastCalledWith(
        useProjectStore.getState().project.id,
        "asset-v2",
        versionBlob,
        items[1].metadata,
      );
    });

    it("imports a replacement file as a distinct current version", async () => {
      const originalBlob = new Blob(["v1"], { type: "image/png" });
      const original: MediaItem = {
        id: "local-v1",
        name: "Local v1.png",
        type: "image",
        fileHandle: null,
        blob: originalBlob,
        metadata: {
          duration: 0,
          width: 16,
          height: 16,
          frameRate: 0,
          codec: "png",
          sampleRate: 0,
          channels: 0,
          fileSize: originalBlob.size
        },
        thumbnailUrl: null,
        title: "Hero shot",
        group: "B-roll",
        isCurrent: true
        };
      await useProjectStore.getState().addGeneratedMedia(original, originalBlob);

      const replacement = new File(["v2"], "Local v2.mp4", { type: "video/mp4" });
      const result = await useProjectStore
        .getState()
        .addAssetVersionFromFile("local-v1", replacement);

      expect(result.success).toBe(true);
      expect(result.actionId).toBeTruthy();

      const items = useProjectStore.getState().project.mediaLibrary.items;
      const originalAfter = items.find((item) => item.id === "local-v1");
      const version = items.find((item) => item.id === result.actionId);

      expect(items).toHaveLength(2);
      expect(originalAfter).toMatchObject({
        id: "local-v1",
        assetGroupId: "local-v1",
        isCurrent: false,
        name: "Local v1.png"
        });
      expect(version).toMatchObject({
        name: "Local v2.mp4",
        type: "video",
        assetGroupId: "local-v1",
        isCurrent: true,
        title: "Hero shot",
        group: "B-roll"
        });
      expect(version?.blob).toBe(replacement);
      expect(mockSaveMediaBlob).toHaveBeenLastCalledWith(
        useProjectStore.getState().project.id,
        result.actionId,
        replacement,
        version?.metadata,
      );
    });

    it("switches current version only inside the selected asset group", async () => {
      const blob = new Blob(["v"], { type: "image/png" });
      const makeItem = (id: string, assetGroupId: string, isCurrent: boolean): MediaItem => ({
        id,
        name: `${id}.png`,
        type: "image",
        fileHandle: null,
        blob,
        metadata: {
          duration: 0,
          width: 16,
          height: 16,
          frameRate: 0,
          codec: "png",
          sampleRate: 0,
          channels: 0,
          fileSize: blob.size
        },
        thumbnailUrl: null,
        assetGroupId,
        isCurrent
        });
      await useProjectStore.getState().addGeneratedMedia(makeItem("group-a-v1", "group-a", true), blob);
      await useProjectStore.getState().addGeneratedMedia(makeItem("group-a-v2", "group-a", false), blob);
      await useProjectStore.getState().addGeneratedMedia(makeItem("group-b-v1", "group-b", true), blob);

      expect(useProjectStore.getState().setCurrentAssetVersion("group-a-v2")).toBe(true);

      const items = useProjectStore.getState().project.mediaLibrary.items;
      expect(items.find((item) => item.id === "group-a-v1")?.isCurrent).toBe(false);
      expect(items.find((item) => item.id === "group-a-v2")?.isCurrent).toBe(true);
      expect(items.find((item) => item.id === "group-b-v1")?.isCurrent).toBe(true);
    });
  });

  describe("project renaming", () => {
    it("should rename project", async () => {
      const result = await useProjectStore.getState().renameProject("New Name");

      expect(result.success).toBe(true);

      const { project } = useProjectStore.getState();
      expect(project.name).toBe("New Name");
    });

    it("should preserve other project properties when renaming", async () => {
      const originalProject = useProjectStore.getState().project;
      const originalId = originalProject.id;
      const originalSettings = { ...originalProject.settings };

      await useProjectStore.getState().renameProject("Renamed Project");

      const { project } = useProjectStore.getState();
      expect(project.id).toBe(originalId);
      expect(project.settings).toEqual(originalSettings);
    });
  });

  describe("settings update", () => {
    it("should update project settings", async () => {
      const result = await useProjectStore.getState().updateSettings({
        width: 2560,
        height: 1440
        });

      expect(result.success).toBe(true);

      const { project } = useProjectStore.getState();
      expect(project.settings.width).toBe(2560);
      expect(project.settings.height).toBe(1440);
    });

    it("should preserve unmodified settings", async () => {
      const originalFrameRate =
        useProjectStore.getState().project.settings.frameRate;
      const originalSampleRate =
        useProjectStore.getState().project.settings.sampleRate;

      await useProjectStore.getState().updateSettings({
        width: 3840,
        height: 2160
        });

      const { project } = useProjectStore.getState();
      expect(project.settings.frameRate).toBe(originalFrameRate);
      expect(project.settings.sampleRate).toBe(originalSampleRate);
    });
  });

  describe("track operations", () => {
    it("should add a video track", async () => {
      const initialTrackCount =
        useProjectStore.getState().project.timeline.tracks.length;

      const result = await useProjectStore.getState().addTrack("video");

      expect(result.success).toBe(true);

      const newTrackCount =
        useProjectStore.getState().project.timeline.tracks.length;
      expect(newTrackCount).toBe(initialTrackCount + 1);
    });

    it("should add an audio track", async () => {
      const result = await useProjectStore.getState().addTrack("audio");
      expect(result.success).toBe(true);
    });

    it("should get track by id", async () => {
      await useProjectStore.getState().addTrack("video");
      const { project } = useProjectStore.getState();
      const trackId = project.timeline.tracks[0].id;

      const track = useProjectStore.getState().getTrack(trackId);
      expect(track).toBeDefined();
      expect(track?.id).toBe(trackId);
    });

    it("should return undefined for non-existent track", () => {
      const track = useProjectStore.getState().getTrack("non-existent-id");
      expect(track).toBeUndefined();
    });

    it("should lock a track", async () => {
      await useProjectStore.getState().addTrack("video");
      const { project } = useProjectStore.getState();
      const trackId = project.timeline.tracks[0].id;

      const result = await useProjectStore.getState().lockTrack(trackId, true);
      expect(result.success).toBe(true);

      const lockedTrack = useProjectStore.getState().getTrack(trackId);
      expect(lockedTrack?.locked).toBe(true);
    });

    it("should unlock a track", async () => {
      await useProjectStore.getState().addTrack("video");
      const { project } = useProjectStore.getState();
      const trackId = project.timeline.tracks[0].id;

      await useProjectStore.getState().lockTrack(trackId, true);
      await useProjectStore.getState().lockTrack(trackId, false);

      const unlockedTrack = useProjectStore.getState().getTrack(trackId);
      expect(unlockedTrack?.locked).toBe(false);
    });

    it("should mute a track", async () => {
      const { project } = useProjectStore.getState();
      const audioTrack = project.timeline.tracks.find(
        (t) => t.type === "audio",
      );

      if (audioTrack) {
        const result = await useProjectStore
          .getState()
          .muteTrack(audioTrack.id, true);
        expect(result.success).toBe(true);

        const mutedTrack = useProjectStore.getState().getTrack(audioTrack.id);
        expect(mutedTrack?.muted).toBe(true);
      }
    });

    it("should unmute a track", async () => {
      const { project } = useProjectStore.getState();
      const audioTrack = project.timeline.tracks.find(
        (t) => t.type === "audio",
      );

      if (audioTrack) {
        await useProjectStore.getState().muteTrack(audioTrack.id, true);
        await useProjectStore.getState().muteTrack(audioTrack.id, false);

        const unmutedTrack = useProjectStore.getState().getTrack(audioTrack.id);
        expect(unmutedTrack?.muted).toBe(false);
      }
    });

    it("should hide a track", async () => {
      await useProjectStore.getState().addTrack("video");
      const { project } = useProjectStore.getState();
      const trackId = project.timeline.tracks[0].id;

      const result = await useProjectStore.getState().hideTrack(trackId, true);
      expect(result.success).toBe(true);

      const hiddenTrack = useProjectStore.getState().getTrack(trackId);
      expect(hiddenTrack?.hidden).toBe(true);
    });

    it("should show a hidden track", async () => {
      await useProjectStore.getState().addTrack("video");
      const { project } = useProjectStore.getState();
      const trackId = project.timeline.tracks[0].id;

      await useProjectStore.getState().hideTrack(trackId, true);
      await useProjectStore.getState().hideTrack(trackId, false);

      const visibleTrack = useProjectStore.getState().getTrack(trackId);
      expect(visibleTrack?.hidden).toBe(false);
    });
  });

  describe("media operations", () => {
    it("should get media item by id", () => {
      const projectWithMedia: Project = {
        id: "test-project",
        name: "Test",
        createdAt: Date.now(),
        modifiedAt: Date.now(),
        settings: {
          width: 1920,
          height: 1080,
          frameRate: 30,
          sampleRate: 48000,
          channels: 2
        },
        mediaLibrary: {
          items: [
            {
              id: "media-123",
              name: "video.mp4",
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
                fileSize: 500000
        },
              thumbnailUrl: null},
          ]
        },
        generatedImageDefinitions: [],
        timeline: {
          tracks: [],
          subtitles: [],
          duration: 0,
          markers: []
        }
        };

      useProjectStore.getState().loadProject(projectWithMedia);

      const media = useProjectStore.getState().getMediaItem("media-123");
      expect(media).toBeDefined();
      expect(media?.name).toBe("video.mp4");
    });

    it("should return undefined for non-existent media", () => {
      const media = useProjectStore.getState().getMediaItem("non-existent");
      expect(media).toBeUndefined();
    });
  });

  describe("timeline duration", () => {
    it("should calculate timeline duration from clips", () => {
      const projectWithClips: Project = {
        id: "test-project",
        name: "Test",
        createdAt: Date.now(),
        modifiedAt: Date.now(),
        settings: {
          width: 1920,
          height: 1080,
          frameRate: 30,
          sampleRate: 48000,
          channels: 2
        },
        mediaLibrary: { items: [] },
        generatedImageDefinitions: [],
        timeline: {
          tracks: [
            {
              id: "track-1",
              type: "video",
              name: "Video",
              clips: [
                {
                  id: "clip-1",
                  type: "video",
                  mediaId: "media-1",
                  trackId: "track-1",
                  startTime: 0,
                  duration: 10,
                  inPoint: 0,
                  outPoint: 10,
                  effects: [],
                  audioEffects: [],
                  transform: {
                    position: { x: 0.5, y: 0.5 },
                    scale: { x: 1, y: 1 },
                    rotation: 0,
                    anchor: { x: 0.5, y: 0.5 },
                    opacity: 1
        },
                  volume: 1,
                  keyframes: []
        },
                {
                  id: "clip-2",
                  type: "video",
                  mediaId: "media-2",
                  trackId: "track-1",
                  startTime: 10,
                  duration: 5,
                  inPoint: 0,
                  outPoint: 5,
                  effects: [],
                  audioEffects: [],
                  transform: {
                    position: { x: 0.5, y: 0.5 },
                    scale: { x: 1, y: 1 },
                    rotation: 0,
                    anchor: { x: 0.5, y: 0.5 },
                    opacity: 1
        },
                  volume: 1,
                  keyframes: []
        },
              ],
              transitions: [],
              locked: false,
              hidden: false,
              muted: false,
              solo: false
        },
          ],
          subtitles: [],
          duration: 15,
          markers: []
        }
        };

      useProjectStore.getState().loadProject(projectWithClips);

      const duration = useProjectStore.getState().getTimelineDuration();
      expect(duration).toBe(15);
    });
  });

  describe("video effects", () => {
    const createProjectWithVideoClip = (): Project => ({
      id: "effects-project",
      name: "Effects Project",
      createdAt: Date.now(),
      modifiedAt: Date.now(),
      settings: {
        width: 1920,
        height: 1080,
        frameRate: 30,
        sampleRate: 48000,
        channels: 2
        },
      mediaLibrary: { items: [] },
      generatedImageDefinitions: [],
      timeline: {
        tracks: [
          {
            id: "video-track-1",
            type: "video",
            name: "Video",
            clips: [
              {
                id: "video-clip-1",
                type: "video",
                mediaId: "video-media-1",
                trackId: "video-track-1",
                startTime: 0,
                duration: 8,
                inPoint: 0,
                outPoint: 8,
                effects: [],
                audioEffects: [],
                transform: {
                  position: { x: 0.5, y: 0.5 },
                  scale: { x: 1, y: 1 },
                  rotation: 0,
                  anchor: { x: 0.5, y: 0.5 },
                  opacity: 1
        },
                volume: 1,
                keyframes: []
        },
            ],
            transitions: [],
            locked: false,
            hidden: false,
            muted: false,
            solo: false
        },
        ],
        subtitles: [],
        duration: 8,
        markers: []
        }
        });

    it("should persist video effects to the clip timeline state", () => {
      useProjectStore.getState().loadProject(createProjectWithVideoClip());

      const addedEffect = useProjectStore
        .getState()
        .addVideoEffect("video-clip-1", "brightness", { value: 15 });

      expect(addedEffect).not.toBeNull();
      expect(useProjectStore.getState().getClip("video-clip-1")?.effects).toEqual([
        {
          id: addedEffect!.id,
          type: "brightness",
          enabled: true,
          params: { value: 15 }
        },
      ]);
      expect(useProjectStore.getState().getVideoEffects("video-clip-1")).toHaveLength(1);
    });

    it("should keep clip effects synchronized across update, toggle, reorder, and remove", () => {
      useProjectStore.getState().loadProject(createProjectWithVideoClip());

      const brightness = useProjectStore
        .getState()
        .addVideoEffect("video-clip-1", "brightness", { value: 10 });
      const contrast = useProjectStore
        .getState()
        .addVideoEffect("video-clip-1", "contrast", { value: 1.2 });

      expect(brightness).not.toBeNull();
      expect(contrast).not.toBeNull();

      const updated = useProjectStore
        .getState()
        .updateVideoEffect("video-clip-1", brightness!.id, { value: 20 });
      const toggled = useProjectStore
        .getState()
        .toggleVideoEffect("video-clip-1", brightness!.id, false);
      const reordered = useProjectStore
        .getState()
        .reorderVideoEffects("video-clip-1", [contrast!.id, brightness!.id]);
      const removed = useProjectStore
        .getState()
        .removeVideoEffect("video-clip-1", contrast!.id);

      expect(updated?.params).toEqual({ value: 20 });
      expect(toggled?.enabled).toBe(false);
      expect(reordered).toBe(true);
      expect(removed).toBe(true);
      expect(useProjectStore.getState().getClip("video-clip-1")?.effects).toEqual([
        {
          id: brightness!.id,
          type: "brightness",
          enabled: false,
          params: { value: 20 }
        },
      ]);
    });
  });

  describe("editing templates", () => {
    const createProjectWithEditableClip = (): Project => {
      const mediaItem: MediaItem = {
        id: "video-media-1",
        name: "hero-shot.mp4",
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
          fileSize: 1000000
        },
        thumbnailUrl: null};

      const clip: Clip = {
        id: "video-clip-1",
        type: "video",
        mediaId: mediaItem.id,
        trackId: "video-track-1",
        startTime: 0,
        duration: 10,
        inPoint: 0,
        outPoint: 10,
        effects: [],
        audioEffects: [],
        transform: {
          position: { x: 0.5, y: 0.5 },
          scale: { x: 1, y: 1 },
          rotation: 0,
          anchor: { x: 0.5, y: 0.5 },
          opacity: 1
        },
        volume: 1,
        keyframes: []
        };

      return {
        id: "editing-template-project",
        name: "Editing Template Project",
        createdAt: Date.now(),
        modifiedAt: Date.now(),
        settings: {
          width: 1920,
          height: 1080,
          frameRate: 30,
          sampleRate: 48000,
          channels: 2
        },
        mediaLibrary: { items: [mediaItem] },
        generatedImageDefinitions: [],
        timeline: {
          tracks: [
            {
              id: "video-track-1",
              type: "video",
              name: "Video",
              clips: [clip],
              transitions: [],
              locked: false,
              hidden: false,
              muted: false,
              solo: false
        },
          ],
          subtitles: [],
          duration: 10,
          markers: []
        }
        };
    };

    beforeEach(() => {
      const titleEngine = useEngineStore.getState().getTitleEngine();
      const graphicsEngine = useEngineStore.getState().getGraphicsEngine();

      titleEngine?.loadTextClips([]);
      graphicsEngine?.loadShapeClips([]);
      graphicsEngine?.loadSVGClips([]);
      graphicsEngine?.loadStickerClips([]);
    });

    const getRecipeTextValues = (applicationId: string): string[] =>
      (useEngineStore.getState().getTitleEngine()?.getAllTextClips() || [])
        .filter(
          (clip) => clip.metadata?.templateSource?.applicationId === applicationId,
        )
        .map((clip) => clip.text)
        .sort();

    it("applies a clip-scoped recipe and records metadata plus overlays", () => {
      useProjectStore.getState().loadProject(createProjectWithEditableClip());

      const applicationId = useProjectStore.getState().applyEditingTemplate(
        "branding-lower-third",
        "video-clip-1",
        {
          name: "Ada Lovelace",
          role: "Director"
        },
      );

      expect(applicationId).toBeTruthy();

      const clip = useProjectStore.getState().getClip("video-clip-1");
      expect(clip?.metadata?.appliedTemplates).toEqual([
        expect.objectContaining({
          templateId: "branding-lower-third",
          applicationId,
          controlValues: expect.objectContaining({
            name: "Ada Lovelace",
            role: "Director"
        })
        }),
      ]);
      expect(
        useProjectStore
          .getState()
          .project.timeline.tracks.map((track) => track.type),
      ).toEqual(["text", "graphics", "video"]);
      expect(
        useEngineStore.getState().getGraphicsEngine()?.getAllShapeClips(),
      ).toHaveLength(1);
      expect(
        useEngineStore.getState().getTitleEngine()?.getAllTextClips(),
      ).toHaveLength(2);
    });

    it("removes a clip-scoped recipe and cleans up its generated tracks", () => {
      useProjectStore.getState().loadProject(createProjectWithEditableClip());

      const applicationId = useProjectStore.getState().applyEditingTemplate(
        "branding-lower-third",
        "video-clip-1",
      );

      expect(applicationId).toBeTruthy();
      expect(
        useProjectStore.getState().removeEditingTemplateApplication(
          "video-clip-1",
          applicationId!,
        ),
      ).toBe(true);

      const clip = useProjectStore.getState().getClip("video-clip-1");
      expect(clip?.metadata?.appliedTemplates || []).toHaveLength(0);
      expect(
        useProjectStore
          .getState()
          .project.timeline.tracks.map((track) => track.type),
      ).toEqual(["video"]);
      expect(
        useEngineStore.getState().getGraphicsEngine()?.getAllShapeClips(),
      ).toHaveLength(0);
      expect(
        useEngineStore.getState().getTitleEngine()?.getAllTextClips(),
      ).toHaveLength(0);
    });

    it("updates an applied recipe in place and keeps its application id", () => {
      useProjectStore.getState().loadProject(createProjectWithEditableClip());

      const applicationId = useProjectStore.getState().applyEditingTemplate(
        "branding-lower-third",
        "video-clip-1",
        {
          name: "Ada Lovelace",
          role: "Director"
        },
      );

      expect(applicationId).toBeTruthy();
      expect(
        useProjectStore.getState().updateEditingTemplateApplication(
          "video-clip-1",
          applicationId!,
          {
            name: "Grace Hopper",
            role: "Engineer"
        },
        ),
      ).toBe(true);

      const clip = useProjectStore.getState().getClip("video-clip-1");
      expect(clip?.metadata?.appliedTemplates).toEqual([
        expect.objectContaining({
          applicationId,
          controlValues: expect.objectContaining({
            name: "Grace Hopper",
            role: "Engineer"
        })
        }),
      ]);
      expect(getRecipeTextValues(applicationId!)).toEqual([
        "Engineer",
        "Grace Hopper",
      ]);
      expect(
        useEngineStore
          .getState()
          .getGraphicsEngine()
          ?.getAllShapeClips()
          .filter(
            (clip) => clip.metadata?.templateSource?.applicationId === applicationId,
          ),
      ).toHaveLength(1);
    });

    it("undos and redoes a recipe update between previous and current controls", async () => {
      useProjectStore.getState().loadProject(createProjectWithEditableClip());

      const applicationId = useProjectStore.getState().applyEditingTemplate(
        "branding-lower-third",
        "video-clip-1",
        {
          name: "Ada Lovelace",
          role: "Director"
        },
      );

      expect(applicationId).toBeTruthy();
      expect(
        useProjectStore.getState().updateEditingTemplateApplication(
          "video-clip-1",
          applicationId!,
          {
            name: "Grace Hopper",
            role: "Engineer"
        },
        ),
      ).toBe(true);
      expect(getRecipeTextValues(applicationId!)).toEqual([
        "Engineer",
        "Grace Hopper",
      ]);

      await useProjectStore.getState().undo();
      expect(getRecipeTextValues(applicationId!)).toEqual([
        "Ada Lovelace",
        "Director",
      ]);
      expect(
        useProjectStore.getState().getClip("video-clip-1")?.metadata?.appliedTemplates,
      ).toEqual([
        expect.objectContaining({
          applicationId,
          controlValues: expect.objectContaining({
            name: "Ada Lovelace",
            role: "Director"
        })
        }),
      ]);

      await useProjectStore.getState().redo();
      expect(getRecipeTextValues(applicationId!)).toEqual([
        "Engineer",
        "Grace Hopper",
      ]);
      expect(
        useProjectStore.getState().getClip("video-clip-1")?.metadata?.appliedTemplates,
      ).toEqual([
        expect.objectContaining({
          applicationId,
          controlValues: expect.objectContaining({
            name: "Grace Hopper",
            role: "Engineer"
        })
        }),
      ]);
    });

    it("undos newer timeline actions before undoing a recipe and can redo the recipe", async () => {
      useProjectStore.getState().loadProject(createProjectWithEditableClip());

      const applicationId = useProjectStore.getState().applyEditingTemplate(
        "branding-lower-third",
        "video-clip-1",
      );

      expect(applicationId).toBeTruthy();
      expect(useProjectStore.getState().project.timeline.tracks).toHaveLength(3);

      await useProjectStore.getState().addTrack("audio");
      expect(useProjectStore.getState().project.timeline.tracks).toHaveLength(4);

      await useProjectStore.getState().undo();
      expect(useProjectStore.getState().project.timeline.tracks).toHaveLength(3);
      expect(
        useProjectStore.getState().getClip("video-clip-1")?.metadata?.appliedTemplates,
      ).toHaveLength(1);

      await useProjectStore.getState().undo();
      expect(
        useProjectStore.getState().getClip("video-clip-1")?.metadata?.appliedTemplates || [],
      ).toHaveLength(0);
      expect(
        useEngineStore.getState().getGraphicsEngine()?.getAllShapeClips(),
      ).toHaveLength(0);
      expect(
        useEngineStore.getState().getTitleEngine()?.getAllTextClips(),
      ).toHaveLength(0);

      await useProjectStore.getState().redo();
      expect(
        useProjectStore.getState().getClip("video-clip-1")?.metadata?.appliedTemplates,
      ).toHaveLength(1);
      expect(
        useEngineStore.getState().getGraphicsEngine()?.getAllShapeClips(),
      ).toHaveLength(1);
      expect(
        useEngineStore.getState().getTitleEngine()?.getAllTextClips(),
      ).toHaveLength(2);
    });
  });

  describe("clip transitions", () => {
    const createProjectWithAdjacentClips = (): Project => ({
      id: "transition-project",
      name: "Transition Project",
      createdAt: Date.now(),
      modifiedAt: Date.now(),
      settings: {
        width: 1920,
        height: 1080,
        frameRate: 30,
        sampleRate: 48000,
        channels: 2
        },
      mediaLibrary: { items: [] },
      generatedImageDefinitions: [],
      timeline: {
        tracks: [
          {
            id: "video-track-1",
            type: "video",
            name: "Video",
            clips: [
              {
                id: "clip-a",
                type: "video",
                mediaId: "video-a",
                trackId: "video-track-1",
                startTime: 0,
                duration: 4,
                inPoint: 0,
                outPoint: 4,
                effects: [],
                audioEffects: [],
                transform: {
                  position: { x: 0.5, y: 0.5 },
                  scale: { x: 1, y: 1 },
                  rotation: 0,
                  anchor: { x: 0.5, y: 0.5 },
                  opacity: 1
        },
                volume: 1,
                keyframes: []
        },
              {
                id: "clip-b",
                type: "video",
                mediaId: "video-b",
                trackId: "video-track-1",
                startTime: 4,
                duration: 4,
                inPoint: 0,
                outPoint: 4,
                effects: [],
                audioEffects: [],
                transform: {
                  position: { x: 0.5, y: 0.5 },
                  scale: { x: 1, y: 1 },
                  rotation: 0,
                  anchor: { x: 0.5, y: 0.5 },
                  opacity: 1
        },
                volume: 1,
                keyframes: []
        },
            ],
            transitions: [],
            locked: false,
            hidden: false,
            muted: false,
            solo: false
        },
        ],
        subtitles: [],
        duration: 8,
        markers: []
        }
        });

    it("should persist adjacent clip transitions and mirror them into the transition bridge", () => {
      useProjectStore.getState().loadProject(createProjectWithAdjacentClips());

      const transition: Transition = {
        id: "transition-1",
        clipAId: "clip-a",
        clipBId: "clip-b",
        type: "crossfade",
        duration: 0.5,
        params: { curve: "ease" }
        };

      const addedTransition = useProjectStore
        .getState()
        .addClipTransition(transition);
      const updatedTransition = useProjectStore
        .getState()
        .updateClipTransition("transition-1", {
          duration: 0.75,
          params: { curve: "linear" }
        });

      expect(addedTransition).toEqual(transition);
      expect(useProjectStore.getState().getClipTransitionBetweenClips("clip-a", "clip-b")).toEqual({
        id: "transition-1",
        clipAId: "clip-a",
        clipBId: "clip-b",
        type: "crossfade",
        duration: 0.75,
        params: { curve: "linear" }
        });
      expect(updatedTransition).toEqual({
        id: "transition-1",
        clipAId: "clip-a",
        clipBId: "clip-b",
        type: "crossfade",
        duration: 0.75,
        params: { curve: "linear" }
        });
      expect(mockTransitionBridgeState.trackTransitions.get("video-track-1")).toEqual([
        {
          id: "transition-1",
          clipAId: "clip-a",
          clipBId: "clip-b",
          type: "crossfade",
          duration: 0.75,
          params: { curve: "linear" }
        },
      ]);

      const removedTransition = useProjectStore
        .getState()
        .removeClipTransition("transition-1");

      expect(removedTransition).toBe(true);
      expect(useProjectStore.getState().getClipTransition("transition-1")).toBeUndefined();
      expect(mockTransitionBridgeState.trackTransitions.get("video-track-1")).toEqual([]);
    });
  });

  describe("marker operations", () => {
    it("should add a marker", () => {
      useProjectStore.getState().addMarker(5, "Scene 1", "#ff0000");

      const markers = useProjectStore.getState().getMarkers();
      expect(markers.length).toBe(1);
      expect(markers[0].time).toBe(5);
      expect(markers[0].label).toBe("Scene 1");
    });

    it("should remove a marker", () => {
      useProjectStore.getState().addMarker(5, "Scene 1");
      const markers = useProjectStore.getState().getMarkers();
      const markerId = markers[0].id;

      useProjectStore.getState().removeMarker(markerId);

      const updatedMarkers = useProjectStore.getState().getMarkers();
      expect(updatedMarkers.length).toBe(0);
    });

    it("should get marker by id", () => {
      useProjectStore.getState().addMarker(10, "Marker Test");
      const markers = useProjectStore.getState().getMarkers();
      const markerId = markers[0].id;

      const marker = useProjectStore.getState().getMarker(markerId);
      expect(marker).toBeDefined();
      expect(marker?.time).toBe(10);
    });
  });

  describe("undo/redo", () => {
    it("should not be able to undo without actions", () => {
      expect(useProjectStore.getState().canUndo()).toBe(false);
    });

    it("should not be able to redo without undone actions", () => {
      expect(useProjectStore.getState().canRedo()).toBe(false);
    });

    it("should be able to undo after an action", async () => {
      await useProjectStore.getState().addTrack("video");
      expect(useProjectStore.getState().canUndo()).toBe(true);
    });
  });

  describe("clipboard operations", () => {
    it("should start with empty clipboard", () => {
      expect(useProjectStore.getState().clipboard).toEqual([]);
    });

    it("should copy clips to clipboard", () => {
      const mockClip: Clip = {
        id: "clip-to-copy",
        type: "video",
        mediaId: "media-1",
        trackId: "track-1",
        startTime: 0,
        duration: 5,
        inPoint: 0,
        outPoint: 5,
        effects: [],
        audioEffects: [],
        transform: {
          position: { x: 0.5, y: 0.5 },
          scale: { x: 1, y: 1 },
          rotation: 0,
          anchor: { x: 0.5, y: 0.5 },
          opacity: 1
        },
        volume: 1,
        keyframes: []
        };

      const projectWithClip: Project = {
        id: "test",
        name: "Test",
        createdAt: Date.now(),
        modifiedAt: Date.now(),
        settings: {
          width: 1920,
          height: 1080,
          frameRate: 30,
          sampleRate: 48000,
          channels: 2
        },
        mediaLibrary: { items: [] },
        generatedImageDefinitions: [],
        timeline: {
          tracks: [
            {
              id: "track-1",
              type: "video",
              name: "Video",
              clips: [mockClip],
              transitions: [],
              locked: false,
              hidden: false,
              muted: false,
              solo: false
        },
          ],
          subtitles: [],
          duration: 5,
          markers: []
        }
        };

      useProjectStore.getState().loadProject(projectWithClip);
      useProjectStore.getState().copyClips(["clip-to-copy"]);

      expect(useProjectStore.getState().clipboard.length).toBe(1);
    });
  });

  describe("separateAudio", () => {
    const createProjectWithVideoClip = (audioTrackCount?: number): Project => {
      const mediaItem: MediaItem = {
        id: "video-media-1",
        name: "multi-audio.mp4",
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
          fileSize: 1000000,
          audioTrackCount
        },
        thumbnailUrl: null};

      const videoClip: Clip = {
        id: "video-clip-1",
        type: "video",
        mediaId: "video-media-1",
        trackId: "video-track-1",
        startTime: 0,
        duration: 10,
        inPoint: 0,
        outPoint: 10,
        effects: [],
        audioEffects: [],
        transform: {
          position: { x: 0.5, y: 0.5 },
          scale: { x: 1, y: 1 },
          rotation: 0,
          anchor: { x: 0.5, y: 0.5 },
          opacity: 1
        },
        volume: 1,
        keyframes: []
        };

      return {
        id: "test-project",
        name: "Test",
        createdAt: Date.now(),
        modifiedAt: Date.now(),
        settings: {
          width: 1920,
          height: 1080,
          frameRate: 30,
          sampleRate: 48000,
          channels: 2
        },
        mediaLibrary: { items: [mediaItem] },
        generatedImageDefinitions: [],
        timeline: {
          tracks: [
            {
              id: "video-track-1",
              type: "video",
              name: "Video",
              clips: [videoClip],
              transitions: [],
              locked: false,
              hidden: false,
              muted: false,
              solo: false
        },
          ],
          subtitles: [],
          duration: 10,
          markers: []
        }
        };
    };

    it("should create one audio clip when media has a single audio track", async () => {
      useProjectStore.getState().loadProject(createProjectWithVideoClip(1));
      const result = await useProjectStore.getState().separateAudio("video-clip-1");

      expect(result.success).toBe(true);
      const { project } = useProjectStore.getState();
      const audioTracks = project.timeline.tracks.filter((t) => t.type === "audio");
      expect(audioTracks.length).toBe(1);
      expect(audioTracks[0].clips.length).toBe(1);
      expect(audioTracks[0].clips[0].mediaId).toBe("video-media-1");
    });

    it("should create multiple audio clips when media has multiple audio tracks", async () => {
      useProjectStore.getState().loadProject(createProjectWithVideoClip(3));
      const result = await useProjectStore.getState().separateAudio("video-clip-1");

      expect(result.success).toBe(true);
      const { project } = useProjectStore.getState();
      const audioTracks = project.timeline.tracks.filter((t) => t.type === "audio");
      expect(audioTracks.length).toBe(3);

      // Each audio track should have one clip with the correct audioTrackIndex
      for (let i = 0; i < 3; i++) {
        expect(audioTracks[i].clips.length).toBe(1);
        expect(audioTracks[i].clips[0].mediaId).toBe("video-media-1");
        expect(audioTracks[i].clips[0].audioTrackIndex).toBe(i);
      }
    });

    it("regression: preserves the source clip trim when separating audio", async () => {
      const project = createProjectWithVideoClip(1);
      const sourceClip = project.timeline.tracks[0].clips[0];
      project.timeline.tracks[0].clips[0] = {
        ...sourceClip,
        startTime: 12,
        duration: 3,
        inPoint: 7,
        outPoint: 10,
      };

      useProjectStore.getState().loadProject(project);
      const result = await useProjectStore.getState().separateAudio("video-clip-1");

      expect(result.success).toBe(true);
      const audioClip = useProjectStore.getState().project.timeline.tracks
        .find((track) => track.type === "audio")?.clips[0];
      expect(audioClip).toEqual(expect.objectContaining({
        startTime: 12,
        duration: 3,
        inPoint: 7,
        outPoint: 10,
      }));
    });

    it("should default to one audio track when audioTrackCount is undefined", async () => {
      useProjectStore.getState().loadProject(createProjectWithVideoClip(undefined));
      const result = await useProjectStore.getState().separateAudio("video-clip-1");

      expect(result.success).toBe(true);
      const { project } = useProjectStore.getState();
      const audioTracks = project.timeline.tracks.filter((t) => t.type === "audio");
      expect(audioTracks.length).toBe(1);
    });

    it("should return an error when clip is not found", async () => {
      await useProjectStore.getState().createNewProject();
      const result = await useProjectStore.getState().separateAudio("non-existent-clip");

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("CLIP_NOT_FOUND");
    });
  });
});

describe("ProjectStore - Text Clips", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    mockConfirmedBackendCreate();
    await useProjectStore.getState().createNewProject();
    await useProjectStore.getState().addTrack("text");
  });

  it("should create a text clip", async () => {
    const { project } = useProjectStore.getState();
    const trackId = project.timeline.tracks[0].id;

    const textClip = useProjectStore
      .getState()
      .createTextClip(trackId, 0, "Hello World", 5);

    expect(textClip).toBeDefined();
    expect(textClip?.text).toBe("Hello World");
    expect(textClip?.duration).toBe(5);
  });

  it("should get all text clips", async () => {
    const { project } = useProjectStore.getState();
    const trackId = project.timeline.tracks[0].id;

    const initialCount = useProjectStore.getState().getAllTextClips().length;

    useProjectStore.getState().createTextClip(trackId, 0, "First", 3);
    useProjectStore.getState().createTextClip(trackId, 3, "Second", 3);

    const allTextClips = useProjectStore.getState().getAllTextClips();
    expect(allTextClips.length).toBe(initialCount + 2);
  });

  it("should get available animation presets", () => {
    const presets = useProjectStore.getState().getAvailableAnimationPresets();
    expect(Array.isArray(presets)).toBe(true);
  });
});

describe("ProjectStore - Subtitles (consolidated into text clips)", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    mockConfirmedBackendCreate();
    await useProjectStore.getState().createNewProject();
    const titleEngine = useEngineStore.getState().getTitleEngine();
    const graphicsEngine = useEngineStore.getState().getGraphicsEngine();
    titleEngine?.loadTextClips([]);
    graphicsEngine?.loadShapeClips([]);
    graphicsEngine?.loadSVGClips([]);
    graphicsEngine?.loadStickerClips([]);
  });

  it.skip("should add a subtitle - skipped: subtitles consolidated into text clips", () => {
    // Subtitles are now created as text clips on a Captions track
    // The addSubtitle function creates text clips, but getSubtitle reads from the old subtitles array
    // This test is skipped until the API is fully migrated
  });

  it.skip("should remove a subtitle - skipped: subtitles consolidated into text clips", () => {
    // Subtitles are now created as text clips on a Captions track
  });

  it.skip("should update a subtitle - skipped: subtitles consolidated into text clips", () => {
    // Subtitles are now created as text clips on a Captions track
  });

  it.skip("should export SRT - skipped: subtitles consolidated into text clips", () => {
    // SRT export now uses text clips from Captions track
  });

  it("should get subtitle style presets", async () => {
    const presets = await useProjectStore.getState().getSubtitleStylePresets();
    expect(Array.isArray(presets)).toBe(true);
  });

  it("imports SRT subtitles into a Captions text track", async () => {
    const srt = `1
00:00:00,000 --> 00:00:02,000
Hello world

2
00:00:02,500 --> 00:00:04,000
Second caption`;

    const result = await useProjectStore.getState().importSRT(srt);

    expect(result.success).toBe(true);
    expect(result.errors).toEqual([]);

    const state = useProjectStore.getState();
    const captionsTrack = state.project.timeline.tracks.find(
      (track) => track.type === "text" && track.name === "Captions",
    );
    expect(captionsTrack).toBeDefined();

    const captionClips = state
      .getAllTextClips()
      .filter((clip) => clip.trackId === captionsTrack?.id)
      .sort((a, b) => a.startTime - b.startTime);

    expect(captionClips).toHaveLength(2);
    expect(captionClips[0]?.text).toBe("Hello world");
    expect(captionClips[0]?.startTime).toBe(0);
    expect(captionClips[0]?.duration).toBe(2);
    expect(captionClips[1]?.text).toBe("Second caption");
    expect(captionClips[1]?.startTime).toBe(2.5);
    expect(captionClips[1]?.duration).toBe(1.5);
  });

  it("returns warnings when an SRT has invalid segments but still imports valid captions", async () => {
    const srt = `1
00:00:00,000 --> 00:00:02,000
Hello world

bad-index
00:00:03,000 --> 00:00:04,000
Ignored block`;

    const result = await useProjectStore.getState().importSRT(srt);

    expect(result.success).toBe(true);
    expect(result.errors.length).toBeGreaterThan(0);

    const state = useProjectStore.getState();
    const captionsTrack = state.project.timeline.tracks.find(
      (track) => track.type === "text" && track.name === "Captions",
    );
    const captionClips = state
      .getAllTextClips()
      .filter((clip) => clip.trackId === captionsTrack?.id);

    expect(captionClips).toHaveLength(1);
    expect(captionClips[0]?.text).toBe("Hello world");
  });

  describe("generated image lifecycle commands", () => {
    const createDefinition = (
      id: string,
      overrides: Partial<Project["generatedImageDefinitions"][number]> = {},
    ): Project["generatedImageDefinitions"][number] => ({
      id,
      projectId: "project-1",
      assetGroupId: `${id}-group`,
      currentMediaVersionId: `${id}-media`,
      title: id,
      draft: {
        prompt: `${id} prompt`,
        roleByReferenceKey: {},
        inputs: {},
      },
      attemptIds: [],
      createdAt: "2026-07-16T00:00:00.000Z",
      updatedAt: "2026-07-16T00:00:00.000Z",
      ...overrides,
    });

    it("creates a placeholder media item and generated image definition", async () => {
      const result = await useProjectStore.getState().createGeneratedImage({
        title: "Storm lighthouse",
      });

      expect(result.success).toBe(true);
      expect(result.definitionId).toBeDefined();
      expect(result.mediaId).toBeDefined();

      const project = useProjectStore.getState().project;
      const definition = project.generatedImageDefinitions.find(
        (entry) => entry.id === result.definitionId,
      );
      const media = project.mediaLibrary.items.find((entry) => entry.id === result.mediaId);

      expect(definition).toMatchObject({
        title: "Storm lighthouse",
        currentMediaVersionId: result.mediaId,
      });
      expect(media).toMatchObject({
        id: result.mediaId,
        type: "image",
        title: "Storm lighthouse",
        isCurrent: true,
        generationMeta: {
          prompt: "Storm lighthouse",
          status: "unrealized",
        },
      });
      expect(media?.assetGroupId).toBe(definition?.assetGroupId);
    });

    it("converts an imported image idempotently without replacing blob identity", async () => {
      const blob = new Blob(["pixels"], { type: "image/png" });
      const imported: MediaItem = {
        id: "imported-1",
        name: "reference.png",
        type: "image",
        fileHandle: null,
        blob,
        metadata: {
          duration: 0,
          width: 1024,
          height: 1024,
          frameRate: 0,
          codec: "png",
          sampleRate: 0,
          channels: 0,
          fileSize: blob.size,
        },
        thumbnailUrl: null,
        assetGroupId: "asset-imported-1",
        isCurrent: true,
      };
      const baseProject = useProjectStore.getState().project;
      useProjectStore.getState().loadProject({
        ...baseProject,
        mediaLibrary: {
          ...baseProject.mediaLibrary,
          items: [imported],
        },
        generatedImageDefinitions: [],
      });

      const first = await useProjectStore.getState().convertImportedImage({ mediaId: "imported-1" });
      const second = await useProjectStore.getState().convertImportedImage({ mediaId: "imported-1" });

      expect(first).toEqual({
        success: true,
        definitionId: first.definitionId,
      });
      expect(second).toEqual(first);

      const project = useProjectStore.getState().project;
      const media = project.mediaLibrary.items.find((entry) => entry.id === "imported-1");
      const definition = project.generatedImageDefinitions.find(
        (entry) => entry.id === first.definitionId,
      );

      expect(media?.blob).toBe(blob);
      expect(media?.name).toBe("reference.png");
      expect(media?.generationMeta).toBeUndefined();
      expect(definition).toMatchObject({
        sourceMediaVersionId: "imported-1",
        currentMediaVersionId: "imported-1",
        title: "reference.png",
      });
      expect(project.generatedImageDefinitions).toHaveLength(1);
    });

    it("updates generated image drafts through undo and redo", async () => {
      const baseProject = useProjectStore.getState().project;
      useProjectStore.getState().loadProject({
        ...baseProject,
        generatedImageDefinitions: [
          createDefinition("definition-1", {
            draft: {
              prompt: "before",
              roleByReferenceKey: {},
              inputs: {},
            },
          }),
        ],
      });

      const updated = await useProjectStore.getState().updateGeneratedImageDraft({
        definitionId: "definition-1",
        patch: { prompt: "after" },
      });

      expect(updated).toEqual({ success: true });
      expect(useProjectStore.getState().project.generatedImageDefinitions[0]?.draft.prompt).toBe(
        "after",
      );
      expect(useProjectStore.getState().canUndo()).toBe(true);

      await useProjectStore.getState().undo();
      expect(useProjectStore.getState().project.generatedImageDefinitions[0]?.draft.prompt).toBe(
        "before",
      );

      await useProjectStore.getState().redo();
      expect(useProjectStore.getState().project.generatedImageDefinitions[0]?.draft.prompt).toBe(
        "after",
      );
    });

    it("passes through typed confirmation payloads when deleting a referenced generated image", async () => {
      const baseProject = useProjectStore.getState().project;
      useProjectStore.getState().loadProject({
        ...baseProject,
        mediaLibrary: {
          ...baseProject.mediaLibrary,
          items: [
            {
              id: "definition-1-media",
              name: "placeholder.png",
              title: "placeholder",
              type: "image",
              fileHandle: null,
              blob: null,
              metadata: {
                duration: 0,
                width: 1024,
                height: 1024,
                frameRate: 0,
                codec: "png",
                sampleRate: 0,
                channels: 0,
                fileSize: 0,
              },
              thumbnailUrl: null,
              assetGroupId: "definition-1-group",
              isCurrent: true,
              generationMeta: {
                provider: "generated-image",
                model: "draft",
                status: "unrealized",
              },
            },
          ],
        },
        generatedImageDefinitions: [
          createDefinition("definition-1", {
            assetGroupId: "definition-1-group",
            currentMediaVersionId: "definition-1-media",
          }),
          createDefinition("definition-2", {
            draft: {
              prompt: "dependent",
              roleByReferenceKey: {},
              inputs: { generatedImageDefinitionIds: ["definition-1"] },
            },
          }),
        ],
      });

      const beforeDelete = useProjectStore.getState().project;
      const pending = await useProjectStore.getState().deleteGeneratedImage({
        definitionId: "definition-1",
      });
      expect(pending).toEqual({
        success: false,
        requiresConfirmation: true,
        affectedDefinitionIds: ["definition-2"],
        error: {
          code: "INVALID_PARAMS",
          message: "Generated image definition definition-1 is still referenced",
          details: {
            projectId: beforeDelete.id,
            definitionId: "definition-1",
            affectedDefinitionIds: ["definition-2"],
          },
        },
      });
      expect(useProjectStore.getState().project).toBe(beforeDelete);

      const confirmed = await useProjectStore.getState().deleteGeneratedImage({
        definitionId: "definition-1",
        confirmed: true,
      });
      expect(confirmed).toEqual({ success: true });
      expect(
        useProjectStore.getState().project.generatedImageDefinitions.map((entry) => entry.id),
      ).toEqual(["definition-2"]);
      expect(useProjectStore.getState().project.mediaLibrary.items).toHaveLength(0);
    });

    it("returns structured media identifiers on missing imported media", async () => {
      const before = useProjectStore.getState().project;

      const result = await useProjectStore.getState().convertImportedImage({
        mediaId: "missing-media",
      });

      expect(result).toEqual({
        success: false,
        error: {
          code: "MEDIA_NOT_FOUND",
          message: "Media item not found: missing-media",
          details: {
            projectId: before.id,
            mediaId: "missing-media",
          },
        },
      });
      expect(useProjectStore.getState().project).toBe(before);
    });

    it("returns structured definition identifiers on missing generated image definitions", async () => {
      const before = useProjectStore.getState().project;

      const result = await useProjectStore.getState().deleteGeneratedImage({
        definitionId: "missing-definition",
      });

      expect(result).toEqual({
        success: false,
        error: {
          code: "MEDIA_NOT_FOUND",
          message: "Generated image definition not found: missing-definition",
          details: {
            projectId: before.id,
            definitionId: "missing-definition",
          },
        },
      });
      expect(useProjectStore.getState().project).toBe(before);
    });
  });
});
