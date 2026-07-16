import "../../../test/install-local-storage-mock";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Clip, Track, MediaItem, ProjectSaveReceipt } from "@openreel/core";
import { ClipComponent } from "./ClipComponent";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { usePersistenceStatusStore } from "../../../stores/persistence-status-store";
import { mediaAvailabilityRuntime } from "../../../services/media-verification";

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
    thumbnailUrl: "data:image/png;base64,thumb"
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

function receipt(commitSha: string, semanticFilename = "clip-source.mp4"): ProjectSaveReceipt {
  return {
    saved: true,
    projectId: "project-1",
    persistedAt: 100,
    sourceModifiedAt: 90,
    commitSha,
    treeSha: "b".repeat(40),
    projectBlobSha: "c".repeat(40),
    mediaManifestDigest: "sha256:manifest",
    committed: true,
    lfsPayloads: [{
      mediaId: "media-1",
      semanticFilename,
      relativePhysicalPath: `media/${semanticFilename}`,
      oid: "sha256:payload",
      pointerSize: 128,
      local: { state: "verified", actualSize: 100 },
      remote: { state: "local-only", remote: null },
    }],
  };
}

const SNAP_SETTINGS = {
  enabled: true,
  snapToClips: true,
  snapToPlayhead: false,
  snapToGrid: false,
  snapToMarkers: false,
  gridSize: 1,
  snapThreshold: 10,
};

function renderTrimClip({
  clip = { ...makeClip(), startTime: 10, duration: 8, inPoint: 2, outPoint: 10 },
  clips,
  pixelsPerSecond = 20,
  rectLeft = 100,
  scrollLeft = 0,
  onTrimClip = vi.fn(),
  onSnapIndicator = vi.fn(),
}: {
  clip?: Clip;
  clips?: Clip[];
  pixelsPerSecond?: number;
  rectLeft?: number;
  scrollLeft?: number;
  onTrimClip?: ReturnType<typeof vi.fn>;
  onSnapIndicator?: ReturnType<typeof vi.fn>;
} = {}) {
  const track = { ...makeTrack(clip), clips: clips ?? [clip] };
  const timeline = document.createElement("div");
  timeline.scrollLeft = scrollLeft;
  vi.spyOn(timeline, "getBoundingClientRect").mockReturnValue({
    left: rectLeft,
    right: rectLeft + 800,
    top: 0,
    bottom: 100,
    width: 800,
    height: 100,
    x: rectLeft,
    y: 0,
    toJSON: () => ({}),
  });

  const rendered = render(
    <div style={{ position: "relative", width: 800, height: 80 }}>
      <ClipComponent
        clip={clip}
        track={track}
        allTracks={[track]}
        pixelsPerSecond={pixelsPerSecond}
        isSelected
        trackHeights={new Map([[track.id, 60]])}
        timelineRef={{ current: timeline }}
        onSelect={vi.fn()}
        onMoveClip={vi.fn()}
        onSnapIndicator={onSnapIndicator}
        onTrimClip={onTrimClip}
      />
    </div>,
  );

  return { ...rendered, clip, timeline, onTrimClip, onSnapIndicator };
}

