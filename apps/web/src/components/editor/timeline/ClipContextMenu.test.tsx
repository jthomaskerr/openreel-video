import "../../../test/install-local-storage-mock";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Clip, MediaItem, Track } from "@openreel/core";
import { ContextMenu, ContextMenuTrigger } from "@openreel/ui";
import { createSceneProjectionMetadata } from "@openreel/music-video-domain";
import { ClipContextMenu } from "./ClipContextMenu";
import { useProjectStore } from "../../../stores/project-store";
import { useMusicVideoStore } from "../../../stores/music-video-store";
import { useUIStore } from "../../../stores/ui-store";

function makeClip(patch: Partial<Clip> = {}): Clip {
  return {
    id: "clip-1",
    type: "video",
    mediaId: "missing-media",
    trackId: "track-1",
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    effects: [],
    audioEffects: [],
    transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 },
    volume: 1,
    keyframes: [],
    ...patch,
  };
}

function makeTrack(clip: Clip, type: Track["type"] = "video"): Track {
  return { id: "track-1", type, name: "Video", clips: [clip], transitions: [], locked: false, hidden: false, muted: false, solo: false };
}

function renderMenu(clip: Clip, track = makeTrack(clip)) {
  render(
    <ContextMenu>
      <ContextMenuTrigger>clip</ContextMenuTrigger>
      <ClipContextMenu clip={clip} track={track} onClose={vi.fn()} />
    </ContextMenu>,
  );
  fireEvent.contextMenu(screen.getByText("clip"));
}

function missingMedia(): MediaItem {
  return {
    id: "missing-media",
    name: "missing.mp4",
    type: "video",
    fileHandle: null,
    blob: null,
    metadata: { duration: 5, width: 0, height: 0, frameRate: 0, codec: "", sampleRate: 0, channels: 0, fileSize: 0 },
    thumbnailUrl: null,
  };
}

describe("ClipContextMenu missing media", () => {
  it("offers a link file action for placeholder media", () => {
    const clip = makeClip();
    useProjectStore.setState((state) => ({
      project: {
        ...state.project,
        mediaLibrary: { items: [missingMedia()] },
        timeline: { ...state.project.timeline, tracks: [makeTrack(clip)] }
      }
    }));

    render(
      <ContextMenu>
        <ContextMenuTrigger>clip</ContextMenuTrigger>
        <ClipContextMenu clip={clip} track={makeTrack(clip)} onClose={vi.fn()} />
      </ContextMenu>,
    );
    fireEvent.contextMenu(screen.getByText("clip"));

    expect(screen.getByText("Link File…")).toBeInTheDocument();
    expect(screen.getByText("Missing media placeholder")).toBeInTheDocument();
  });
});

describe("ClipContextMenu scene actions", () => {
  beforeEach(() => {
    useMusicVideoStore.getState().createProject("test-project", "Test project");
    useMusicVideoStore.getState().createScene({ label: "Sunrise", prompt: "Warm beach" });
    useMusicVideoStore.getState().createScene({ label: "Night City", prompt: "Neon rain" });
  });

  it("offers link and convert only for an ordinary video clip", () => {
    renderMenu(makeClip());

    expect(screen.getByText("Link to Existing Scene…")).toBeInTheDocument();
    expect(screen.getByText("Convert to Scene Clip")).toBeInTheDocument();
    expect(screen.queryByText("Open Scene")).not.toBeInTheDocument();
    expect(screen.queryByText("Change Linked Scene…")).not.toBeInTheDocument();
  });

  it("offers open and change only for an already-linked video clip", () => {
    const scene = useMusicVideoStore.getState().projects["test-project"].shots[0];
    const clip = makeClip({ metadata: createSceneProjectionMetadata(scene, "manual") });
    renderMenu(clip);

    expect(screen.getByText("Open Scene")).toBeInTheDocument();
    expect(screen.getByText("Change Linked Scene…")).toBeInTheDocument();
    expect(screen.queryByText("Link to Existing Scene…")).not.toBeInTheDocument();
    expect(screen.queryByText("Convert to Scene Clip")).not.toBeInTheDocument();
  });

  it("hides every scene action for a non-video clip", () => {
    const clip = makeClip({ type: "audio" });
    renderMenu(clip, makeTrack(clip, "audio"));

    expect(screen.queryByText("Link to Existing Scene…")).not.toBeInTheDocument();
    expect(screen.queryByText("Convert to Scene Clip")).not.toBeInTheDocument();
    expect(screen.queryByText("Open Scene")).not.toBeInTheDocument();
    expect(screen.queryByText("Change Linked Scene…")).not.toBeInTheDocument();
  });

  it("links stable clip and scene ids, then keeps the clip selected while opening the scene inspector", () => {
    const clip = makeClip();
    const scene = useMusicVideoStore.getState().projects["test-project"].shots[1];
    const linkClipToScene = vi.fn(() => ({ success: true as const, value: undefined }));
    const select = vi.fn();
    const setActiveTrack = vi.fn();
    const setInspectorSelection = vi.fn();
    useMusicVideoStore.setState({ linkClipToScene });
    useUIStore.setState({ select, setActiveTrack, setInspectorSelection });
    renderMenu(clip);

    fireEvent.click(screen.getByText("Link to Existing Scene…"));
    fireEvent.click(screen.getByRole("option", { name: /Night City/ }));

    expect(linkClipToScene).toHaveBeenCalledWith({ clipId: "clip-1", sceneId: scene.id });
    expect(select).toHaveBeenCalledWith({ type: "clip", id: "clip-1", trackId: "track-1" });
    expect(setActiveTrack).toHaveBeenCalledWith("track-1");
    expect(setInspectorSelection).toHaveBeenCalledWith({
      type: "scene",
      sceneId: scene.id,
      projectionClipId: "clip-1",
    });
  });

  it("converts the stable clip id and opens the returned scene", () => {
    const convertClipToScene = vi.fn(() => ({ success: true as const, value: "scene-created" }));
    const select = vi.fn();
    const setActiveTrack = vi.fn();
    const setInspectorSelection = vi.fn();
    useMusicVideoStore.setState({ convertClipToScene });
    useUIStore.setState({ select, setActiveTrack, setInspectorSelection });
    renderMenu(makeClip());

    fireEvent.click(screen.getByText("Convert to Scene Clip"));

    expect(convertClipToScene).toHaveBeenCalledWith({ clipId: "clip-1" });
    expect(select).toHaveBeenCalledWith({ type: "clip", id: "clip-1", trackId: "track-1" });
    expect(setActiveTrack).toHaveBeenCalledWith("track-1");
    expect(setInspectorSelection).toHaveBeenCalledWith({
      type: "scene",
      sceneId: "scene-created",
      projectionClipId: "clip-1",
    });
  });

  it("cancels the scene picker without invoking either mutation", () => {
    const linkClipToScene = vi.fn();
    const convertClipToScene = vi.fn();
    useMusicVideoStore.setState({ linkClipToScene, convertClipToScene });
    renderMenu(makeClip());

    fireEvent.click(screen.getByText("Link to Existing Scene…"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(linkClipToScene).not.toHaveBeenCalled();
    expect(convertClipToScene).not.toHaveBeenCalled();
  });
});
