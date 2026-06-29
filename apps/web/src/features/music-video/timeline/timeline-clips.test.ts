import { describe, expect, it, vi } from "vitest";
import type { ActionResult, MediaItem, Project, Track } from "@openreel/core";
import { addTimelineClip, type TimelineClipStore } from "./timeline-clips";

function makeProject(): Project {
  return {
    id: "project-1",
    name: "Test Project",
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

function makeStore(initialProject = makeProject()) {
  let project = initialProject;
  const store: TimelineClipStore = {
    get project() {
      return project;
    },
    addTrack: vi.fn(async (trackType: Track["type"]): Promise<ActionResult> => {
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
      project = {
        ...project,
        timeline: {
          ...project.timeline,
          tracks: [...project.timeline.tracks, track],
        },
      };
      return { success: true, actionId: "track-action" };
    }),
    renameTrack: vi.fn((trackId: string, name: string) => {
      project = {
        ...project,
        timeline: {
          ...project.timeline,
          tracks: project.timeline.tracks.map((track) =>
            track.id === trackId ? { ...track, name } : track,
          ),
        },
      };
    }),
    addGeneratedMedia: vi.fn(async (item: MediaItem): Promise<ActionResult> => {
      project = {
        ...project,
        mediaLibrary: {
          items: [...project.mediaLibrary.items, item],
        },
      };
      return { success: true, actionId: "media-action" };
    }),
    addClip: vi.fn(
      async (
        trackId: string,
        mediaId: string,
        startTime: number,
        options?: { duration?: number; metadata?: Record<string, unknown> },
      ): Promise<ActionResult> => {
        if (!mediaId) {
          return {
            success: false,
            error: { code: "INVALID_PARAMS", message: "mediaId is required" },
          };
        }
        if (!project.mediaLibrary.items.some((item) => item.id === mediaId)) {
          return {
            success: false,
            error: { code: "MEDIA_NOT_FOUND", message: "missing media" },
          };
        }
        project = {
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
                        transform: {
                          x: 0,
                          y: 0,
                          scaleX: 1,
                          scaleY: 1,
                          rotation: 0,
                        },
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
    ),
  };
  return store;
}

describe("addTimelineClip", () => {
  it("creates a named metadata track when absent", async () => {
    const store = makeStore();

    const result = await addTimelineClip(store, {
      trackName: "Music Video",
      kind: "music-video",
      label: "Music Video",
      color: "#38bdf8",
      startTime: 0,
      duration: 12,
      metadata: { projectId: "mv-1" },
    });

    expect(result.success).toBe(true);
    expect(store.addTrack).toHaveBeenCalledWith("metadata");
    expect(store.renameTrack).toHaveBeenCalledWith(result.trackId, "Music Video");
    expect(store.project.timeline.tracks[0]).toMatchObject({
      id: result.trackId,
      type: "metadata",
      name: "Music Video",
    });
  });

  it("reuses an existing named metadata track", async () => {
    const existingTrack: Track = {
      id: "metadata-track",
      type: "metadata",
      name: "Storyboard",
      clips: [],
      transitions: [],
      locked: false,
      hidden: false,
      muted: false,
      solo: false,
    };
    const store = makeStore({
      ...makeProject(),
      timeline: { ...makeProject().timeline, tracks: [existingTrack] },
    });

    const result = await addTimelineClip(store, {
      trackName: "Storyboard",
      kind: "scene",
      label: "Scene 1",
      color: "#f97316",
      startTime: 4,
      duration: 6,
      metadata: { sceneId: "scene-1" },
    });

    expect(result.success).toBe(true);
    expect(store.addTrack).not.toHaveBeenCalled();
    expect(result.trackId).toBe("metadata-track");
  });

  it("adds generated metadata media before adding the clip", async () => {
    const store = makeStore();

    const result = await addTimelineClip(store, {
      trackName: "Characters",
      kind: "character",
      label: "Hero",
      color: "#a855f7",
      startTime: 1,
      duration: 5,
      metadata: { characterId: "char-1" },
    });

    expect(result.success).toBe(true);
    expect(result.mediaId).toBeTruthy();
    expect(store.project.mediaLibrary.items.some((item) => item.id === result.mediaId)).toBe(true);
    expect(store.addClip).toHaveBeenCalledWith(
      result.trackId,
      result.mediaId,
      1,
      expect.objectContaining({ duration: 5 }),
    );
  });

  it("adds clip metadata with kind label color and payload", async () => {
    const store = makeStore();

    const result = await addTimelineClip(store, {
      trackName: "Styles",
      kind: "style",
      label: "Noir",
      color: "#111827",
      startTime: 2,
      duration: 8,
      metadata: { loraId: "lora-1" },
    });

    expect(result.success).toBe(true);
    const track = store.project.timeline.tracks.find((candidate) => candidate.id === result.trackId)!;
    const clip = track.clips.find((candidate) => candidate.id === result.clipId)!;
    expect(clip.mediaId).toBe(result.mediaId);
    expect(clip.metadata).toMatchObject({
      kind: "style",
      label: "Noir",
      color: "#111827",
      loraId: "lora-1",
      payload: { loraId: "lora-1" },
    });
  });
});
