import "../../test/install-local-storage-mock";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Clip, MediaItem, Track } from "@openreel/core";
import { Timeline } from "./Timeline";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";
import { saveTimelineViewState } from "./timeline/timeline-view-persistence";

vi.mock("../../bridges/playback-bridge", () => ({
  getPlaybackBridge: () => ({
    scrubTo: vi.fn(),
    startScrubbing: vi.fn(),
    endScrubbing: vi.fn(),
  }),
}));

vi.mock("../../bridges/transition-bridge", () => ({
  getTransitionBridge: () => ({
    isInitialized: () => true,
    getDefaultParams: () => ({}),
    createTransition: () => ({ success: false }),
    getTransition: () => null,
  }),
}));

function makeMedia(): MediaItem {
  return {
    id: "media-1",
    name: "clip-source.mp4",
    type: "video",
    fileHandle: null,
    blob: null,
    metadata: {
      duration: 10,
      width: 1920,
      height: 1080,
      frameRate: 24,
      codec: "h264",
      sampleRate: 0,
      channels: 0,
      fileSize: 100,
    },
    thumbnailUrl: null,
  };
}

function makeClip(): Clip {
  return {
    id: "clip-1",
    type: "video",
    mediaId: "media-1",
    trackId: "track-1",
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    transform: {
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      anchor: { x: 0.5, y: 0.5 },
      opacity: 1,
    },
    effects: [],
    audioEffects: [],
    volume: 1,
    keyframes: [],
  };
}

function makeTrack(clip: Clip): Track {
  return {
    id: "track-1",
    name: "Video",
    type: "video",
    clips: [clip],
    transitions: [],
    locked: false,
    hidden: false,
    muted: false,
    solo: false,
  };
}

describe("Timeline clip selection", () => {
  beforeEach(() => {
    localStorage.clear();
    const media = makeMedia();
    const clip = makeClip();
    const track = makeTrack(clip);
    const project = createEmptyProject("Selection Test");

    useProjectStore.setState({
      project: {
        ...project,
        mediaLibrary: { items: [media] },
        timeline: { ...project.timeline, tracks: [track] },
      },
    });
    useTimelineStore.setState({
      pixelsPerSecond: 20,
      viewportWidth: 800,
      trackHeight: 60,
      trackHeights: {},
      playheadPosition: 0,
      playbackState: "paused",
      scrollX: 0,
      scrollY: 0,
    });
    useUIStore.getState().clearSelection();
    useUIStore.setState({
      sidebarTab: "problems",
      inspectedAsset: media,
      activeTrackId: null,
    });
  });

  it("opens the clip edit inspector and clears pinned asset inspection when a timeline clip is selected", () => {
    render(<Timeline />);

    const clipElement = screen.getByText("clip-source.mp4").closest(".group");
    if (!clipElement) throw new Error("clip element not found");

    fireEvent.mouseDown(clipElement, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.click(clipElement, { button: 0, clientX: 10, clientY: 10 });

    const uiState = useUIStore.getState();
    expect(uiState.selectedItems).toEqual([
      { type: "clip", id: "clip-1", trackId: "track-1" },
    ]);
    expect(uiState.sidebarTab).toBe("edit");
    expect(uiState.inspectedAsset).toBeNull();
    expect(uiState.activeTrackId).toBe("track-1");
  });

  it("keeps the timeline scroller synchronized with persisted store offsets", async () => {
    const projectId = useProjectStore.getState().project.id;
    saveTimelineViewState(projectId, {
      playheadPosition: 12.5,
      scrollX: 321,
      scrollY: 87,
    });

    render(<Timeline />);

    const scroller = screen.getByTestId("timeline-scroll-container");
    await waitFor(() => {
      expect(scroller.scrollLeft).toBe(321);
      expect(scroller.scrollTop).toBe(87);
    });
    expect(useTimelineStore.getState()).toMatchObject({
      playheadPosition: 12.5,
      scrollX: 321,
      scrollY: 87,
    });

    act(() => useTimelineStore.setState({ scrollX: 222, scrollY: 44 }));
    expect(scroller.scrollLeft).toBe(222);
    expect(scroller.scrollTop).toBe(44);

    scroller.scrollLeft = 456;
    scroller.scrollTop = 123;
    fireEvent.scroll(scroller);
    expect(useTimelineStore.getState()).toMatchObject({ scrollX: 456, scrollY: 123 });
  });

  it("restores the final playhead and scroll positions after a reload-like remount", async () => {
    const { unmount } = render(<Timeline />);

    act(() => {
      useTimelineStore.setState({
        playheadPosition: 42.25,
        scrollX: 640,
        scrollY: 96,
      });
    });
    unmount();

    act(() => {
      useTimelineStore.setState({ playheadPosition: 0, scrollX: 0, scrollY: 0 });
    });
    render(<Timeline />);

    await waitFor(() => {
      expect(useTimelineStore.getState()).toMatchObject({
        playheadPosition: 42.25,
        scrollX: 640,
        scrollY: 96,
      });
    });
  });
});
