/**
 * Music Video feature store.
 *
 * Persisted to IndexedDB via zustand/middleware persist so everything
 * survives page refresh (spec requirement).
 *
 * One MusicVideoProject per OpenReel project (keyed by openreelProjectId).
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { v4 as uuidv4 } from "uuid";
import type { Clip, MediaItem, Project } from "@openreel/core";
import {
  createSceneProjectionMetadata,
  getSceneIdFromClip,
  DEFAULT_ASPECT_RATIO,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_RESOLUTION,
  DEFAULT_SHOT_MODEL,
  type AudioAsset,
  type CreativeBrief,
  type GeneratedAsset,
  type GenerationJob,
  type MetadataBlock,
  type MetadataTrack,
  type MusicVideoProject,
  type NeuralFramesImportResult,
  type StoryboardShot,
  type SceneProjectionSource,
  type TimingAnalysis,
} from "@openreel/music-video-domain";
import { useProjectStore } from "./project-store";
import { registerSceneHistoryAdapter, SCENE_HISTORY_ACTION } from "./scene-history-bridge";

export type SceneOperationErrorCode =
  | "MISSING_PROJECT"
  | "MISSING_SCENE"
  | "MISSING_CLIP"
  | "MISSING_TRACK"
  | "INCOMPATIBLE_TRACK"
  | "LOCKED_TRACK"
  | "MISSING_MEDIA"
  | "NON_VIDEO_MEDIA"
  | "NON_VIDEO_CLIP"
  | "SCENE_HAS_PROJECTIONS"
  | "PLACEMENT_FAILED";

export interface SceneOperationError {
  code: SceneOperationErrorCode;
  message: string;
}

export type SceneOperationResult<T = undefined> =
  | { success: true; value: T }
  | { success: false; error: SceneOperationError };

interface SceneHistoryEntry {
  beforeMusicProject: MusicVideoProject;
  afterMusicProject: MusicVideoProject;
  beforeEditorProject: Project;
  afterEditorProject: Project;
}

// ── Orchestrator base URL (Vite env var or localhost fallback) ─────────────────
export const ORCHESTRATOR_URL =
  (import.meta.env["VITE_ORCHESTRATOR_URL"] as string | undefined) ??
  "http://localhost:4041";

// ── State ─────────────────────────────────────────────────────────────────────

interface MusicVideoState {
  /** All music video projects, keyed by openreelProjectId */
  projects: Record<string, MusicVideoProject>;

  /** Which project is currently active in the UI */
  activeProjectId: string | null;

  // ── Project CRUD ────────────────────────────────────────────────────────────
  createProject: (openreelProjectId: string, title: string) => MusicVideoProject;
  getProject: (openreelProjectId: string) => MusicVideoProject | null;

  // ── Audio ───────────────────────────────────────────────────────────────────
  setAudio: (openreelProjectId: string, audio: AudioAsset) => void;
  setTiming: (openreelProjectId: string, timing: TimingAnalysis) => void;

  // ── Creative brief ──────────────────────────────────────────────────────────
  updateCreativeBrief: (openreelProjectId: string, patch: Partial<CreativeBrief>) => void;

  // ── Shots ────────────────────────────────────────────────────────────────────
  setShots: (openreelProjectId: string, shots: StoryboardShot[]) => void;
  patchShot: (openreelProjectId: string, shotId: string, patch: Partial<StoryboardShot>) => void;
  selectShot: (openreelProjectId: string, shotId: string, selected: boolean) => void;
  selectAllShots: (openreelProjectId: string, selected: boolean) => void;

  // ── Generated assets ─────────────────────────────────────────────────────────
  addGeneratedAsset: (openreelProjectId: string, asset: GeneratedAsset) => void;
  patchGeneratedAsset: (openreelProjectId: string, assetId: string, patch: Partial<GeneratedAsset>) => void;

  // ── Metadata tracks ──────────────────────────────────────────────────────────
  setMetadataTracks: (openreelProjectId: string, tracks: MetadataTrack[]) => void;
  patchMetadataBlock: (openreelProjectId: string, blockId: string, patch: Partial<MetadataBlock>) => void;

  // ── Generation jobs ──────────────────────────────────────────────────────────
  addJob: (openreelProjectId: string, job: GenerationJob) => void;
  patchJob: (openreelProjectId: string, jobId: string, patch: Partial<GenerationJob>) => void;

  // ── Neural Frames import ─────────────────────────────────────────────────────
  applyNeuralFramesImport: (openreelProjectId: string, result: NeuralFramesImportResult) => void;

  // ── Atomic scene operations ─────────────────────────────────────────────────
  createScene: (input?: Partial<StoryboardShot>) => SceneOperationResult<string>;
  updateScene: (sceneId: string, patch: Partial<StoryboardShot>) => SceneOperationResult;
  deleteScene: (sceneId: string) => SceneOperationResult;
  placeScene: (input: {
    sceneId: string;
    trackId: string;
    startTime: number;
    source?: SceneProjectionSource;
  }) => Promise<SceneOperationResult<string>>;
  createAndPlaceScene: (input: {
    trackId: string;
    startTime: number;
  }) => Promise<SceneOperationResult<{ sceneId: string; clipId: string }>>;
  associateSceneMedia: (input: { sceneId: string; mediaId: string }) => SceneOperationResult;
  linkClipToScene: (input: { clipId: string; sceneId: string }) => SceneOperationResult;
  convertClipToScene: (input: {
    clipId: string;
    initialSceneFields?: Partial<StoryboardShot>;
  }) => SceneOperationResult<string>;
  getScene: (sceneId: string) => StoryboardShot | undefined;
  getSceneProjections: (sceneId: string) => Clip[];
  getSceneProjectionCount: (sceneId: string) => number;
  sceneUndoStack: SceneHistoryEntry[];
  sceneRedoStack: SceneHistoryEntry[];
}

