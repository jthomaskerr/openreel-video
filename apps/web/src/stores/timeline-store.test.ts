import { beforeEach, describe, expect, it } from "vitest";
import { useTimelineStore, ZOOM_PRESETS } from "./timeline-store";

describe("TimelineStore playback locking", () => {
  beforeEach(() => {
    useTimelineStore.setState({
      playheadPosition: 0,
      playbackState: "stopped",
      playbackLockedReason: null,
      playbackRate: 1,
      pixelsPerSecond: ZOOM_PRESETS.DEFAULT,
      scrollX: 0,
      scrollY: 0,
      viewportWidth: 800,
      viewportHeight: 400,
      trackHeight: 80,
      trackHeights: {},
      loopEnabled: false,
      loopStart: 0,
      loopEnd: 0,
      isScrubbing: false,
      scrubPosition: null,
      expandedTracks: new Set<string>(),
      expandedClipKeyframes: new Set<string>(),
      keyframeEditMode: false,
    });
  });

  it("blocks play and toggle while locked", () => {
    const store = useTimelineStore.getState();

    store.lockPlayback("Applying auto color");
    store.play();
    store.togglePlayback();

    const state = useTimelineStore.getState();
    expect(state.playbackState).toBe("stopped");
    expect(state.playbackLockedReason).toBe("Applying auto color");
  });

  it("allows playback again after unlocking", () => {
    const store = useTimelineStore.getState();

    store.lockPlayback("Applying auto color");
    store.unlockPlayback();
    store.togglePlayback();

    const state = useTimelineStore.getState();
    expect(state.playbackLockedReason).toBeNull();
    expect(state.playbackState).toBe("playing");
  });
});

describe("TimelineStore zoom limits", () => {
  beforeEach(() => {
    useTimelineStore.setState({
      pixelsPerSecond: ZOOM_PRESETS.DEFAULT,
      playheadPosition: 0,
      scrollX: 0,
      viewportWidth: 800,
    });
  });

  it("keeps the playhead at the same viewport position when zooming in", () => {
    useTimelineStore.setState({
      pixelsPerSecond: 100,
      playheadPosition: 10,
      scrollX: 700,
    });

    useTimelineStore.getState().zoomIn();

    const state = useTimelineStore.getState();
    expect(state.pixelsPerSecond).toBe(150);
    expect(state.playheadPosition * state.pixelsPerSecond - state.scrollX).toBe(300);
  });

  it("keeps the playhead at the same viewport position when zooming out", () => {
    useTimelineStore.setState({
      pixelsPerSecond: 150,
      playheadPosition: 10,
      scrollX: 1_200,
    });

    useTimelineStore.getState().zoomOut();

    const state = useTimelineStore.getState();
    expect(state.pixelsPerSecond).toBe(100);
    expect(state.playheadPosition * state.pixelsPerSecond - state.scrollX).toBe(300);
  });

  it("clamps direct zoom changes to 1 pixel per second", () => {
    useTimelineStore.getState().setZoom(0);

    expect(useTimelineStore.getState().pixelsPerSecond).toBe(1);
  });

  it("stops zooming out at 1 pixel per second", () => {
    useTimelineStore.setState({ pixelsPerSecond: 1 });
    useTimelineStore.getState().zoomOut();

    expect(useTimelineStore.getState().pixelsPerSecond).toBe(1);
  });

  it("allows zoom-to-fit to reach 1 pixel per second", () => {
    useTimelineStore.getState().zoomToFit(1_000);

    expect(useTimelineStore.getState().pixelsPerSecond).toBe(1);
  });
});
