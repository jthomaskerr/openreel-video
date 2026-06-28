import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MediaItem, Project, Track } from "@openreel/core";
import { NeuralFramesImportTab } from "./NeuralFramesImportTab";

const storeState = vi.hoisted(() => ({
  project: null as Project | null,
  addTrack: vi.fn(),
  renameTrack: vi.fn(),
  addGeneratedMedia: vi.fn(),
  addClip: vi.fn(),
  addPlaceholderMedia: vi.fn(),
  replacePlaceholderMedia: vi.fn(),
}));

vi.mock("../../../stores/project-store", () => {
  const useProjectStore = vi.fn(() => ({
    addTrack: storeState.addTrack,
    addClip: storeState.addClip,
    addPlaceholderMedia: storeState.addPlaceholderMedia,
    replacePlaceholderMedia: storeState.replacePlaceholderMedia,
    addGeneratedMedia: storeState.addGeneratedMedia,
    renameTrack: storeState.renameTrack,
  }));
  Object.assign(useProjectStore, {
    getState: () => ({
      project: storeState.project,
    }),
  });
  return { useProjectStore };
});

function makeProject(): Project {
  return {
    id: "project-1",
    name: "NF Import Test",
    createdAt: 1,
    modifiedAt: 1,
    settings: {
      width: 1920,
      height: 1080,
      frameRate: 30,
      sampleRate: 48000,
      channels: 2,
    },
    mediaLibrary: { items: [] },
    timeline: {
      tracks: [],
      duration: 0,
      markers: [],
      subtitles: [],
    },
  };
}

function installMutableStore() {
  storeState.project = makeProject();
  storeState.addTrack.mockImplementation(async (trackType: Track["type"]) => {
    const project = storeState.project!;
    const track: Track = {
      id: `track-${project.timeline.tracks.length + 1}`,
      type: trackType,
      name: `${trackType} ${project.timeline.tracks.length + 1}`,
      clips: [],
      transitions: [],
      locked: false,
      hidden: false,
      muted: false,
      solo: false,
    };
    storeState.project = {
      ...project,
      timeline: { ...project.timeline, tracks: [...project.timeline.tracks, track] },
    };
    return { success: true, actionId: "track-action" };
  });
  storeState.renameTrack.mockImplementation((trackId: string, name: string) => {
    const project = storeState.project!;
    storeState.project = {
      ...project,
      timeline: {
        ...project.timeline,
        tracks: project.timeline.tracks.map((track) =>
          track.id === trackId ? { ...track, name } : track,
        ),
      },
    };
  });
  storeState.addGeneratedMedia.mockImplementation(async (item: MediaItem) => {
    const project = storeState.project!;
    storeState.project = {
      ...project,
      mediaLibrary: { items: [...project.mediaLibrary.items, item] },
    };
    return { success: true, actionId: "media-action" };
  });
  storeState.addClip.mockImplementation(
    async (
      trackId: string,
      mediaId: string,
      startTime: number,
      options?: { duration?: number; metadata?: Record<string, unknown> },
    ) => {
      const project = storeState.project!;
      if (!mediaId) throw new Error("metadata clip used an empty mediaId");
      if (!project.mediaLibrary.items.some((item) => item.id === mediaId)) {
        throw new Error(`metadata clip used missing mediaId ${mediaId}`);
      }
      storeState.project = {
        ...project,
        timeline: {
          ...project.timeline,
          tracks: project.timeline.tracks.map((track) =>
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
                    } as any,
                  ],
                }
              : track,
          ),
        },
      };
      return { success: true, actionId: "clip-action" };
    },
  );
}

describe("NeuralFramesImportTab metadata import", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    storeState.addTrack.mockReset();
    storeState.renameTrack.mockReset();
    storeState.addGeneratedMedia.mockReset();
    storeState.addClip.mockReset();
    storeState.addPlaceholderMedia.mockReset();
    storeState.replacePlaceholderMedia.mockReset();
    installMutableStore();
  });

  it("creates timeline metadata clips with real generated media IDs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          title: "Imported Storyboard",
          shots: [{ id: "shot-1" }, { id: "shot-2" }],
          generatedAssets: [],
          metadataTracks: [
            {
              id: "track-scenes",
              label: "Storyboard",
              kind: "sections",
              visible: true,
              locked: false,
              blocks: [
                {
                  id: "block-1",
                  trackId: "track-scenes",
                  label: "Intro",
                  kind: "section",
                  startSeconds: 0,
                  endSeconds: 4,
                  text: "Opening scene",
                  color: "#f97316",
                  linkedShotIds: ["shot-1"],
                  linkedGeneratedAssetIds: [],
                  source: "llm",
                  importSource: "neuralframes",
                  importId: "nf-scene-1",
                },
              ],
            },
            {
              id: "track-characters",
              label: "Characters",
              kind: "characters",
              visible: true,
              locked: false,
              blocks: [
                {
                  id: "block-2",
                  trackId: "track-characters",
                  label: "Lead",
                  kind: "continuity_note",
                  startSeconds: 0,
                  endSeconds: 4,
                  text: "Lead character",
                  linkedShotIds: ["shot-1"],
                  linkedGeneratedAssetIds: [],
                  source: "llm",
                  importSource: "neuralframes",
                  importId: "nf-char-1",
                },
              ],
            },
            {
              id: "track-styles",
              label: "Styles",
              kind: "style",
              visible: true,
              locked: false,
              blocks: [
                {
                  id: "block-3",
                  trackId: "track-styles",
                  label: "Noir",
                  kind: "visual_motif",
                  startSeconds: 0,
                  endSeconds: 4,
                  text: "High contrast",
                  linkedShotIds: ["shot-1"],
                  linkedGeneratedAssetIds: [],
                  source: "llm",
                  importSource: "neuralframes",
                  importId: "nf-style-1",
                },
              ],
            },
          ],
        }),
      })),
    );

    const { container } = render(
      <NeuralFramesImportTab openreelProjectId="project-1" orchestratorUrl="http://localhost:4041" />,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([JSON.stringify({ title: "raw" })], "storyboard.json", {
      type: "application/json",
    });
    Object.defineProperty(file, "text", {
      value: vi.fn().mockResolvedValue(JSON.stringify({ title: "raw" })),
    });

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText(/3 tracks · 2 blocks · 0 images/)).toBeInTheDocument());

    expect(storeState.addGeneratedMedia).toHaveBeenCalledTimes(3);
    expect(storeState.addClip).toHaveBeenCalledTimes(3);
    for (const call of storeState.addClip.mock.calls) {
      const mediaId = call[1];
      expect(mediaId).toEqual(expect.any(String));
      expect(mediaId).not.toBe("");
      expect(storeState.project!.mediaLibrary.items.some((item) => item.id === mediaId)).toBe(true);
    }

    const metadataKinds = storeState.project!.timeline.tracks.flatMap((track) =>
      track.clips.map((clip) => clip.metadata?.kind),
    );
    expect(metadataKinds).toEqual(expect.arrayContaining(["scene", "character", "style"]));
  });
});