// ── Default creative brief ────────────────────────────────────────────────────

const DEFAULT_BRIEF: CreativeBrief = {
  format: "narrative",
  genre: "custom",
  visualStyle: "cinematic",
  pacing: "medium",
  continuity: "independent shots",
  colorPalette: [],
  cameraLanguage: "",
  subjectNotes: "",
  customPrompt: "",
  defaults: {
    provider: "kie-ai",
    shotModel: DEFAULT_SHOT_MODEL,
    referenceModel: DEFAULT_IMAGE_MODEL,
    resolution: DEFAULT_RESOLUTION,
    aspectRatio: DEFAULT_ASPECT_RATIO,
  },
};

const ok = <T>(value: T): SceneOperationResult<T> => ({ success: true, value });
const fail = (code: SceneOperationErrorCode, message: string): SceneOperationResult<never> => ({
  success: false,
  error: { code, message },
});

function activeMusicProject(state: Pick<MusicVideoState, "activeProjectId" | "projects">) {
  const id = state.activeProjectId;
  return id ? { id, project: state.projects[id] } : undefined;
}

function collisionSafeId(prefix: string, state: Pick<MusicVideoState, "projects">): string {
  const editor = useProjectStore.getState().project;
  const used = new Set<string>([
    ...Object.values(state.projects).flatMap((project) => project.shots.map((shot) => shot.id)),
    ...editor.mediaLibrary.items.map((item) => item.id),
    ...editor.timeline.tracks.flatMap((track) => [track.id, ...track.clips.map((clip) => clip.id)]),
  ]);
  let id: string;
  do id = `${prefix}-${uuidv4()}`;
  while (used.has(id));
  return id;
}

function normalizeScene(scene: StoryboardShot, index: number): StoryboardShot {
  return {
    ...scene,
    index: Number.isFinite(scene.index) ? scene.index : index,
    label: scene.label || "Untitled Scene",
    prompt: scene.prompt ?? "",
    model: scene.model || DEFAULT_SHOT_MODEL,
    resolution: scene.resolution || DEFAULT_RESOLUTION,
    aspectRatio: scene.aspectRatio || DEFAULT_ASPECT_RATIO,
    includeMainAudio: scene.includeMainAudio ?? false,
    source: scene.source ?? "manual",
    referenceAssetIds: scene.referenceAssetIds ?? [],
    generatedAssetIds: scene.generatedAssetIds ?? [],
    validation: scene.validation ?? { valid: true, warnings: [], errors: [] },
    outputs: scene.outputs ?? [],
    selected: scene.selected ?? false,
  };
}

function normalizeMusicProject(project: MusicVideoProject): MusicVideoProject {
  return {
    ...project,
    shots: (project.shots ?? []).map(normalizeScene),
    metadataTracks: project.metadataTracks ?? [],
    generatedAssets: project.generatedAssets ?? [],
    generationJobs: project.generationJobs ?? [],
  };
}

