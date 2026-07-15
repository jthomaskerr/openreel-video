import "../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaItem, Project, Track } from "@openreel/core";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useMusicVideoStore } from "../../stores/music-video-store";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";
import { SceneLibrary } from "./SceneLibrary";

const track = (id: string, type: Track["type"] = "video", locked = false): Track => ({
  id,
  type,
  name: id,
  clips: [],
  transitions: [],
  locked,
  hidden: false,
  muted: false,
  solo: false,
});

const media = (id: string, type: MediaItem["type"]): MediaItem => ({
  id,
  type,
  name: `${id}.${type === "video" ? "mp4" : "png"}`,
  title: type === "video" ? "Usable video" : "Still image",
  fileHandle: null,
  blob: null,
  thumbnailUrl: null,
  metadata: {
    duration: 8,
    width: 1920,
    height: 1080,
    frameRate: 24,
    codec: "h264",
    sampleRate: 48000,
    channels: 2,
    fileSize: 100,
  },
});

function editorProject(tracks: Track[] = [track("video-track")]): Project {
  const project = createEmptyProject("Scene Library Test");
  return {
    ...project,
    id: "scene-library-project",
    mediaLibrary: { items: [media("video-1", "video"), media("image-1", "image")] },
    timeline: { ...project.timeline, tracks },
  };
}

function createScene(label = "Opening scene") {
  const result = useMusicVideoStore.getState().createScene({ label });
  expect(result.success).toBe(true);
  if (!result.success) throw new Error(result.error.message);
  return result.value;
}

describe("SceneLibrary", () => {
  beforeEach(() => {
    localStorage.clear();
    useProjectStore.setState({ project: editorProject() });
    useMusicVideoStore.setState({
      projects: {},
      activeProjectId: null,
      sceneUndoStack: [],
      sceneRedoStack: [],
    });
    useMusicVideoStore.getState().createProject("scene-library-project", "Scenes");
    useMusicVideoStore.setState({ sceneUndoStack: [], sceneRedoStack: [] });
    useTimelineStore.setState({ playheadPosition: 7.125 });
    useUIStore.setState({
      activeTrackId: "video-track",
      inspectorSelection: null,
      inspectedAsset: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("creates an unplaced scene without moving the playhead and emits a frozen unique focus request", () => {
    render(<SceneLibrary />);

    fireEvent.click(screen.getByRole("button", { name: "Create Scene" }));
    const firstSelection = useUIStore.getState().inspectorSelection;
    expect(useProjectStore.getState().project.timeline.tracks[0].clips).toHaveLength(0);
    expect(useTimelineStore.getState().playheadPosition).toBe(7.125);
    expect(firstSelection).toMatchObject({
      type: "scene",
      sceneId: expect.any(String),
      focusTitleRequestId: expect.any(Number),
    });
    expect(Object.isFrozen(firstSelection)).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Create Scene" }));
    const secondSelection = useUIStore.getState().inspectorSelection;
    expect(secondSelection?.focusTitleRequestId).not.toBe(firstSelection?.focusTitleRequestId);
  });

  it("renders projection count and explicit placed status from the selector", () => {
    const sceneId = createScene();
    vi.spyOn(useMusicVideoStore.getState(), "getSceneProjectionCount").mockImplementation(
      (candidate) => candidate === sceneId ? 2 : 0,
    );

    render(<SceneLibrary />);

    const card = screen.getByRole("article", { name: "Scene: Opening scene" });
    expect(within(card).getByText("2 placements")).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Delete scene Opening scene" })).not.toBeInTheDocument();
  });

  it("confirms and deletes an unplaced scene through the typed store operation", async () => {
    const sceneId = createScene();
    vi.spyOn(globalThis, "confirm").mockReturnValue(true);
    useUIStore.getState().setInspectorSelection({ type: "scene", sceneId });
    render(<SceneLibrary />);

    fireEvent.click(screen.getByRole("button", { name: "Delete scene Opening scene" }));

    expect(globalThis.confirm).toHaveBeenCalledWith("Delete scene “Opening scene”?");
    expect(useMusicVideoStore.getState().getScene(sceneId)).toBeUndefined();
    expect(useUIStore.getState().inspectorSelection).toBeNull();
    let undoResult: Awaited<ReturnType<ReturnType<typeof useProjectStore.getState>["undo"]>>;
    await act(async () => {
      undoResult = await useProjectStore.getState().undo();
    });
    expect(undoResult!.success).toBe(true);
    expect(useMusicVideoStore.getState().getScene(sceneId)?.label).toBe("Opening scene");
  });

  it("associates only video media and creates no timeline placement", () => {
    const sceneId = createScene();
    render(<SceneLibrary />);

    fireEvent.click(screen.getByRole("button", { name: "Associate video with scene Opening scene" }));
    const picker = screen.getByLabelText("Video for scene");
    expect(within(picker).getByRole("option", { name: "Usable video" })).toBeInTheDocument();
    expect(within(picker).queryByRole("option", { name: "Still image" })).not.toBeInTheDocument();
    fireEvent.change(picker, { target: { value: "video-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Associate selected video with scene" }));

    expect(useMusicVideoStore.getState().getScene(sceneId)?.associatedMediaId).toBe("video-1");
    expect(useProjectStore.getState().project.timeline.tracks[0].clips).toHaveLength(0);
  });

  it("captures the active compatible track and exact playhead at click time", async () => {
    createScene();
    let finish!: (value: { success: true; value: string }) => void;
    const pending = new Promise<{ success: true; value: string }>((resolve) => {
      finish = resolve;
    });
    const place = vi.spyOn(useMusicVideoStore.getState(), "placeScene").mockImplementation(
      async () => pending,
    );
    render(<SceneLibrary />);

    fireEvent.click(screen.getByRole("button", { name: "Place scene Opening scene at playhead" }));
    act(() => {
      useTimelineStore.setState({ playheadPosition: 99 });
      useUIStore.setState({ activeTrackId: null });
    });
    expect(place).toHaveBeenCalledWith({
      sceneId: expect.any(String),
      trackId: "video-track",
      startTime: 7.125,
    });

    await act(async () => finish({ success: true, value: "projection-1" }));
    await waitFor(() => {
      expect(useUIStore.getState().inspectorSelection).toMatchObject({
        projectionClipId: "projection-1",
      });
    });
  });

  it("disables placement for incompatible tracks and gives every action an accessible name", () => {
    useProjectStore.setState({ project: editorProject([track("audio-track", "audio")]) });
    useUIStore.setState({ activeTrackId: "audio-track" });
    createScene();
    render(<SceneLibrary />);

    expect(screen.getByRole("button", { name: "Open scene Opening scene" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Edit scene Opening scene" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Associate video with scene Opening scene" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Place scene Opening scene at playhead" })).toBeDisabled();
  });

  it("supports associating an existing video asset with a selected scene", () => {
    const sceneId = createScene();
    render(
      <SceneLibrary
        associationMedia={media("video-1", "video")}
        onDismissAssociation={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog", { name: /Associate Usable video with Scene/i })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Scene"), { target: { value: sceneId } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Associate" }));
    expect(useMusicVideoStore.getState().getScene(sceneId)?.associatedMediaId).toBe("video-1");
    expect(useProjectStore.getState().project.timeline.tracks[0].clips).toHaveLength(0);
  });
});
