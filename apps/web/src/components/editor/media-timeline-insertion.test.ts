import "../../test/install-local-storage-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Clip, MediaItem, Project, Track } from "@openreel/core";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";
import { insertMediaAtCurrentTime } from "./media-timeline-insertion";

const originalProjectState = useProjectStore.getState();

function track(
  id: string,
  type: Track["type"],
  options: Partial<Track> = {},
): Track {
  return {
    id,
    type,
    name: id,
    clips: [],
    transitions: [],
    locked: false,
    hidden: false,
    muted: false,
    solo: false,
    ...options,
  };
}

function media(id: string, type: MediaItem["type"]): MediaItem {
  return { id, type, name: id } as MediaItem;
}

function insertedClip(
  id: string,
  trackId: string,
  mediaId: string,
  startTime: number,
): Clip {
  return { id, trackId, mediaId, startTime, duration: 1 } as Clip;
}

function seedProject(items: MediaItem[], tracks: Track[]): Project {
  const project = createEmptyProject("Media insertion test");
  const seeded = {
    ...project,
    mediaLibrary: { items },
    timeline: { ...project.timeline, tracks },
  };
  useProjectStore.setState({ project: seeded });
  return seeded;
}

function installAddClipMock() {
  const addClip = vi.fn(
    async (trackId: string, mediaId: string, startTime: number) => {
      const current = useProjectStore.getState().project;
      useProjectStore.setState({
        project: {
          ...current,
          timeline: {
            ...current.timeline,
            tracks: current.timeline.tracks.map((candidate) =>
              candidate.id === trackId
                ? {
                    ...candidate,
                    clips: [
                      ...candidate.clips,
                      insertedClip("inserted-clip", trackId, mediaId, startTime),
                    ],
                  }
                : candidate,
            ),
          },
        },
      });
      return { success: true } as const;
    },
  );
  useProjectStore.setState({ addClip });
  return addClip;
}