function createManualScene(
  id: string,
  index: number,
  input: Partial<StoryboardShot> = {},
): StoryboardShot {
  return normalizeScene(
    {
      label: "Untitled Scene",
      prompt: "",
      model: DEFAULT_SHOT_MODEL,
      resolution: DEFAULT_RESOLUTION,
      aspectRatio: DEFAULT_ASPECT_RATIO,
      includeMainAudio: false,
      source: "manual",
      referenceAssetIds: [],
      generatedAssetIds: [],
      validation: { valid: true, warnings: [], errors: [] },
      outputs: [],
      selected: false,
      ...input,
      id,
      index,
    },
    index,
  );
}

function findInternalPlaceholder(project: Project, sceneId: string): MediaItem | undefined {
  return project.mediaLibrary.items.find(
    (item) =>
      item.generationMeta?.provider === "openreel" &&
      item.generationMeta.inputs?.["internalScenePlaceholder"] === true &&
      item.generationMeta.inputs?.["sceneId"] === sceneId,
  );
}

function createInternalPlaceholder(scene: StoryboardShot, id: string): MediaItem {
  return {
    id,
    name: `${scene.label || "Untitled Scene"}.scene`,
    title: scene.label || "Untitled Scene",
    type: "video",
    fileHandle: null,
    blob: null,
    thumbnailUrl: scene.referenceImageUrl ?? null,
    metadata: {
      duration: 5,
      width: 0,
      height: 0,
      frameRate: 0,
      codec: "scene-placeholder",
      sampleRate: 0,
      channels: 0,
      fileSize: 0,
    },
    generationMeta: {
      provider: "openreel",
      model: "scene",
      status: "unrealized",
      inputs: { internalScenePlaceholder: true, sceneId: scene.id },
    },
  };
}

function projectionsForScene(editor: Project, sceneId: string): Clip[] {
  return editor.timeline.tracks.flatMap((track) =>
    track.clips.filter((clip) => getSceneIdFromClip(clip) === sceneId),
  );
}

function publishSceneHistory(projectId: string, entry: SceneHistoryEntry): void {
  const id = uuidv4();
  const action = {
    type: SCENE_HISTORY_ACTION,
    id,
    timestamp: Date.now(),
    params: { sceneHistory: { projectId, entry } },
  };
  useProjectStore.getState().actionHistory.push(action, action);
}

