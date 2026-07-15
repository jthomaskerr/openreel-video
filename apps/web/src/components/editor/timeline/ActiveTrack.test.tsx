import "../../../test/install-local-storage-mock";
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@openreel/core";
import { useUIStore } from "../../../stores/ui-store";
import { TrackHeader } from "./TrackHeader";
import { TrackLane } from "./TrackLane";

const videoTrack = {
  id: "track-1",
  name: "Video 1",
  type: "video",
  clips: [],
  transitions: [],
  locked: false,
  hidden: false,
  muted: false,
  solo: false,
} as Track;

describe("active track hooks", () => {
  beforeEach(() => {
    useUIStore.setState({ activeTrackId: null });
  });

  it("exposes an accessible non-layout-shifting hook and activates from the header", () => {
    render(
      <TrackHeader
        track={videoTrack}
        index={0}
        isActive
        onDragStart={vi.fn()}
        onDragOver={vi.fn()}
        onDrop={vi.fn()}
      />,
    );

    const header = screen.getByTestId("track-header-track-1");
    expect(header).toHaveAttribute("data-active-track", "true");
    expect(header).toHaveAttribute("aria-current", "true");
    expect(header).toHaveClass("ring-inset");
    expect(header).not.toHaveClass("border-2");
    fireEvent.click(header);
    expect(useUIStore.getState().activeTrackId).toBe("track-1");
  });

  it("exposes the lane hook without changing its measured height and activates pointer paths", () => {
    render(
      <TrackLane
        track={videoTrack}
        isActive
        allTracks={[videoTrack]}
        pixelsPerSecond={10}
        selectedClipIds={[]}
        textClips={[]}
        shapeClips={[]}
        trackHeights={new Map([[videoTrack.id, 64]])}
        timelineRef={React.createRef<HTMLDivElement>()}
        onSelectClip={vi.fn()}
        onDropMedia={vi.fn()}
        onMoveClip={vi.fn()}
        onMoveTextClip={vi.fn()}
        onSnapIndicator={vi.fn()}
        onTrimTextClip={vi.fn()}
        onTrimShapeClip={vi.fn()}
        scrollX={0}
        trackHeight={64}
        onResizeTrack={vi.fn()}
      />,
    );

    const lane = screen.getByTestId("track-lane-track-1");
    expect(lane).toHaveAttribute("data-active-track", "true");
    expect(lane).toHaveAttribute("aria-current", "true");
    expect(lane).toHaveStyle({ height: "64px" });
    expect(lane).toHaveClass("ring-inset");
    expect(lane).not.toHaveClass("border-2");
    fireEvent.pointerDown(lane);
    expect(useUIStore.getState().activeTrackId).toBe("track-1");
  });
});
