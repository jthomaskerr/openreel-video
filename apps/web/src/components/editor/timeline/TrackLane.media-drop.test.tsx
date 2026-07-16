import "../../../test/install-local-storage-mock";
import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@openreel/core";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useUIStore } from "../../../stores/ui-store";
import { TrackLane } from "./TrackLane";

const videoTrack = {
  id: "video-track",
  name: "Video 1",
  type: "video",
  clips: [],
  transitions: [],
  locked: false,
  hidden: false,
  muted: false,
  solo: false,
} as Track;

function renderLane(track: Track, onDropMedia = vi.fn(), parentDrop = vi.fn()) {
  const scroller = document.createElement("div");
  Object.defineProperty(scroller, "scrollLeft", { value: 200, configurable: true });
  scroller.getBoundingClientRect = () => ({
    left: 100,
    right: 900,
    top: 0,
    bottom: 200,
    width: 800,
    height: 200,
    x: 100,
    y: 0,
    toJSON: () => ({}),
  });

  render(
    <div onDrop={parentDrop}>
      <TrackLane
        track={track}
        isActive
        allTracks={[track]}
        pixelsPerSecond={20}
        selectedClipIds={[]}
        textClips={[]}
        shapeClips={[]}
        trackHeights={new Map([[track.id, 64]])}
        timelineRef={{ current: scroller }}
        onSelectClip={vi.fn()}
        onDropMedia={onDropMedia}
        onMoveClip={vi.fn()}
        onMoveTextClip={vi.fn()}
        onSnapIndicator={vi.fn()}
        onTrimTextClip={vi.fn()}
        onTrimShapeClip={vi.fn()}
        scrollX={200}
        trackHeight={64}
        onResizeTrack={vi.fn()}
      />
    </div>,
  );
  return { onDropMedia, parentDrop };
}

function mediaTransfer(mediaId = "media-1") {
  return {
    files: [],
    dropEffect: "copy",
    getData: (type: string) => type === "application/json"
      ? JSON.stringify({ mediaId })
      : "",
  };
}

function dispatchDrag(
  element: HTMLElement,
  type: "dragOver" | "drop",
  dataTransfer: ReturnType<typeof mediaTransfer>,
) {
  const event = createEvent[type](element);
  Object.defineProperties(event, {
    clientX: { value: 350 },
    dataTransfer: { value: dataTransfer },
  });
  fireEvent(element, event);
}

describe("TrackLane media placement", () => {
  beforeEach(() => {
    useTimelineStore.setState({ playheadPosition: 1 });
    useUIStore.setState({
      dragType: "media",
      dragData: { mediaId: "media-1", mediaType: "video" },
      snapSettings: {
        ...useUIStore.getState().snapSettings,
        enabled: false,
      },
    });
  });

  it("uses the same scrolled and zoomed pointer time for preview and commit", () => {
    const { onDropMedia } = renderLane(videoTrack);
    const lane = screen.getByTestId("track-lane-video-track");
    const dataTransfer = mediaTransfer();

    dispatchDrag(lane, "dragOver", dataTransfer);

    expect(lane).toHaveAttribute("data-drop-time", "22.5");
    expect(screen.getByText("Drop at 22.50s")).toBeInTheDocument();
    expect(screen.getByTestId("media-drop-position")).toHaveStyle({ left: "450px" });

    dispatchDrag(lane, "drop", dataTransfer);

    expect(onDropMedia).toHaveBeenCalledOnce();
    expect(onDropMedia).toHaveBeenCalledWith("video-track", "media-1", 22.5);
  });

  it("accepts an image drop on a video track", () => {
    useUIStore.setState({
      dragData: { mediaId: "image-1", mediaType: "image" },
    });
    const { onDropMedia } = renderLane(videoTrack);
    const lane = screen.getByTestId("track-lane-video-track");

    dispatchDrag(lane, "dragOver", mediaTransfer("image-1"));
    expect(lane).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Drop at 22.50s")).toBeInTheDocument();

    dispatchDrag(lane, "drop", mediaTransfer("image-1"));
    expect(onDropMedia).toHaveBeenCalledWith("video-track", "image-1", 22.5);
  });

  it.each([
    {
      name: "locked",
      track: { ...videoTrack, locked: true } as Track,
      mediaType: "video",
      reason: "Track is locked",
    },
    {
      name: "incompatible",
      track: videoTrack,
      mediaType: "audio",
      reason: "audio media is not compatible with this track",
    },
  ])("visibly rejects a $name target without falling through to the parent", ({ track, mediaType, reason }) => {
    useUIStore.setState({ dragData: { mediaId: "media-1", mediaType } });
    const { onDropMedia, parentDrop } = renderLane(track);
    const lane = screen.getByTestId(`track-lane-${track.id}`);
    const dataTransfer = mediaTransfer();

    dispatchDrag(lane, "dragOver", dataTransfer);
    expect(lane).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(reason)).toBeInTheDocument();

    dispatchDrag(lane, "drop", dataTransfer);
    expect(onDropMedia).not.toHaveBeenCalled();
    expect(parentDrop).not.toHaveBeenCalled();
  });
});