async function addSceneClipWithoutHistory(
  trackId: string,
  mediaId: string,
  startTime: number,
  metadata: Record<string, unknown>,
) {
  const editorState = useProjectStore.getState();
  const project = structuredClone(editorState.project);
  const result = await editorState.actionExecutor.executeWithoutHistory(
    {
      type: "clip/add",
      id: uuidv4(),
      timestamp: Date.now(),
      params: { trackId, mediaId, startTime, type: "video", metadata },
    },
    project,
  );
  if (result.success) {
    useProjectStore.setState({ project: { ...project, modifiedAt: Date.now() } });
  }
  return result;
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useMusicVideoStore = create<MusicVideoState>()(
  persist(
    (set, get) => ({
      projects: {},
      activeProjectId: null,
      sceneUndoStack: [],
      sceneRedoStack: [],

      createProject: (openreelProjectId, title) => {
        const now = new Date().toISOString();
        const project: MusicVideoProject = {
          id: crypto.randomUUID(),
          title,
          openreelProjectId,
          audio: null,
          creativeBrief: { ...DEFAULT_BRIEF },
          timing: null,
          metadataTracks: [],
          generatedAssets: [],
          shots: [],
          generationJobs: [],
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({
          projects: { ...s.projects, [openreelProjectId]: project },
          activeProjectId: openreelProjectId,
        }));
        return project;
      },

      getProject: (id) => get().projects[id] ?? null,

      setAudio: (id, audio) =>
        set((s) => patchProject(s, id, { audio, updatedAt: now() })),

      setTiming: (id, timing) =>
        set((s) => patchProject(s, id, { timing, updatedAt: now() })),

      updateCreativeBrief: (id, patch) =>
        set((s) => {
          const p = s.projects[id];
          if (!p) return s;
          return patchProject(s, id, {
            creativeBrief: { ...p.creativeBrief, ...patch },
            updatedAt: now(),
          });
        }),

      setShots: (id, shots) =>
        set((s) => patchProject(s, id, { shots, updatedAt: now() })),

      patchShot: (id, shotId, patch) =>
        set((s) => {
          const p = s.projects[id];
          if (!p) return s;
          return patchProject(s, id, {
            shots: p.shots.map((sh) => (sh.id === shotId ? { ...sh, ...patch } : sh)),
            updatedAt: now(),
          });
        }),

      selectShot: (id, shotId, selected) =>
        set((s) => {
          const p = s.projects[id];
          if (!p) return s;
          return patchProject(s, id, {
            shots: p.shots.map((sh) => (sh.id === shotId ? { ...sh, selected } : sh)),
          });
        }),

      selectAllShots: (id, selected) =>
        set((s) => {
          const p = s.projects[id];
          if (!p) return s;
          return patchProject(s, id, {
            shots: p.shots.map((sh) => ({ ...sh, selected })),
          });
        }),

      addGeneratedAsset: (id, asset) =>
        set((s) => {
          const p = s.projects[id];
          if (!p) return s;
          return patchProject(s, id, {
            generatedAssets: [...p.generatedAssets, asset],
            updatedAt: now(),
          });
        }),

      patchGeneratedAsset: (id, assetId, patch) =>
        set((s) => {
          const p = s.projects[id];
          if (!p) return s;
          return patchProject(s, id, {
            generatedAssets: p.generatedAssets.map((a) =>
              a.id === assetId ? { ...a, ...patch } : a,
            ),
            updatedAt: now(),
          });
        }),

      setMetadataTracks: (id, metadataTracks) =>
        set((s) => patchProject(s, id, { metadataTracks, updatedAt: now() })),

      patchMetadataBlock: (id, blockId, patch) =>
        set((s) => {
          const p = s.projects[id];
          if (!p) return s;
          return patchProject(s, id, {
            metadataTracks: p.metadataTracks.map((t) => ({
              ...t,
              blocks: t.blocks.map((b) => (b.id === blockId ? { ...b, ...patch } : b)),
            })),
            updatedAt: now(),
          });
        }),

      addJob: (id, job) =>
        set((s) => {
          const p = s.projects[id];
          if (!p) return s;
          return patchProject(s, id, {
            generationJobs: [...p.generationJobs, job],
            updatedAt: now(),
          });
        }),

      patchJob: (id, jobId, patch) =>
        set((s) => {
          const p = s.projects[id];
          if (!p) return s;
          return patchProject(s, id, {
            generationJobs: p.generationJobs.map((j) => (j.id === jobId ? { ...j, ...patch } : j)),
            updatedAt: now(),
          });
        }),

      applyNeuralFramesImport: (id, result) =>
        set((s) => {
          const p = s.projects[id];
          if (!p) return s;
          // Merge: append new metadata tracks, replace shots, set timing from audio
          const merged: Partial<MusicVideoProject> = {
            metadataTracks: [...p.metadataTracks, ...result.metadataTracks],
            shots: result.shots,
            generatedAssets: [...p.generatedAssets, ...result.generatedAssets],
            neuralFramesImportId: result.storyboardId,
            updatedAt: now(),
          };
          const bpm = result.audio?.bpm;
          if (bpm != null && p.timing) {
            merged.timing = { ...p.timing, bpm };
          } else if (bpm != null) {
            merged.timing = {
              bpm,
              beats: [],
              bars: [],
              sections: [],
              energy: [],
              lyrics: [],
              source: "neuralframes",
            };
          }
          return patchProject(s, id, merged);
        }),

      createScene: (input = {}) => {
        const active = activeMusicProject(get());
        if (!active?.project) return fail("MISSING_PROJECT", "No active music video project.");
        const beforeEditor = structuredClone(useProjectStore.getState().project);
        const beforeMusic = structuredClone(active.project);
        const scene = createManualScene(
          collisionSafeId("scene", get()),
          active.project.shots.length,
          input,
        );
        const afterMusic = normalizeMusicProject({
          ...active.project,
          shots: [...active.project.shots, scene],
          updatedAt: now(),
        });
        set((state) => ({
          projects: { ...state.projects, [active.id]: afterMusic },
          sceneUndoStack: [
            ...state.sceneUndoStack,
            {
              beforeMusicProject: beforeMusic,
              afterMusicProject: structuredClone(afterMusic),
              beforeEditorProject: beforeEditor,
              afterEditorProject: structuredClone(beforeEditor),
            },
          ],
          sceneRedoStack: [],
        }));
        publishSceneHistory(active.id, get().sceneUndoStack.at(-1)!);
        return ok(scene.id);
      },

      updateScene: (sceneId, patch) => {
        const active = activeMusicProject(get());
        if (!active?.project) return fail("MISSING_PROJECT", "No active music video project.");
        const sceneIndex = active.project.shots.findIndex((scene) => scene.id === sceneId);
        if (sceneIndex < 0) return fail("MISSING_SCENE", `Scene ${sceneId} was not found.`);
        const beforeEditor = structuredClone(useProjectStore.getState().project);
        const beforeMusic = structuredClone(active.project);
        const shots = [...active.project.shots];
        shots[sceneIndex] = normalizeScene(
          { ...shots[sceneIndex], ...patch, id: sceneId, index: shots[sceneIndex].index },
          sceneIndex,
        );
        const afterMusic = normalizeMusicProject({ ...active.project, shots, updatedAt: now() });
        set((state) => ({
          projects: { ...state.projects, [active.id]: afterMusic },
          sceneUndoStack: [
            ...state.sceneUndoStack,
            {
              beforeMusicProject: beforeMusic,
              afterMusicProject: structuredClone(afterMusic),
              beforeEditorProject: beforeEditor,
              afterEditorProject: structuredClone(beforeEditor),
            },
          ],
          sceneRedoStack: [],
        }));
        publishSceneHistory(active.id, get().sceneUndoStack.at(-1)!);
        return ok(undefined);
      },

      deleteScene: (sceneId) => {
        const active = activeMusicProject(get());
        if (!active?.project) return fail("MISSING_PROJECT", "No active music video project.");
        const sceneIndex = active.project.shots.findIndex((scene) => scene.id === sceneId);
        if (sceneIndex < 0) return fail("MISSING_SCENE", `Scene ${sceneId} was not found.`);
        const beforeEditor = structuredClone(useProjectStore.getState().project);
        if (projectionsForScene(beforeEditor, sceneId).length > 0) {
          return fail(
            "SCENE_HAS_PROJECTIONS",
            "Remove this scene's timeline placements before deleting it.",
          );
        }
        const beforeMusic = structuredClone(active.project);
        const afterMusic = normalizeMusicProject({
          ...active.project,
          shots: active.project.shots
            .filter((scene) => scene.id !== sceneId)
            .map((scene, index) => normalizeScene({ ...scene, index }, index)),
          updatedAt: now(),
        });
        set((state) => ({
          projects: { ...state.projects, [active.id]: afterMusic },
          sceneUndoStack: [
            ...state.sceneUndoStack,
            {
              beforeMusicProject: beforeMusic,
              afterMusicProject: structuredClone(afterMusic),
              beforeEditorProject: beforeEditor,
              afterEditorProject: structuredClone(beforeEditor),
            },
          ],
          sceneRedoStack: [],
        }));
        publishSceneHistory(active.id, get().sceneUndoStack.at(-1)!);
        return ok(undefined);
      },

      placeScene: async ({ sceneId, trackId, startTime, source = "manual" }) => {
        const active = activeMusicProject(get());
        if (!active?.project) return fail("MISSING_PROJECT", "No active music video project.");
        const scene = active.project.shots.find((candidate) => candidate.id === sceneId);
        if (!scene) return fail("MISSING_SCENE", `Scene ${sceneId} was not found.`);
        const editorState = useProjectStore.getState();
        const track = editorState.getTrack(trackId);
        if (!track) return fail("MISSING_TRACK", `Track ${trackId} was not found.`);
        if (track.locked) return fail("LOCKED_TRACK", `Track ${trackId} is locked.`);
        if (track.type !== "video") {
          return fail("INCOMPATIBLE_TRACK", `Track ${trackId} does not accept video scenes.`);
        }
        const associated = scene.associatedMediaId
          ? editorState.getMediaItem(scene.associatedMediaId)
          : undefined;
        if (scene.associatedMediaId && !associated) {
          return fail("MISSING_MEDIA", `Media ${scene.associatedMediaId} was not found.`);
        }
        if (associated && associated.type !== "video") {
          return fail("NON_VIDEO_MEDIA", `Media ${associated.id} is not a video.`);
        }
        const beforeMusic = structuredClone(active.project);
        const beforeEditor = structuredClone(editorState.project);
        const existingPlaceholder = findInternalPlaceholder(editorState.project, scene.id);
        const placeholderId = existingPlaceholder?.id ?? collisionSafeId("scene-placeholder", get());
        const mediaId = associated?.id ?? placeholderId;
        if (!associated && !existingPlaceholder) {
          editorState.addPlaceholderMedia(createInternalPlaceholder(scene, placeholderId));
        }
        const result = await addSceneClipWithoutHistory(
          trackId,
          mediaId,
          startTime,
          createSceneProjectionMetadata(scene, source),
        );
        if (!result.success) {
          useProjectStore.setState({ project: beforeEditor });
          return fail("PLACEMENT_FAILED", result.error?.message ?? "Scene placement failed.");
        }
        const afterEditor = useProjectStore.getState().project;
        const oldClipIds = new Set(
          beforeEditor.timeline.tracks.flatMap((candidate) => candidate.clips.map((clip) => clip.id)),
        );
        const clip = afterEditor.timeline.tracks
          .flatMap((candidate) => candidate.clips)
          .find((candidate) => !oldClipIds.has(candidate.id));
        if (!clip) {
          useProjectStore.setState({ project: beforeEditor });
          return fail("PLACEMENT_FAILED", "Scene placement did not create a clip.");
        }
        set((state) => ({
          sceneUndoStack: [
            ...state.sceneUndoStack,
            {
              beforeMusicProject: beforeMusic,
              afterMusicProject: structuredClone(active.project),
              beforeEditorProject: beforeEditor,
              afterEditorProject: structuredClone(afterEditor),
            },
          ],
          sceneRedoStack: [],
        }));
        publishSceneHistory(active.id, get().sceneUndoStack.at(-1)!);
        return ok(clip.id);
      },

      createAndPlaceScene: async ({ trackId, startTime }) => {
        const editor = useProjectStore.getState().project;
        let active = get().projects[editor.id]
          ? { id: editor.id, project: get().projects[editor.id] }
          : undefined;
        if (!active?.project) {
          get().createProject(editor.id, editor.name);
          active = activeMusicProject(get());
        }
        if (!active?.project) return fail("MISSING_PROJECT", "No active music video project.");
        const editorState = useProjectStore.getState();
        const track = editorState.getTrack(trackId);
        if (!track) return fail("MISSING_TRACK", `Track ${trackId} was not found.`);
        if (track.locked) return fail("LOCKED_TRACK", `Track ${trackId} is locked.`);
        if (track.type !== "video") {
          return fail("INCOMPATIBLE_TRACK", `Track ${trackId} does not accept video scenes.`);
        }
        const beforeMusic = structuredClone(active.project);
        const beforeEditor = structuredClone(editorState.project);
        const scene = createManualScene(
          collisionSafeId("scene", get()),
          active.project.shots.length,
        );
        const afterMusic = normalizeMusicProject({
          ...active.project,
          shots: [...active.project.shots, scene],
          updatedAt: now(),
        });
        set((state) => ({ projects: { ...state.projects, [active.id]: afterMusic } }));
        const placeholderId = collisionSafeId("scene-placeholder", get());
        editorState.addPlaceholderMedia(createInternalPlaceholder(scene, placeholderId));
        const result = await addSceneClipWithoutHistory(
          trackId,
          placeholderId,
          startTime,
          createSceneProjectionMetadata(scene, "manual"),
        );
        if (!result.success) {
          set((state) => ({ projects: { ...state.projects, [active.id]: beforeMusic } }));
          useProjectStore.setState({ project: beforeEditor });
          return fail("PLACEMENT_FAILED", result.error?.message ?? "Scene placement failed.");
        }
        const afterEditor = useProjectStore.getState().project;
        const oldClipIds = new Set(
          beforeEditor.timeline.tracks.flatMap((candidate) => candidate.clips.map((clip) => clip.id)),
        );
        const clip = afterEditor.timeline.tracks
          .flatMap((candidate) => candidate.clips)
          .find((candidate) => !oldClipIds.has(candidate.id));
        if (!clip) {
          set((state) => ({ projects: { ...state.projects, [active.id]: beforeMusic } }));
          useProjectStore.setState({ project: beforeEditor });
          return fail("PLACEMENT_FAILED", "Scene placement did not create a clip.");
        }
        set((state) => ({
          sceneUndoStack: [
            ...state.sceneUndoStack,
            {
              beforeMusicProject: beforeMusic,
              afterMusicProject: structuredClone(afterMusic),
              beforeEditorProject: beforeEditor,
              afterEditorProject: structuredClone(afterEditor),
            },
          ],
          sceneRedoStack: [],
        }));
        publishSceneHistory(active.id, get().sceneUndoStack.at(-1)!);
        return ok({ sceneId: scene.id, clipId: clip.id });
      },

      associateSceneMedia: ({ sceneId, mediaId }) => {
        const active = activeMusicProject(get());
        if (!active?.project) return fail("MISSING_PROJECT", "No active music video project.");
        const index = active.project.shots.findIndex((scene) => scene.id === sceneId);
        if (index < 0) return fail("MISSING_SCENE", `Scene ${sceneId} was not found.`);
        const editorState = useProjectStore.getState();
        const media = editorState.getMediaItem(mediaId);
        if (!media) return fail("MISSING_MEDIA", `Media ${mediaId} was not found.`);
        if (media.type !== "video") return fail("NON_VIDEO_MEDIA", `Media ${mediaId} is not a video.`);
        const beforeMusic = structuredClone(active.project);
        const beforeEditor = structuredClone(editorState.project);
        const shots = [...active.project.shots];
        shots[index] = { ...shots[index], associatedMediaId: mediaId };
        const afterMusic = normalizeMusicProject({ ...active.project, shots, updatedAt: now() });
        set((state) => ({
          projects: { ...state.projects, [active.id]: afterMusic },
          sceneUndoStack: [
            ...state.sceneUndoStack,
            {
              beforeMusicProject: beforeMusic,
              afterMusicProject: structuredClone(afterMusic),
              beforeEditorProject: beforeEditor,
              afterEditorProject: structuredClone(beforeEditor),
            },
          ],
          sceneRedoStack: [],
        }));
        publishSceneHistory(active.id, get().sceneUndoStack.at(-1)!);
        return ok(undefined);
      },

      linkClipToScene: ({ clipId, sceneId }) => {
        const active = activeMusicProject(get());
        if (!active?.project) return fail("MISSING_PROJECT", "No active music video project.");
        const scene = active.project.shots.find((candidate) => candidate.id === sceneId);
        if (!scene) return fail("MISSING_SCENE", `Scene ${sceneId} was not found.`);
        const editorState = useProjectStore.getState();
        const clip = editorState.getClip(clipId);
        if (!clip) return fail("MISSING_CLIP", `Clip ${clipId} was not found.`);
        if (clip.type !== "video") return fail("NON_VIDEO_CLIP", `Clip ${clipId} is not a video clip.`);
        const beforeMusic = structuredClone(active.project);
        const beforeEditor = structuredClone(editorState.project);
        const metadata = { ...clip.metadata, ...createSceneProjectionMetadata(scene, "manual") };
        const tracks = beforeEditor.timeline.tracks.map((track) => ({
          ...track,
          clips: track.clips.map((candidate) =>
            candidate.id === clipId ? { ...candidate, metadata } : candidate,
          ),
        }));
        const afterEditor = {
          ...beforeEditor,
          timeline: { ...beforeEditor.timeline, tracks },
          modifiedAt: Date.now(),
        };
        useProjectStore.setState({ project: afterEditor });
        set((state) => ({
          sceneUndoStack: [
            ...state.sceneUndoStack,
            {
              beforeMusicProject: beforeMusic,
              afterMusicProject: structuredClone(active.project),
              beforeEditorProject: beforeEditor,
              afterEditorProject: structuredClone(afterEditor),
            },
          ],
          sceneRedoStack: [],
        }));
        publishSceneHistory(active.id, get().sceneUndoStack.at(-1)!);
        return ok(undefined);
      },

      convertClipToScene: ({ clipId, initialSceneFields = {} }) => {
        const active = activeMusicProject(get());
        if (!active?.project) return fail("MISSING_PROJECT", "No active music video project.");
        const editorState = useProjectStore.getState();
        const clip = editorState.getClip(clipId);
        if (!clip) return fail("MISSING_CLIP", `Clip ${clipId} was not found.`);
        if (clip.type !== "video") return fail("NON_VIDEO_CLIP", `Clip ${clipId} is not a video clip.`);
        const media = editorState.getMediaItem(clip.mediaId);
        if (!media) return fail("MISSING_MEDIA", `Media ${clip.mediaId} was not found.`);
        if (media.type !== "video") return fail("NON_VIDEO_MEDIA", `Media ${media.id} is not a video.`);
        const beforeMusic = structuredClone(active.project);
        const beforeEditor = structuredClone(editorState.project);
        const scene = createManualScene(
          collisionSafeId("scene", get()),
          active.project.shots.length,
          {
            label: media.title || media.name || "Untitled Scene",
            associatedMediaId: media.id,
            ...initialSceneFields,
          },
        );
        const afterMusic = normalizeMusicProject({
          ...active.project,
          shots: [...active.project.shots, scene],
          updatedAt: now(),
        });
        const metadata = { ...clip.metadata, ...createSceneProjectionMetadata(scene, "manual") };
        const tracks = beforeEditor.timeline.tracks.map((track) => ({
          ...track,
          clips: track.clips.map((candidate) =>
            candidate.id === clipId ? { ...candidate, metadata } : candidate,
          ),
        }));
        const afterEditor = {
          ...beforeEditor,
          timeline: { ...beforeEditor.timeline, tracks },
          modifiedAt: Date.now(),
        };
        useProjectStore.setState({ project: afterEditor });
        set((state) => ({
          projects: { ...state.projects, [active.id]: afterMusic },
          sceneUndoStack: [
            ...state.sceneUndoStack,
            {
              beforeMusicProject: beforeMusic,
              afterMusicProject: structuredClone(afterMusic),
              beforeEditorProject: beforeEditor,
              afterEditorProject: structuredClone(afterEditor),
            },
          ],
          sceneRedoStack: [],
        }));
        publishSceneHistory(active.id, get().sceneUndoStack.at(-1)!);
        return ok(scene.id);
      },

      getScene: (sceneId) => {
        const active = activeMusicProject(get());
        return active?.project?.shots.find((scene) => scene.id === sceneId);
      },

      getSceneProjections: (sceneId) =>
        projectionsForScene(useProjectStore.getState().project, sceneId),

      getSceneProjectionCount: (sceneId) =>
        projectionsForScene(useProjectStore.getState().project, sceneId).length,

    }),
    {
      name: "music-video-projects",
      partialize: (state) => ({ projects: state.projects, activeProjectId: state.activeProjectId }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<Pick<MusicVideoState, "projects" | "activeProjectId">>;
        return {
          ...current,
          ...saved,
          projects: Object.fromEntries(
            Object.entries(saved.projects ?? {}).map(([id, project]) => [id, normalizeMusicProject(project)]),
          ),
          sceneUndoStack: [],
          sceneRedoStack: [],
        };
      },
    },
  ),
);

registerSceneHistoryAdapter((payload, direction) => {
  if (!payload || typeof payload !== "object") return false;
  const candidate = payload as { projectId?: unknown; entry?: unknown };
  if (typeof candidate.projectId !== "string" || !candidate.entry || typeof candidate.entry !== "object") {
    return false;
  }
  const entry = candidate.entry as SceneHistoryEntry;
  if (direction === "undo") {
    useProjectStore.setState({ project: structuredClone(entry.beforeEditorProject) });
    useMusicVideoStore.setState((state) => ({
      projects: {
        ...state.projects,
        [candidate.projectId as string]: structuredClone(entry.beforeMusicProject),
      },
      sceneUndoStack: state.sceneUndoStack.slice(0, -1),
      sceneRedoStack: [...state.sceneRedoStack, entry],
    }));
  } else {
    useProjectStore.setState({ project: structuredClone(entry.afterEditorProject) });
    useMusicVideoStore.setState((state) => ({
      projects: {
        ...state.projects,
        [candidate.projectId as string]: structuredClone(entry.afterMusicProject),
      },
      sceneUndoStack: [...state.sceneUndoStack, entry],
      sceneRedoStack: state.sceneRedoStack.slice(0, -1),
    }));
  }
  return true;
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

function patchProject(
  state: Pick<MusicVideoState, "projects">,
  id: string,
  patch: Partial<MusicVideoProject>,
): Pick<MusicVideoState, "projects"> {
  const p = state.projects[id];
  if (!p) return state;
  return { projects: { ...state.projects, [id]: { ...p, ...patch } } };
}
