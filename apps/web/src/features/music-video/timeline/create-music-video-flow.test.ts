import { describe, expect, it, vi } from "vitest";
import { v4 as uuidv4 } from "uuid";
import type { ActionResult, MediaItem, Project, Track } from "@openreel/core";
import {
  createMusicVideoFlow,
  MUSIC_VIDEO_TRACK_NAME,
  type MusicVideoFlowStore,
} from "./create-music-video-flow";

const AUDIO_DURATION = 120; // seconds

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

function makeAudioFile(name = "song.mp3"): File {
  return new File([new Uint8Array(16)], name, { type: "audio/mpeg" });
}

function makeStore(initialProject = makeProject()) {
  let project = initialProject;

  const store: MusicVideoFlowStore = {
    get project() {
      return project;
    },

    importMedia: vi.fn(async (file: File): Promise<ActionResult> => {
      const mediaId = uuidv4();
      const item: MediaItem = {
        id: mediaId,
        name: file.name,
        type: "audio",
        fileHandle: null,
        blob: file,
        metadata: {
          duration: AUDIO_DURATION,
          width: 0,
          height: 0,
          frameRate: 0,
          codec: "mp3",
          sampleRate: 44100,
          channels: 2,
          fileSize: file.size,
        },
        thumbnailUrl: null,
        waveformData: null,
        sourceFile: { name: file.name, size: file.size, lastModified: 0 },
      };
      project = {
        ...project,
        mediaLibrary: {
          items: [...project.mediaLibrary.items, item],
        },
      };
      return { success: true, actionId: mediaId };
    }),

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
                        id: `clip-${track.id}-${track.clips.length + 1}`,
                        trackId: track.id,
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
                        audioEffects: [],
                        transitions: [],
                        keyframes: [],
                        metadata: options?.metadata ?? {},
                      },
                    ],
                  }
                : track,
            ),
          },
        };
        return { success: true, actionId: "clip-action" };
      },
    ),

    getTimelineDuration: vi.fn(() => 0),
  };

  return store;
}

