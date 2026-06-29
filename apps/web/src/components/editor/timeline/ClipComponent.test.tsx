import "../../../test/install-local-storage-mock";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Clip, Track, MediaItem } from "@openreel/core";
import { ClipComponent } from "./ClipComponent";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";

vi.mock("../../../bridges/transition-bridge", () => ({
  getTransitionBridge: () => ({
    isInitialized: () => true,
    getDefaultParams: () => ({}),
    createTransition: () => ({ success: false }),
    getTransition: () => null,
  }),
}));

function mediaItem(id: string): MediaItem {
  return {
    id,
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
    thumbnailUrl: "data:image/png;base64,thumb",
    waveformData: null,
  };
}

function makeClip(): Clip {
  return {
    id: "clip-1",
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

describe("ClipComponent", () => {
  beforeEach(() => {
    useUIStore.getState().clearSelection();
    const clip = makeClip();
    const track = makeTrack(clip);
    useProjectStore.setState((state) => ({
      project: {
        ...state.project,
        mediaLibrary: { items: [mediaItem("media-1")] },
        timeline: { ...state.project.timeline, tracks: [track] },
      },
    }));
  });

  it("selects the clip on a normal click after mousedown", () => {
    const clip = makeClip();
    const track = makeTrack(clip);
    const onSelect = vi.fn();

    render(
      <div style={{ position: "relative", width: 500, height: 80 }}>
        <ClipComponent
          clip={clip}
          track={track}
          allTracks={[track]}
          pixelsPerSecond={20}
          isSelected={false}
          trackHeights={new Map([[track.id, 60]])}
          timelineRef={{ current: document.createElement("div") }}
          onSelect={onSelect}
          onMoveClip={vi.fn()}
          onSnapIndicator={vi.fn()}
        />
      </div>,
    );

    const clipElement = screen.getByText("clip-source.mp4").closest(".group");
    if (!clipElement) throw new Error("clip element not found");

    fireEvent.mouseDown(clipElement, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.click(clipElement, { button: 0, clientX: 10, clientY: 10 });

    expect(onSelect).toHaveBeenCalledWith("clip-1", false);
  });

  it("renders media thumbnails for video clips", () => {
    const clip = makeClip();
    const track = makeTrack(clip);

    const { container } = render(
      <div style={{ position: "relative", width: 500, height: 80 }}>
        <ClipComponent
          clip={clip}
          track={track}
          allTracks={[track]}
          pixelsPerSecond={20}
          isSelected={false}
          trackHeights={new Map([[track.id, 60]])}
          timelineRef={{ current: document.createElement("div") }}
          onSelect={vi.fn()}
          onMoveClip={vi.fn()}
          onSnapIndicator={vi.fn()}
        />
      </div>,
    );

    expect(container.innerHTML).toContain("data:image/png;base64,thumb");
  });

  it("shows generated media status badges on timeline clips", () => {
    const clip = makeClip();
    const track = makeTrack(clip);
    useProjectStore.setState((state) => ({
      project: {
        ...state.project,
        mediaLibrary: {
          items: [
            {
              ...mediaItem("media-1"),
              generationMeta: {
                provider: "neuralframes",
                model: "nf",
                prompt: "Generated shot",
                status: "failed",
              },
            },
          ],
        },
        timeline: { ...state.project.timeline, tracks: [track] },
      },
    }));

    render(
      <div style={{ position: "relative", width: 500, height: 80 }}>
        <ClipComponent
          clip={clip}
          track={track}
          allTracks={[track]}
          pixelsPerSecond={20}
          isSelected={false}
          trackHeights={new Map([[track.id, 60]])}
          timelineRef={{ current: document.createElement("div") }}
          onSelect={vi.fn()}
          onMoveClip={vi.fn()}
          onSnapIndicator={vi.fn()}
        />
      </div>,
    );

    expect(screen.getByText("Generated · failed")).toBeInTheDocument();
  });
});
