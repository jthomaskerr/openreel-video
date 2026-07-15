import "../test/install-local-storage-mock";
import { beforeEach, describe, expect, it } from "vitest";
import type { Clip, MediaItem, Project, Track } from "@openreel/core";
import { useMusicVideoStore } from "./music-video-store";
import { useProjectStore } from "./project-store";

const videoMedia = (id = "video-1"): MediaItem => ({
  id,
  name: `${id}.mp4`,
  title: "Source clip",
  type: "video",
  fileHandle: null,
  blob: null,
  thumbnailUrl: null,
  metadata: {
    duration: 12,
    width: 1920,
    height: 1080,
    frameRate: 24,
    codec: "h264",
    sampleRate: 48000,
    channels: 2,
    fileSize: 42,
  },
});

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

function editorProject(tracks: Track[] = [track("video-track")], media: MediaItem[] = []): Project {
  return {
    id: "editor-project",
    name: "Editor",
    createdAt: 1,
    modifiedAt: 1,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items: media },
    timeline: { tracks, subtitles: [], markers: [], duration: 0 },
  };
}

describe("music video scene operations", () => {
  beforeEach(() => {
    localStorage.clear();
    useProjectStore.setState({ project: editorProject() });
    useProjectStore.getState().actionHistory.clear();
    useMusicVideoStore.setState({
      projects: {},
      activeProjectId: null,
      sceneUndoStack: [],
      sceneRedoStack: [],
    });
    useMusicVideoStore.getState().createProject("editor-project", "Scenes");
    useMusicVideoStore.setState({ sceneUndoStack: [], sceneRedoStack: [] });
  });

  it("creates one normalized unplaced scene", () => {
    const result = useMusicVideoStore.getState().createScene();
    expect(result.success).toBe(true);
    const scenes = useMusicVideoStore.getState().projects["editor-project"].shots;
    expect(scenes).toHaveLength(1);
    expect(scenes[0]).toMatchObject({
      label: "Untitled Scene",
      prompt: "",
      source: "manual",
      includeMainAudio: false,
      referenceAssetIds: [],
    });
    expect(useProjectStore.getState().project.timeline.tracks[0].clips).toHaveLength(0);
  });

  it("initializes only the current editor scene project on first timeline creation", async () => {
    useMusicVideoStore.setState({ projects: {}, activeProjectId: "stale-other-project" });

    const result = await useMusicVideoStore.getState().createAndPlaceScene({
      trackId: "video-track",
      startTime: 1.25,
    });

    expect(result.success).toBe(true);
    expect(Object.keys(useMusicVideoStore.getState().projects)).toEqual(["editor-project"]);
    expect(useMusicVideoStore.getState().activeProjectId).toBe("editor-project");
    expect(useMusicVideoStore.getState().projects["editor-project"].shots).toHaveLength(1);
    expect(useProjectStore.getState().project.id).toBe("editor-project");
  });

  it("creates and places at the exact fractional playhead, then undoes and redoes atomically", async () => {
    const startTime = 10.123456789;
    const result = await useMusicVideoStore
      .getState()
      .createAndPlaceScene({ trackId: "video-track", startTime });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const clip = useProjectStore.getState().getClip(result.value.clipId);
    expect(clip?.startTime).toBe(startTime);
    expect(clip?.metadata).toMatchObject({ kind: "storyboard-shot", shotId: result.value.sceneId });
    expect(useMusicVideoStore.getState().getSceneProjectionCount(result.value.sceneId)).toBe(1);
    expect(useProjectStore.getState().project.mediaLibrary.items).toHaveLength(1);

    expect((await useProjectStore.getState().undo()).success).toBe(true);
    expect(useMusicVideoStore.getState().projects["editor-project"].shots).toHaveLength(0);
    expect(useProjectStore.getState().project.timeline.tracks[0].clips).toHaveLength(0);
    expect(useProjectStore.getState().project.mediaLibrary.items).toHaveLength(0);

    expect((await useProjectStore.getState().redo()).success).toBe(true);
    expect(useProjectStore.getState().getClip(result.value.clipId)?.startTime).toBe(startTime);
  });

  it("uses editor undo/redo atomically and leaves the prior action next in order", async () => {
    useProjectStore.setState({ project: editorProject([track("video-track")], [videoMedia()]) });
    const prior = await useProjectStore.getState().addClip("video-track", "video-1", 0, { type: "video" });
    expect(prior.success).toBe(true);
    const priorClipId = useProjectStore.getState().project.timeline.tracks[0].clips[0].id;

    const created = await useMusicVideoStore
      .getState()
      .createAndPlaceScene({ trackId: "video-track", startTime: 4.125 });
    expect(created.success).toBe(true);
    if (!created.success) return;
    expect(useProjectStore.getState().actionHistory.getUndoStackSize()).toBe(2);

    expect((await useProjectStore.getState().undo()).success).toBe(true);
    expect(useMusicVideoStore.getState().projects["editor-project"].shots).toHaveLength(0);
    expect(useProjectStore.getState().getClip(created.value.clipId)).toBeUndefined();
    expect(useProjectStore.getState().getClip(priorClipId)).toBeDefined();
    expect(useProjectStore.getState().project.mediaLibrary.items).toEqual([videoMedia()]);

    expect((await useProjectStore.getState().undo()).success).toBe(true);
    expect(useProjectStore.getState().getClip(priorClipId)).toBeUndefined();

    expect((await useProjectStore.getState().redo()).success).toBe(true);
    expect(useProjectStore.getState().project.timeline.tracks[0].clips).toHaveLength(1);
    expect((await useProjectStore.getState().redo()).success).toBe(true);
    expect(useMusicVideoStore.getState().projects["editor-project"].shots).toHaveLength(1);
    expect(useProjectStore.getState().getClip(created.value.clipId)?.startTime).toBe(4.125);
    expect(useProjectStore.getState().project.mediaLibrary.items).toHaveLength(2);
  });

  it.each([
    ["missing", editorProject([], []), "MISSING_TRACK"],
    ["locked", editorProject([track("locked", "video", true)]), "LOCKED_TRACK"],
    ["incompatible", editorProject([track("audio", "audio")]), "INCOMPATIBLE_TRACK"],
  ])("leaves zero mutation for a %s track", async (_label, project, code) => {
    useProjectStore.setState({ project });
    const beforeMusic = structuredClone(useMusicVideoStore.getState().projects);
    const beforeEditor = structuredClone(useProjectStore.getState().project);
    const trackId = project.timeline.tracks[0]?.id ?? "does-not-exist";
    const result = await useMusicVideoStore.getState().createAndPlaceScene({ trackId, startTime: 1.5 });
    expect(result).toMatchObject({ success: false, error: { code } });
    expect(useMusicVideoStore.getState().projects).toEqual(beforeMusic);
    expect(useProjectStore.getState().project).toEqual(beforeEditor);
  });

  it("rejects non-video association without mutation", () => {
    const audio = { ...videoMedia("audio-1"), type: "audio" as const };
    useProjectStore.setState({ project: editorProject([track("video-track")], [audio]) });
    const created = useMusicVideoStore.getState().createScene();
    expect(created.success).toBe(true);
    if (!created.success) return;
    const before = structuredClone(useMusicVideoStore.getState().projects);
    const result = useMusicVideoStore
      .getState()
      .associateSceneMedia({ sceneId: created.value, mediaId: audio.id });
    expect(result).toMatchObject({ success: false, error: { code: "NON_VIDEO_MEDIA" } });
    expect(useMusicVideoStore.getState().projects).toEqual(before);
  });

  it("supports two projections with independent exact timing", async () => {
    const created = useMusicVideoStore.getState().createScene();
    expect(created.success).toBe(true);
    if (!created.success) return;
    const first = await useMusicVideoStore
      .getState()
      .placeScene({ sceneId: created.value, trackId: "video-track", startTime: 1.25 });
    const second = await useMusicVideoStore
      .getState()
      .placeScene({ sceneId: created.value, trackId: "video-track", startTime: 9.875 });
    expect(first.success && second.success).toBe(true);
    expect(useMusicVideoStore.getState().getSceneProjections(created.value).map((clip) => clip.startTime)).toEqual([
      1.25,
      9.875,
    ]);
    expect(useProjectStore.getState().project.mediaLibrary.items).toHaveLength(1);
  });

  it("deletes only unplaced scenes and restores them through editor undo and redo", async () => {
    const unplaced = useMusicVideoStore.getState().createScene({ label: "Delete me" });
    expect(unplaced.success).toBe(true);
    if (!unplaced.success) return;

    expect(useMusicVideoStore.getState().deleteScene(unplaced.value)).toEqual({
      success: true,
      value: undefined,
    });
    expect(useMusicVideoStore.getState().getScene(unplaced.value)).toBeUndefined();
    expect((await useProjectStore.getState().undo()).success).toBe(true);
    expect(useMusicVideoStore.getState().getScene(unplaced.value)?.label).toBe("Delete me");
    expect((await useProjectStore.getState().redo()).success).toBe(true);
    expect(useMusicVideoStore.getState().getScene(unplaced.value)).toBeUndefined();

    expect((await useProjectStore.getState().undo()).success).toBe(true);
    const placed = await useMusicVideoStore.getState().placeScene({
      sceneId: unplaced.value,
      trackId: "video-track",
      startTime: 2.5,
    });
    expect(placed.success).toBe(true);
    const before = structuredClone(useMusicVideoStore.getState().projects);
    expect(useMusicVideoStore.getState().deleteScene(unplaced.value)).toEqual({
      success: false,
      error: {
        code: "SCENE_HAS_PROJECTIONS",
        message: "Remove this scene's timeline placements before deleting it.",
      },
    });
    expect(useMusicVideoStore.getState().projects).toEqual(before);
  });

  it("links by changing only canonical scene metadata keys", async () => {
    useProjectStore.setState({ project: editorProject([track("video-track")], [videoMedia()]) });
    await useProjectStore.getState().addClip("video-track", "video-1", 2, {
      type: "video",
      metadata: { extension: { keep: true }, label: "old" },
    });
    const clip = useProjectStore.getState().project.timeline.tracks[0].clips[0];
    const before = structuredClone(clip);
    const created = useMusicVideoStore.getState().createScene({ label: "Linked" });
    expect(created.success).toBe(true);
    if (!created.success) return;
    expect(useMusicVideoStore.getState().linkClipToScene({ clipId: clip.id, sceneId: created.value }).success).toBe(
      true,
    );
    const after = useProjectStore.getState().getClip(clip.id)!;
    expect({ ...after, metadata: undefined }).toEqual({ ...before, metadata: undefined });
    expect(after.metadata?.["extension"]).toEqual({ keep: true });
    expect(after.metadata).toMatchObject({ kind: "storyboard-shot", shotId: created.value, label: "Linked" });
  });

  it("converts in place while preserving the whole clip object outside link metadata", async () => {
    useProjectStore.setState({ project: editorProject([track("video-track")], [videoMedia()]) });
    await useProjectStore.getState().addClip("video-track", "video-1", 3.375, {
      type: "video",
      metadata: { unknownFutureField: [1, 2, 3] },
    });
    const original = structuredClone(useProjectStore.getState().project.timeline.tracks[0].clips[0]) as Clip;
    const result = useMusicVideoStore
      .getState()
      .convertClipToScene({ clipId: original.id, initialSceneFields: { prompt: "Keep framing" } });
    expect(result.success).toBe(true);
    const converted = useProjectStore.getState().getClip(original.id)!;
    expect({ ...converted, metadata: undefined }).toEqual({ ...original, metadata: undefined });
    expect(converted.metadata?.["unknownFutureField"]).toEqual([1, 2, 3]);
    expect((await useProjectStore.getState().undo()).success).toBe(true);
    expect(useProjectStore.getState().getClip(original.id)).toEqual(original);
    expect(useMusicVideoStore.getState().projects["editor-project"].shots).toHaveLength(0);
  });

  it("hydrates older scene records with safe defaults without eagerly rewriting storage", async () => {
    const project = structuredClone(useMusicVideoStore.getState().projects["editor-project"]);
    const legacyScene = {
      id: "legacy-scene",
      index: 0,
      label: "Legacy",
      prompt: "",
      model: "",
      resolution: "",
      aspectRatio: "",
    };
    const persisted = JSON.stringify({
      state: { projects: { "editor-project": { ...project, shots: [legacyScene] } }, activeProjectId: "editor-project" },
      version: 0,
    });
    localStorage.setItem("music-video-projects", persisted);

    await useMusicVideoStore.persist.rehydrate();

    expect(useMusicVideoStore.getState().projects["editor-project"].shots[0]).toMatchObject({
      id: "legacy-scene",
      source: "manual",
      includeMainAudio: false,
      referenceAssetIds: [],
      generatedAssetIds: [],
      outputs: [],
      selected: false,
    });
    expect(localStorage.getItem("music-video-projects")).toBe(persisted);
  });
});