describe("createMusicVideoFlow", () => {
  it("imports the audio file into the media library", async () => {
    const store = makeStore();
    const file = makeAudioFile();

    const result = await createMusicVideoFlow(store, { audioFile: file });

    expect(result.success).toBe(true);
    expect(store.importMedia).toHaveBeenCalledWith(file);
    // imported audio + metadata media (image placeholder used by addTimelineMetadataClip)
    expect(store.project.mediaLibrary.items.length).toBeGreaterThanOrEqual(2);
    // Verify the audio item is present
    const audioItems = store.project.mediaLibrary.items.filter(
      (item) => item.type === "audio",
    );
    expect(audioItems).toHaveLength(1);
    expect(audioItems[0].name).toBe(file.name);
  });

  it("creates an audio track containing the audio clip at t=0", async () => {
    const store = makeStore();
    const file = makeAudioFile();

    const result = await createMusicVideoFlow(store, { audioFile: file });

    expect(result.success).toBe(true);
    expect(result.audioTrackId).toBeTruthy();
    expect(result.audioClipId).toBeTruthy();

    const audioTrack = store.project.timeline.tracks.find(
      (track) => track.id === result.audioTrackId,
    );
    expect(audioTrack).toBeDefined();
    expect(audioTrack!.type).toBe("audio");

    const audioClip = audioTrack!.clips.find((clip) => clip.id === result.audioClipId);
    expect(audioClip).toBeDefined();
    expect(audioClip!.startTime).toBe(0);
    expect(audioClip!.duration).toBe(AUDIO_DURATION);
  });

  it("creates a Music Video metadata track", async () => {
    const store = makeStore();

    const result = await createMusicVideoFlow(store, { audioFile: makeAudioFile() });

    expect(result.success).toBe(true);
    expect(result.metadataTrackId).toBeTruthy();

    const metadataTrack = store.project.timeline.tracks.find(
      (track) => track.id === result.metadataTrackId,
    );
    expect(metadataTrack).toBeDefined();
    expect(metadataTrack!.type).toBe("metadata");
    expect(metadataTrack!.name).toBe(MUSIC_VIDEO_TRACK_NAME);
  });

  it('creates a full-duration metadata clip with metadata.kind="music-video"', async () => {
    const store = makeStore();

    const result = await createMusicVideoFlow(store, { audioFile: makeAudioFile() });

    expect(result.success).toBe(true);
    expect(result.metadataClipId).toBeTruthy();

    const metadataTrack = store.project.timeline.tracks.find(
      (track) => track.id === result.metadataTrackId,
    )!;
    const metadataClip = metadataTrack.clips.find((clip) => clip.id === result.metadataClipId);
    expect(metadataClip).toBeDefined();
    expect(metadataClip!.startTime).toBe(0);
    expect(metadataClip!.duration).toBe(AUDIO_DURATION);
    expect(metadataClip!.metadata).toMatchObject({ kind: "music-video" });
  });

  it("returned metadataClipId and metadataTrackId identify a real clip, openable via selection state", async () => {
    const store = makeStore();

    const result = await createMusicVideoFlow(store, { audioFile: makeAudioFile() });

    expect(result.success).toBe(true);
    // UI callers can select the clip: { type: "clip", id: metadataClipId, trackId: metadataTrackId }
    const track = store.project.timeline.tracks.find(
      (t) => t.id === result.metadataTrackId,
    );
    const clip = track?.clips.find((c) => c.id === result.metadataClipId);
    expect(clip).toBeDefined();
  });

  it("reuses an existing audio track when one already exists", async () => {
    const existingAudioTrack: Track = {
      id: "existing-audio",
      type: "audio",
      name: "Audio 1",
      clips: [],
      transitions: [],
      locked: false,
      hidden: false,
      muted: false,
      solo: false,
    };
    const initialProject = {
      ...makeProject(),
      timeline: { ...makeProject().timeline, tracks: [existingAudioTrack] },
    };
    const store = makeStore(initialProject);

    const result = await createMusicVideoFlow(store, { audioFile: makeAudioFile() });

    expect(result.success).toBe(true);
    expect(result.audioTrackId).toBe("existing-audio");
    // No new audio track should be created
    const audioTracks = store.project.timeline.tracks.filter((t) => t.type === "audio");
    expect(audioTracks).toHaveLength(1);
  });

  it("falls back to project timeline duration when audio duration is unavailable", async () => {
    const store = makeStore();
    // Override importMedia to return a media item with duration=0
    vi.mocked(store.importMedia).mockImplementationOnce(async (file: File) => {
      const mediaId = uuidv4();
      const item: MediaItem = {
        id: mediaId,
        name: file.name,
        type: "audio",
        fileHandle: null,
        blob: file,
        metadata: {
          duration: 0, // unavailable
          width: 0,
          height: 0,
          frameRate: 0,
          codec: "",
          sampleRate: 0,
          channels: 0,
          fileSize: file.size,
        },
        thumbnailUrl: null,
        waveformData: null,
        sourceFile: { name: file.name, size: file.size, lastModified: 0 },
      };
      // Route through addGeneratedMedia — the only way to write into the shared
      // project closure without breaking encapsulation in makeStore.
      await store.addGeneratedMedia(item, new Blob());
      return { success: true, actionId: mediaId };
    });
    vi.mocked(store.getTimelineDuration).mockReturnValue(60);

    const result = await createMusicVideoFlow(store, { audioFile: makeAudioFile() });

    expect(result.success).toBe(true);
    const audioTrack = store.project.timeline.tracks.find(
      (t) => t.id === result.audioTrackId,
    )!;
    const audioClip = audioTrack.clips.find((c) => c.id === result.audioClipId);
    // Duration falls back to project timeline duration
    expect(audioClip!.duration).toBe(60);
  });

  it("propagates importMedia failure", async () => {
    const store = makeStore();
    vi.mocked(store.importMedia).mockResolvedValueOnce({
      success: false,
      error: { code: "DECODE_ERROR", message: "bad file" },
    });

    const result = await createMusicVideoFlow(store, { audioFile: makeAudioFile() });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("DECODE_ERROR");
  });
});
