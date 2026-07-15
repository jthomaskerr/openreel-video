import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Clip, Project } from "@openreel/core";
import type { StoryboardShot } from "@openreel/music-video-domain";
import { createSceneProjectionMetadata } from "@openreel/music-video-domain";
import { useMusicVideoStore } from "../../../stores/music-video-store";
import { useProjectStore } from "../../../stores/project-store";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { SceneEditor } from "./SceneEditor";

vi.mock("../generate/GenerateAssetDialog", () => ({ GenerateAssetDialog: () => null }));

const persisted = vi.hoisted(() => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => store.set(key, value)),
      removeItem: vi.fn((key: string) => store.delete(key)),
      clear: vi.fn(() => store.clear()),
    },
  });
  return store;
});

const scene = (id: string, label = "Opening scene"): StoryboardShot => ({
  id,
  index: 0,
  label,
  prompt: "A wide establishing shot",
  model: "default",
  resolution: "1920x1080",
  aspectRatio: "16:9",
  includeMainAudio: false,
  referenceAssetIds: [],
  generatedAssetIds: [],
  validation: { valid: true, errors: [], warnings: [] },
  outputs: [],
  selected: false,
  source: "manual",
});

const projection = (id: string, sceneId: string): Clip => ({
  id,
  type: "video",
  mediaId: `media-${id}`,
  trackId: "track-1",
  startTime: 2,
  duration: 5,
  inPoint: 1,
  outPoint: 6,
  effects: [],
  audioEffects: [],
  transform: {
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    anchor: { x: 0.5, y: 0.5 },
    opacity: 1,
  },
  volume: 1,
  keyframes: [],
  metadata: createSceneProjectionMetadata(
    { id: sceneId, index: 0, label: "Scene", prompt: "" },
    "manual",
  ),
});

function seed(scenes: StoryboardShot[], clips: Clip[] = []) {
  useMusicVideoStore.setState({
    projects: {},
    activeProjectId: null,
    sceneUndoStack: [],
    sceneRedoStack: [],
  });
  useMusicVideoStore.getState().createProject("editor-project", "Editor project");
  useMusicVideoStore.getState().setShots("editor-project", scenes);

  const empty = createEmptyProject("Scene editor");
  const project: Project = {
    ...empty,
    timeline: {
      ...empty.timeline,
      duration: 30,
      tracks: clips.length > 0
        ? [{
            id: "track-1",
            type: "video",
            name: "Video",
            clips,
            transitions: [],
            locked: false,
            hidden: false,
            muted: false,
            solo: false,
          }]
        : [],
    },
  };
  useProjectStore.setState({ project });
}

describe("SceneEditor", () => {
  beforeEach(() => {
    persisted.clear();
    seed([scene("scene-1")]);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders Media scenes without projection-only timing or trim", () => {
    render(<SceneEditor sceneId="scene-1" />);

    expect(screen.getByText("Not on timeline")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Scene title" })).toHaveValue("Opening scene");
    expect(screen.queryByRole("spinbutton", { name: "Clip duration" })).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton", { name: "Projection trim in point" })).not.toBeInTheDocument();
  });

  it("shows projection controls and keeps duration and trim clip-owned", async () => {
    seed([scene("scene-1")], [projection("clip-1", "scene-1")]);
    const sceneBefore = structuredClone(useMusicVideoStore.getState().getScene("scene-1"));
    render(<SceneEditor sceneId="scene-1" projectionClipId="clip-1" />);

    fireEvent.change(screen.getByRole("spinbutton", { name: "Clip duration" }), {
      target: { value: "8" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Projection trim in point" }), {
      target: { value: "2" },
    });

    await waitFor(() => {
      const clip = useProjectStore.getState().getClip("clip-1");
      expect(clip?.duration).toBe(8);
      expect(clip?.inPoint).toBe(2);
    });
    expect(useMusicVideoStore.getState().getScene("scene-1")).toEqual(sceneBefore);
  });

  it("persists shared creative edits on the scene for every projection", async () => {
    seed(
      [scene("scene-1")],
      [projection("clip-a", "scene-1"), projection("clip-b", "scene-1")],
    );
    const view = render(<SceneEditor sceneId="scene-1" projectionClipId="clip-a" />);

    fireEvent.change(screen.getByRole("textbox", { name: "Scene title" }), {
      target: { value: "Shared title" },
    });
    fireEvent.blur(screen.getByRole("textbox", { name: "Scene title" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Scene prompt" }), {
      target: { value: "Shared prompt" },
    });
    fireEvent.blur(screen.getByRole("textbox", { name: "Scene prompt" }));

    await waitFor(() => {
      expect(useMusicVideoStore.getState().getScene("scene-1")).toMatchObject({
        label: "Shared title",
        prompt: "Shared prompt",
      });
    });
    view.rerender(<SceneEditor sceneId="scene-1" projectionClipId="clip-b" />);
    expect(screen.getByRole("textbox", { name: "Scene title" })).toHaveValue("Shared title");
    expect(screen.getByRole("textbox", { name: "Scene prompt" })).toHaveValue("Shared prompt");
  });

  it("renders recoverable missing and mismatched projection states", () => {
    const missing = render(<SceneEditor sceneId="missing" />);
    expect(screen.getByText(/scene no longer exists/i)).toBeInTheDocument();
    missing.unmount();

    seed([scene("scene-1"), scene("scene-2")], [projection("clip-2", "scene-2")]);
    render(<SceneEditor sceneId="scene-1" projectionClipId="clip-2" />);
    expect(screen.getAllByText(/belongs to another scene/i).length).toBeGreaterThan(0);
    expect(screen.queryByRole("spinbutton", { name: "Clip duration" })).not.toBeInTheDocument();
  });

  it("focuses the title only for a new one-shot request", () => {
    const view = render(
      <div>
        <button type="button">Outside</button>
        <SceneEditor sceneId="scene-1" />
      </div>,
    );
    const title = screen.getByRole("textbox", { name: "Scene title" });
    const outside = screen.getByRole("button", { name: "Outside" });
    expect(title).not.toHaveFocus();

    view.rerender(
      <div>
        <button type="button">Outside</button>
        <SceneEditor sceneId="scene-1" focusTitleRequestId={1} />
      </div>,
    );
    expect(title).toHaveFocus();

    act(() => outside.focus());
    view.rerender(
      <div>
        <button type="button">Outside</button>
        <SceneEditor sceneId="scene-1" focusTitleRequestId={1} />
      </div>,
    );
    expect(outside).toHaveFocus();
  });

  it("uses generation gating without exposing an audio range", () => {
    seed([{ ...scene("scene-1"), includeMainAudio: true }]);
    render(<SceneEditor sceneId="scene-1" />);

    expect(screen.getByText(/place this scene on the timeline/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate" })).toBeDisabled();
    expect(screen.queryByLabelText(/audio range/i)).not.toBeInTheDocument();
  });
});
