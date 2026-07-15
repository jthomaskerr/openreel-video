import "../../test/install-local-storage-mock";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@openreel/core";
import type { ReactNode } from "react";

import { Timeline } from "./Timeline";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useMusicVideoStore } from "../../stores/music-video-store";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";

vi.mock("../../bridges/playback-bridge", () => ({
  getPlaybackBridge: () => ({
    startScrubbing: vi.fn(),
    scrubTo: vi.fn(),
    endScrubbing: vi.fn(),
  }),
}));

vi.mock("../../bridges/transition-bridge", () => ({
  getTransitionBridge: () => ({
    isInitialized: () => false,
    createTransition: vi.fn(),
    getTransition: vi.fn(),
    getDefaultParams: vi.fn(),
  }),
}));

vi.mock("@openreel/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openreel/ui")>();
  return {
    ...actual,
    DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
    DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    DropdownMenuSeparator: () => <hr />,
    DropdownMenuItem: ({
      children,
      onClick,
      onSelect,
      disabled,
      title,
      "aria-label": ariaLabel,
    }: {
      children: ReactNode;
      onClick?: () => void;
      onSelect?: () => void;
      disabled?: boolean;
      title?: string;
      "aria-label"?: string;
    }) => (
      <button
        type="button"
        disabled={disabled}
        title={title}
        aria-label={ariaLabel}
        onClick={() => {
          onClick?.();
          onSelect?.();
        }}
      >
        {children}
      </button>
    ),
  };
});

const videoTrack: Track = {
  id: "video-1",
  name: "Video 1",
  type: "video",
  clips: [],
  transitions: [],
  muted: false,
  solo: false,
  locked: false,
  hidden: false,
};

describe("Timeline Create Scene menu integration", () => {
  const createAndPlaceScene = vi.fn();

  beforeEach(() => {
    createAndPlaceScene.mockReset();
    createAndPlaceScene.mockResolvedValue({
      success: true,
      value: { sceneId: "scene-1", clipId: "clip-1" },
    });
    const project = createEmptyProject("Create Scene Test");
    useProjectStore.setState({
      project: {
        ...project,
        timeline: { ...project.timeline, tracks: [videoTrack] },
      },
    });
    useTimelineStore.setState({
      pixelsPerSecond: 20,
      viewportWidth: 800,
      trackHeight: 60,
      trackHeights: {},
      playheadPosition: 19.123456789012345,
      playbackState: "paused",
      scrollX: 0,
      scrollY: 0,
    });
    useUIStore.getState().clearSelection();
    useUIStore.setState({
      activeTrackId: videoTrack.id,
      inspectorSelection: null,
      sidebarTab: "problems",
    });
    useMusicVideoStore.setState({ createAndPlaceScene });
  });

  it("creates once at the exact playhead, selects the clip, and opens focused scene context", async () => {
    const beforePlayhead = useTimelineStore.getState().playheadPosition;
    render(<Timeline />);

    fireEvent.click(screen.getByText("Create Scene"));

    await waitFor(() => expect(createAndPlaceScene).toHaveBeenCalledTimes(1));
    expect(createAndPlaceScene).toHaveBeenCalledWith({
      trackId: videoTrack.id,
      startTime: beforePlayhead,
    });
    expect(useUIStore.getState().selectedItems).toEqual([
      { type: "clip", id: "clip-1", trackId: videoTrack.id },
    ]);
    expect(useUIStore.getState().activeTrackId).toBe(videoTrack.id);
    expect(useUIStore.getState().inspectorSelection).toEqual({
      type: "scene",
      sceneId: "scene-1",
      projectionClipId: "clip-1",
      focusTitleRequestId: 1,
    });
    expect(useUIStore.getState().sidebarTab).toBe("inspector");
    expect(useTimelineStore.getState().playheadPosition).toBe(beforePlayhead);
  });
});
