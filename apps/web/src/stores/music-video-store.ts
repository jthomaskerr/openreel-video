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
import {
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
  type TimingAnalysis,
} from "@openreel/music-video-domain";

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

// ── Store ─────────────────────────────────────────────────────────────────────

export const useMusicVideoStore = create<MusicVideoState>()(
  persist(
    (set, get) => ({
      projects: {},
      activeProjectId: null,

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
    }),
    { name: "music-video-projects" },
  ),
);

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