describe("ClipComponent", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mediaAvailabilityRuntime.reset();
    usePersistenceStatusStore.getState().reset();
    useUIStore.getState().clearSelection();
    useUIStore.setState({ snapSettings: { ...SNAP_SETTINGS, enabled: false } });
    useTimelineStore.setState({ playheadPosition: 30 });
    const clip = makeClip();
    const track = makeTrack(clip);
    useProjectStore.setState((state) => ({
      project: {
        ...state.project,
        id: "project-1",
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

  it("renders a current-session blob: URL for the video thumbnail fallback", () => {
    const media: MediaItem = {
      ...mediaItem("media-1"),
      thumbnailUrl: "blob:http://localhost/live-thumbnail",
    };
    useProjectStore.setState((state) => ({
      project: { ...state.project, mediaLibrary: { items: [media] } },
    }));

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

    expect(container.innerHTML).toContain("blob:http://localhost/live-thumbnail");
  });

  it("renders current-session blob: URLs for video filmstrip tiles", () => {
    const media: MediaItem = {
      ...mediaItem("media-1"),
      thumbnailUrl: "blob:http://localhost/live-thumbnail",
      filmstripThumbnails: [
        { timestamp: 0, url: "blob:http://localhost/live-frame-0" },
        { timestamp: 2.5, url: "blob:http://localhost/live-frame-1" },
        { timestamp: 5, url: "blob:http://localhost/live-frame-2" },
      ],
    };
    useProjectStore.setState((state) => ({
      project: { ...state.project, mediaLibrary: { items: [media] } },
    }));

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

    expect(container.innerHTML).toContain("blob:http://localhost/live-frame");
  });

  it("falls back to clip referenceAssetIds when the media item has no file and no thumbnail", () => {
    const refMedia = {
      ...mediaItem("ref-1"),
      id: "ref-1",
      name: "ref.png",
      type: "image" as const,
      thumbnailUrl: "data:image/png;base64,ref-thumb",
    };
    const media = {
      ...mediaItem("media-1"),
      thumbnailUrl: null,
    };
    const clip: Clip = {
      ...makeClip(),
      metadata: { referenceAssetIds: ["ref-1"] },
    };
    const track = makeTrack(clip);
    useProjectStore.setState((state) => ({
      project: {
        ...state.project,
        mediaLibrary: { items: [media, refMedia] },
        timeline: { ...state.project.timeline, tracks: [track] },
      },
    }));

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

    expect(container.innerHTML).toContain("data:image/png;base64,ref-thumb");
  });

  it("falls back to clip referenceImageUrl when referenceAssetIds yield nothing", () => {
    const media = {
      ...mediaItem("media-1"),
      thumbnailUrl: null,
    };
    const clip: Clip = {
      ...makeClip(),
      metadata: { referenceImageUrl: "https://cdn.example.com/scene.jpg" },
    };
    const track = makeTrack(clip);
    useProjectStore.setState((state) => ({
      project: {
        ...state.project,
        mediaLibrary: { items: [media] },
        timeline: { ...state.project.timeline, tracks: [track] },
      },
    }));

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

    expect(container.innerHTML).toContain("https://cdn.example.com/scene.jpg");
  });

  it("falls back to the first clip referenceImageUrls entry when other fallbacks are absent", () => {
    const media = {
      ...mediaItem("media-1"),
      thumbnailUrl: null,
    };
    const clip: Clip = {
      ...makeClip(),
      metadata: {
        referenceImageUrls: [
          "https://cdn.example.com/a.jpg",
          "https://cdn.example.com/b.jpg",
        ],
      },
    };
    const track = makeTrack(clip);
    useProjectStore.setState((state) => ({
      project: {
        ...state.project,
        mediaLibrary: { items: [media] },
        timeline: { ...state.project.timeline, tracks: [track] },
      },
    }));

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

    expect(container.innerHTML).toContain("https://cdn.example.com/a.jpg");
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

  it("marks every dangling clip with a semantic name, explanation, and relink action", () => {
    const first = makeClip();
    const second = { ...makeClip(), id: "clip-2", startTime: 6 };
    const track = { ...makeTrack(first), clips: [first, second] };
    useProjectStore.setState((state) => ({
      project: {
        ...state.project,
        mediaLibrary: { items: [] },
        timeline: { ...state.project.timeline, tracks: [track] },
      },
    }));
    usePersistenceStatusStore.setState({
      projectId: "project-1",
      confirmedReceipt: {
        saved: true,
        projectId: "project-1",
        persistedAt: 100,
        sourceModifiedAt: 90,
        commitSha: "a".repeat(40),
        treeSha: "b".repeat(40),
        projectBlobSha: "c".repeat(40),
        mediaManifestDigest: "sha256:manifest",
        committed: true,
        lfsPayloads: [{
          mediaId: "media-1",
          semanticFilename: "Interview Wide.mp4",
          relativePhysicalPath: "media/Interview Wide.mp4",
          oid: "sha256:payload",
          pointerSize: 128,
          local: { state: "verified", actualSize: 100 },
          remote: { state: "local-only", remote: null },
        }],
      },
    });

    render(
      <div style={{ position: "relative", width: 500, height: 80 }}>
        {[first, second].map((clip) => (
          <ClipComponent
            key={clip.id}
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
        ))}
      </div>,
    );

    expect(screen.getAllByRole("status")).toHaveLength(2);
    expect(screen.getAllByText("Missing")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Relink file" })).toHaveLength(2);
    expect(screen.getAllByText("Interview Wide.mp4")).toHaveLength(2);
    expect(screen.getAllByText(/warning remains until backend persistence is confirmed/)).toHaveLength(2);
    expect(screen.queryByText("media-1")).not.toBeInTheDocument();
  });

  it.each([
    ["verifying", "Verifying", "Verify now"],
    ["temporarily_unavailable", "Unavailable", "Retry connection"],
    ["unauthorized", "Access required", "Retry access"],
    ["decode_error", "Decode error", "Verify again"],
  ] as const)("renders %s as a distinct non-destructive state", (status, label, actionLabel) => {
    vi.spyOn(mediaAvailabilityRuntime, "get").mockReturnValue({
      mediaId: "media-1",
      status,
      evidence: { authoritative: false, mapping: "unknown", object: "unknown" },
    });
    const clip = makeClip();
    const track = makeTrack(clip);

    render(
      <div style={{ position: "relative", width: 120, height: 40 }}>
        <ClipComponent
          clip={clip}
          track={track}
          allTracks={[track]}
          pixelsPerSecond={8}
          isSelected={false}
          trackHeights={new Map([[track.id, 32]])}
          timelineRef={{ current: document.createElement("div") }}
          onSelect={vi.fn()}
          onMoveClip={vi.fn()}
          onSnapIndicator={vi.fn()}
        />
      </div>,
    );

    expect(screen.getByRole("status")).toHaveTextContent(label);
    expect(screen.getByRole("button", { name: actionLabel })).toHaveAttribute(
      "aria-describedby",
      "clip-availability-clip-1",
    );
    expect(screen.queryByText("Missing")).not.toBeInTheDocument();
    expect(screen.getByLabelText(`clip-source.mp4, ${label}`)).toBeInTheDocument();
  });

  it("keeps a confirmed-missing marker through local relink until a newer verified receipt arrives", () => {
    let runtimeStatus: "confirmed_missing" | "available" = "confirmed_missing";
    vi.spyOn(mediaAvailabilityRuntime, "get").mockImplementation(() => ({
      mediaId: "media-1",
      status: runtimeStatus,
      evidence: { authoritative: true, mapping: "present", object: runtimeStatus === "available" ? "present" : "absent" },
    }));
    usePersistenceStatusStore.setState({ projectId: "project-1", confirmedReceipt: receipt("a".repeat(40)) });
    const clip = makeClip();
    const track = makeTrack(clip);
    const props = {
      clip,
      track,
      allTracks: [track],
      pixelsPerSecond: 20,
      isSelected: false,
      trackHeights: new Map([[track.id, 60]]),
      timelineRef: { current: document.createElement("div") },
      onSelect: vi.fn(),
      onMoveClip: vi.fn(),
      onSnapIndicator: vi.fn(),
    };
    const { rerender } = render(<ClipComponent {...props} />);
    expect(screen.getByRole("status")).toHaveTextContent("Missing");

    act(() => {
      runtimeStatus = "available";
      useProjectStore.setState((state) => ({
        project: {
          ...state.project,
          mediaLibrary: {
            items: state.project.mediaLibrary.items.map((item) =>
              item.id === "media-1" ? { ...item, blob: new Blob(["linked"], { type: "video/mp4" }) } : item,
            ),
          },
        },
      }));
    });
    rerender(<ClipComponent {...props} />);
    expect(screen.getByRole("status")).toHaveTextContent("Missing");

    act(() => {
      usePersistenceStatusStore.setState({ confirmedReceipt: receipt("d".repeat(40)) });
    });
    rerender(<ClipComponent {...props} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it.each([
    ["unrealized", "Unrealized"],
    ["processing", "Pending"],
    ["failed", "Error"],
  ] as const)("preserves the generated %s badge", (generationStatus, expectedLabel) => {
    useProjectStore.setState((state) => ({
      project: {
        ...state.project,
        mediaLibrary: {
          items: [{
            ...mediaItem("media-1"),
            generationMeta: {
              provider: "neuralframes",
              model: "nf",
              prompt: "Generated shot",
              status: generationStatus,
            },
          }],
        },
      },
    }));
    const clip = makeClip();
    const track = makeTrack(clip);
    render(
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
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(expectedLabel);
  });

  it("derives repeated left-trim moves from the immutable mousedown snapshot at zoom and scroll", () => {
    const { timeline, onTrimClip } = renderTrimClip({
      pixelsPerSecond: 40,
      scrollLeft: 80,
    });
    const handle = screen.getByTestId("clip-trim-left-clip-1");

    fireEvent.mouseDown(handle, { button: 0, clientX: 420 });
    timeline.scrollLeft = 120;
    fireEvent.mouseMove(window, { clientX: 500 });
    fireEvent.mouseMove(window, { clientX: 540 });

    expect(onTrimClip).toHaveBeenNthCalledWith(1, "clip-1", expect.objectContaining({
      edge: "left",
      edgeTime: 13,
      startTime: 13,
      duration: 5,
      inPoint: 5,
      outPoint: 10,
    }));
    expect(onTrimClip).toHaveBeenNthCalledWith(2, "clip-1", expect.objectContaining({
      edgeTime: 14,
      startTime: 14,
      duration: 4,
      inPoint: 6,
    }));
  });

  it("uses edge-only snapping for both handles and reports the exact preview edge", () => {
    useUIStore.setState({ snapSettings: { ...SNAP_SETTINGS } });
    const clip = { ...makeClip(), startTime: 10, duration: 8, inPoint: 2, outPoint: 10 };
    const other = { ...makeClip(), id: "other", startTime: 13, duration: 1 };
    const { onTrimClip, onSnapIndicator } = renderTrimClip({ clip, clips: [clip, other] });

    fireEvent.mouseDown(screen.getByTestId("clip-trim-left-clip-1"), {
      button: 0,
      clientX: 300,
    });
    fireEvent.mouseMove(window, { clientX: 352 });
    fireEvent.mouseMove(window, { clientX: 374 });
    fireEvent.mouseMove(window, { clientX: 320 });

    expect(onTrimClip).toHaveBeenNthCalledWith(1, "clip-1", expect.objectContaining({
      edge: "left",
      edgeTime: 13,
      startTime: 13,
      duration: 5,
    }));
    expect(onTrimClip).toHaveBeenNthCalledWith(2, "clip-1", expect.objectContaining({
      edgeTime: 14,
      startTime: 14,
      duration: 4,
    }));
    expect(onSnapIndicator.mock.calls.slice(0, 3)).toEqual([[13], [14], [null]]);

    fireEvent.mouseUp(window);
    fireEvent.mouseDown(screen.getByTestId("clip-trim-right-clip-1"), {
      button: 0,
      clientX: 460,
    });
    fireEvent.mouseMove(window, { clientX: 383 });

    expect(onTrimClip).toHaveBeenLastCalledWith("clip-1", expect.objectContaining({
      edge: "right",
      edgeTime: 14,
      startTime: 10,
      inPoint: 2,
      duration: 4,
      outPoint: 6,
    }));
    expect(onSnapIndicator).toHaveBeenLastCalledWith(14);
  });

  it("excludes the trimmed clip's own edges from snapping", () => {
    useUIStore.setState({ snapSettings: { ...SNAP_SETTINGS } });
    const { onTrimClip, onSnapIndicator } = renderTrimClip();

    fireEvent.mouseDown(screen.getByTestId("clip-trim-left-clip-1"), {
      button: 0,
      clientX: 300,
    });
    fireEvent.mouseMove(window, { clientX: 456 });

    expect(onTrimClip).toHaveBeenLastCalledWith("clip-1", expect.objectContaining({
      edgeTime: 17.8,
    }));
    expect(onSnapIndicator).toHaveBeenLastCalledWith(null);
  });

  it("clears the indicator when the trim clamp cannot accept the snapped edge", () => {
    useUIStore.setState({ snapSettings: { ...SNAP_SETTINGS } });
    const clip = { ...makeClip(), startTime: 10, duration: 8, inPoint: 2, outPoint: 10 };
    const unreachableTarget = {
      ...makeClip(),
      id: "unreachable-target",
      startTime: 18.2,
      duration: 1,
    };
    const { onTrimClip, onSnapIndicator } = renderTrimClip({
      clip,
      clips: [clip, unreachableTarget],
    });

    fireEvent.mouseDown(screen.getByTestId("clip-trim-left-clip-1"), {
      button: 0,
      clientX: 300,
    });
    fireEvent.mouseMove(window, { clientX: 463 });

    expect(onTrimClip).toHaveBeenLastCalledWith("clip-1", expect.objectContaining({
      edgeTime: 17.9,
      startTime: 17.9,
      duration: 0.1,
    }));
    expect(onSnapIndicator).toHaveBeenLastCalledWith(null);
  });

  it("clears the trim indicator and cursor on mouseup, Escape, and unmount", () => {
    useUIStore.setState({ snapSettings: { ...SNAP_SETTINGS } });
    const clip = { ...makeClip(), startTime: 10, duration: 8, inPoint: 2, outPoint: 10 };
    const other = { ...makeClip(), id: "other", startTime: 13, duration: 1 };
    const subject = renderTrimClip({ clip, clips: [clip, other] });
    const leftHandle = screen.getByTestId("clip-trim-left-clip-1");

    fireEvent.mouseDown(leftHandle, { button: 0, clientX: 300 });
    fireEvent.mouseMove(window, { clientX: 352 });
    expect(document.body.style.cursor).toBe("ew-resize");
    fireEvent.mouseUp(window);
    expect(subject.onSnapIndicator).toHaveBeenLastCalledWith(null);
    expect(document.body.style.cursor).toBe("");

    fireEvent.mouseDown(leftHandle, { button: 0, clientX: 300 });
    fireEvent.mouseMove(window, { clientX: 352 });
    const callsBeforeEscape = subject.onTrimClip.mock.calls.length;
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.mouseMove(window, { clientX: 374 });
    expect(subject.onTrimClip).toHaveBeenCalledTimes(callsBeforeEscape);
    expect(subject.onSnapIndicator).toHaveBeenLastCalledWith(null);
    expect(document.body.style.cursor).toBe("");

    fireEvent.mouseDown(leftHandle, { button: 0, clientX: 300 });
    fireEvent.mouseMove(window, { clientX: 352 });
    subject.unmount();
    expect(subject.onSnapIndicator).toHaveBeenLastCalledWith(null);
    expect(document.body.style.cursor).toBe("");
  });

  it("does not extend right trim beyond an unknown source boundary", () => {
    useProjectStore.setState((state) => ({
      project: {
        ...state.project,
        mediaLibrary: {
          items: [{
            ...mediaItem("media-1"),
            metadata: { ...mediaItem("media-1").metadata, duration: Number.NaN },
          }],
        },
      },
    }));
    const { onTrimClip } = renderTrimClip();

    fireEvent.mouseDown(screen.getByTestId("clip-trim-right-clip-1"), {
      button: 0,
      clientX: 460,
    });
    fireEvent.mouseMove(window, { clientX: 560 });

    expect(onTrimClip).toHaveBeenLastCalledWith("clip-1", expect.objectContaining({
      edge: "right",
      edgeTime: 18,
      duration: 8,
      outPoint: 10,
    }));
  });

  it("uses the existing image clip boundary when media duration metadata is zero", () => {
    const imageMedia: MediaItem = {
      ...mediaItem("media-1"),
      type: "image",
      metadata: { ...mediaItem("media-1").metadata, duration: 0 },
    };
    useProjectStore.setState((state) => ({
      project: {
        ...state.project,
        mediaLibrary: { items: [imageMedia] },
      },
    }));
    const imageClip: Clip = {
      ...makeClip(),
      type: "image",
      startTime: 10,
      duration: 8,
      inPoint: 2,
      outPoint: 10,
    };
    const { onTrimClip } = renderTrimClip({ clip: imageClip });

    fireEvent.mouseDown(screen.getByTestId("clip-trim-right-clip-1"), {
      button: 0,
      clientX: 460,
    });
    fireEvent.mouseMove(window, { clientX: 440 });

    expect(onTrimClip).toHaveBeenLastCalledWith("clip-1", expect.objectContaining({
      edge: "right",
      edgeTime: 17,
      startTime: 10,
      duration: 7,
      inPoint: 2,
      outPoint: 9,
    }));
  });
});