describe("Media-pane timeline insertion", () => {
  beforeEach(() => {
    useUIStore.getState().clearSelection();
    useUIStore.setState({ activeTrackId: null });
    useTimelineStore.setState({
      isScrubbing: false,
      playheadPosition: 0,
      scrubPosition: 0,
    });
  });

  afterEach(() => {
    useProjectStore.setState({
      addClip: originalProjectState.addClip,
      addTrack: originalProjectState.addTrack,
      getMediaItem: originalProjectState.getMediaItem,
    });
    vi.restoreAllMocks();
  });

  it("inserts on the selected compatible track at the captured playhead and selects the clip", async () => {
    seedProject([media("audio-media", "audio")], [track("audio-track", "audio")]);
    useUIStore.setState({ activeTrackId: "audio-track" });
    useTimelineStore.setState({ playheadPosition: 7.25 });
    const addClip = installAddClipMock();
    const addTrack = vi.fn();
    useProjectStore.setState({ addTrack });

    await insertMediaAtCurrentTime("audio-media");

    expect(addTrack).not.toHaveBeenCalled();
    expect(addClip).toHaveBeenCalledWith("audio-track", "audio-media", 7.25);
    expect(useUIStore.getState().selectedItems).toEqual([
      { id: "inserted-clip", type: "clip", trackId: "audio-track" },
    ]);
  });

  it("uses an unlocked compatible fallback at zero instead of appending", async () => {
    const existing = insertedClip("existing", "audio-fallback", "other-media", 20);
    seedProject(
      [media("audio-media", "audio")],
      [
        track("locked-selected", "audio", { locked: true }),
        track("audio-fallback", "audio", { clips: [existing] }),
      ],
    );
    useUIStore.setState({ activeTrackId: "locked-selected" });
    useTimelineStore.setState({ playheadPosition: 0 });
    const addClip = installAddClipMock();

    await insertMediaAtCurrentTime("audio-media");

    expect(addClip).toHaveBeenCalledWith("audio-fallback", "audio-media", 0);
    expect(useUIStore.getState().activeTrackId).toBe("audio-fallback");
    expect(
      useProjectStore
        .getState()
        .project.timeline.tracks.find((item) => item.id === "audio-fallback")
        ?.clips.at(-1)?.startTime,
    ).toBe(0);
  });

  it("inserts image media on the selected video track at the captured scrub time", async () => {
    seedProject([media("image-media", "image")], [track("video-track", "video")]);
    useUIStore.setState({ activeTrackId: "video-track" });
    useTimelineStore.setState({
      isScrubbing: true,
      playheadPosition: 2,
      scrubPosition: 4.5,
    });
    const addClip = installAddClipMock();
    const addTrack = vi.fn();
    useProjectStore.setState({ addTrack });

    await insertMediaAtCurrentTime("image-media");

    expect(addTrack).not.toHaveBeenCalled();
    expect(addClip).toHaveBeenCalledWith("video-track", "image-media", 4.5);
    expect(useUIStore.getState().activeTrackId).toBe("video-track");
    expect(useUIStore.getState().selectedItems[0]?.id).toBe("inserted-clip");
  });

  it("creates and selects a compatible fallback while retaining captured scrub time", async () => {
    seedProject([media("video-media", "video")], [track("audio-track", "audio")]);
    useUIStore.setState({ activeTrackId: "audio-track" });
    useTimelineStore.setState({
      isScrubbing: true,
      playheadPosition: 2,
      scrubPosition: 4.5,
    });
    const addClip = installAddClipMock();
    const addTrack = vi.fn(async (type: Track["type"]) => {
      const current = useProjectStore.getState().project;
      useProjectStore.setState({
        project: {
          ...current,
          timeline: {
            ...current.timeline,
            tracks: [...current.timeline.tracks, track("new-video-track", type)],
          },
        },
      });
      useTimelineStore.setState({ scrubPosition: 99 });
      return { success: true } as const;
    });
    useProjectStore.setState({ addTrack });

    await insertMediaAtCurrentTime("video-media");

    expect(addTrack).toHaveBeenCalledWith("video");
    expect(addClip).toHaveBeenCalledWith(
      "new-video-track",
      "video-media",
      4.5,
    );
    expect(useUIStore.getState().activeTrackId).toBe("new-video-track");
    expect(useUIStore.getState().selectedItems[0]?.id).toBe("inserted-clip");
  });

  it("returns an actionable missing-media failure without changing selection", async () => {
    seedProject([], [track("video-track", "video")]);
    useUIStore.setState({
      selectedItems: [{ id: "existing", type: "clip", trackId: "video-track" }],
    });

    const result = await insertMediaAtCurrentTime("missing-media");

    expect(result).toEqual({
      success: false,
      stage: "resolve-media",
      mediaId: "missing-media",
      message: "Media missing-media is no longer available. Relink or re-import it and try again.",
    });
    expect(useUIStore.getState().selectedItems[0]?.id).toBe("existing");
  });

  it("returns track-creation failure and keeps the previous active track", async () => {
    seedProject([media("video-media", "video")], [track("audio-track", "audio")]);
    useUIStore.setState({ activeTrackId: "audio-track" });
    useProjectStore.setState({
      addTrack: vi.fn(async () => ({
        success: false,
        error: { code: "ACTION_FAILED" as const, message: "track failed" },
      })),
    });

    const result = await insertMediaAtCurrentTime("video-media");

    expect(result).toMatchObject({
      success: false,
      stage: "create-track",
      mediaId: "video-media",
      message: "track failed",
    });
    expect(useUIStore.getState().activeTrackId).toBe("audio-track");
  });

  it("returns clip-creation failure without claiming a new selection", async () => {
    seedProject([media("audio-media", "audio")], [track("audio-track", "audio")]);
    useUIStore.setState({ activeTrackId: "audio-track" });
    useUIStore.setState({
      selectedItems: [{ id: "existing", type: "clip", trackId: "audio-track" }],
    });
    useProjectStore.setState({
      addClip: vi.fn(async () => ({
        success: false,
        error: { code: "ACTION_FAILED" as const, message: "clip failed" },
      })),
    });

    const result = await insertMediaAtCurrentTime("audio-media");

    expect(result).toMatchObject({
      success: false,
      stage: "create-clip",
      mediaId: "audio-media",
      trackId: "audio-track",
      message: "clip failed",
    });
    expect(useUIStore.getState().selectedItems[0]?.id).toBe("existing");
  });
});
