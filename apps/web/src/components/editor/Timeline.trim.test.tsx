import "../../test/install-local-storage-mock";
import type { Clip, Keyframe, Track } from "@openreel/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { commitClipTrimUpdate } from "./Timeline";
import type { ClipTrimUpdate } from "./timeline/trim-calculation";

const initialKeyframes: Keyframe[] = [
  {
    id: "kf-ordinary",
    time: 1,
    property: "opacity",
    value: 0.5,
    easing: "linear",
  },
  {
    id: "kf-exit-opacity",
    time: 7.5,
    property: "opacity",
    value: 0,
    easing: "ease-out",
  },
];

const makeClip = (id: string, trackId: string): Clip => ({
  id,
  type: "video",
  mediaId: `${id}-media`,
  trackId,
  startTime: id === "target" ? 10 : 30,
  duration: id === "target" ? 8 : 4,
  inPoint: id === "target" ? 2 : 0,
  outPoint: id === "target" ? 10 : 4,
  transform: {
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    anchor: { x: 0.5, y: 0.5 },
    opacity: 1,
  },
  effects: [],
  audioEffects: [],
  volume: 0.75,
  keyframes: id === "target" ? initialKeyframes : [],
});

const makeTrack = (id: string, clips: Clip[]): Track => ({
  id,
  name: id === "target-track" ? "Primary" : "Unrelated",
  type: "video",
  clips,
  transitions: [],
  locked: false,
  hidden: false,
  muted: false,
  solo: false,
});

const getTargetClip = (): Clip => {
  const clip = useProjectStore
    .getState()
    .project.timeline.tracks.flatMap((track) => track.clips)
    .find(({ id }) => id === "target");
  if (!clip) throw new Error("target clip not found");
  return clip;
};

const timingTuple = (clip: Clip): [number, number, number, number] => [
  clip.startTime,
  clip.duration,
  clip.inPoint,
  clip.outPoint,
];

describe("commitClipTrimUpdate", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    const project = createEmptyProject("Atomic trim test");
    const target = makeClip("target", "target-track");
    const sibling = makeClip("sibling", "target-track");
    const unrelated = makeClip("unrelated", "unrelated-track");

    useProjectStore.setState({
      project: {
        ...project,
        timeline: {
          ...project.timeline,
          tracks: [
            makeTrack("target-track", [target, sibling]),
            makeTrack("unrelated-track", [unrelated]),
          ],
        },
      },
    });
  });

  it("atomically commits inward and outward left trims from the supplied payload", () => {
    const observations: Array<[number, number, number, number]> = [];
    const unsubscribe = useProjectStore.subscribe((state) => {
      const clip = state.project.timeline.tracks[0].clips[0];
      observations.push(timingTuple(clip));
    });

    const inwardKeyframes: Keyframe[] = [
      initialKeyframes[0],
      { ...initialKeyframes[1], time: 4.5 },
    ];
    commitClipTrimUpdate("target", {
      edge: "left",
      edgeTime: 13,
      startTime: 13,
      duration: 5,
      inPoint: 5,
      outPoint: 10,
      keyframes: inwardKeyframes,
    });

    expect(observations).toEqual([[13, 5, 5, 10]]);
    expect(getTargetClip().startTime + getTargetClip().duration).toBe(18);
    expect(getTargetClip().inPoint + getTargetClip().duration).toBe(
      getTargetClip().outPoint,
    );
    expect(getTargetClip().keyframes).toBe(inwardKeyframes);

    observations.length = 0;
    const outwardKeyframes: Keyframe[] = [
      initialKeyframes[0],
      { ...initialKeyframes[1], time: 6.5 },
    ];
    commitClipTrimUpdate("target", {
      edge: "left",
      edgeTime: 11,
      startTime: 11,
      duration: 7,
      inPoint: 3,
      outPoint: 10,
      keyframes: outwardKeyframes,
    });

    expect(observations).toEqual([[11, 7, 3, 10]]);
    expect(getTargetClip().startTime + getTargetClip().duration).toBe(18);
    expect(getTargetClip().inPoint + getTargetClip().duration).toBe(
      getTargetClip().outPoint,
    );
    expect(getTargetClip().keyframes).toBe(outwardKeyframes);
    unsubscribe();
  });

  it("commits right trim values without changing either supplied left edge", () => {
    commitClipTrimUpdate("target", {
      edge: "left",
      edgeTime: 11,
      startTime: 11,
      duration: 7,
      inPoint: 3,
      outPoint: 10,
      keyframes: initialKeyframes,
    });

    const observations: Array<[number, number, number, number]> = [];
    const unsubscribe = useProjectStore.subscribe((state) => {
      observations.push(timingTuple(state.project.timeline.tracks[0].clips[0]));
    });
    const rightTrimKeyframes = [
      initialKeyframes[0],
      { ...initialKeyframes[1], time: 3.5 },
    ];
    commitClipTrimUpdate("target", {
      edge: "right",
      edgeTime: 15,
      startTime: 11,
      duration: 4,
      inPoint: 3,
      outPoint: 7,
      keyframes: rightTrimKeyframes,
    });

    expect(observations).toEqual([[11, 4, 3, 7]]);
    expect(getTargetClip().startTime).toBe(11);
    expect(getTargetClip().inPoint).toBe(3);
    expect(getTargetClip().keyframes).toBe(rightTrimKeyframes);
    unsubscribe();
  });

  it("preserves unrelated clip, track, timeline, project, and store state", () => {
    const before = useProjectStore.getState();
    const targetBefore = getTargetClip();
    const siblingBefore = before.project.timeline.tracks[0].clips[1];
    const unrelatedTrackBefore = before.project.timeline.tracks[1];
    const timelineMarkersBefore = before.project.timeline.markers;
    const settingsBefore = before.project.settings;
    const mediaLibraryBefore = before.project.mediaLibrary;
    const undoBefore = before.undo;
    vi.spyOn(Date, "now").mockReturnValue(123_456);

    commitClipTrimUpdate("target", {
      edge: "left",
      edgeTime: 13,
      startTime: 13,
      duration: 5,
      inPoint: 5,
      outPoint: 10,
      keyframes: initialKeyframes,
    });

    const after = useProjectStore.getState();
    const targetAfter = getTargetClip();
    expect(targetAfter).toMatchObject({
      mediaId: targetBefore.mediaId,
      trackId: targetBefore.trackId,
      transform: targetBefore.transform,
      effects: targetBefore.effects,
      audioEffects: targetBefore.audioEffects,
      volume: targetBefore.volume,
    });
    expect(after.project.timeline.tracks[0].clips[1]).toBe(siblingBefore);
    expect(after.project.timeline.tracks[1]).toBe(unrelatedTrackBefore);
    expect(after.project.timeline.markers).toBe(timelineMarkersBefore);
    expect(after.project.settings).toBe(settingsBefore);
    expect(after.project.mediaLibrary).toBe(mediaLibraryBefore);
    expect(after.project.name).toBe("Atomic trim test");
    expect(after.project.modifiedAt).toBe(123_456);
    expect(after.undo).toBe(undoBefore);
  });

  it.each([
    ["non-finite edge", { edgeTime: Number.NaN }],
    ["non-finite placement", { startTime: Number.POSITIVE_INFINITY }],
    ["negative duration", { duration: -1 }],
    ["negative source in point", { inPoint: -0.1 }],
    ["negative source out point", { outPoint: -0.1 }],
    [
      "invalid keyframe timing",
      { keyframes: [{ ...initialKeyframes[0], time: Number.NaN }] },
    ],
  ])("rejects %s without notifying or changing state", (_label, invalidPart) => {
    const before = useProjectStore.getState();
    let notifications = 0;
    const unsubscribe = useProjectStore.subscribe(() => {
      notifications += 1;
    });
    const validUpdate: ClipTrimUpdate = {
      edge: "left",
      edgeTime: 13,
      startTime: 13,
      duration: 5,
      inPoint: 5,
      outPoint: 10,
      keyframes: initialKeyframes,
    };

    commitClipTrimUpdate("target", { ...validUpdate, ...invalidPart });

    expect(useProjectStore.getState()).toBe(before);
    expect(notifications).toBe(0);
    unsubscribe();
  });

  it("does not notify when the latest store state no longer contains the clip", () => {
    const before = useProjectStore.getState();
    let notifications = 0;
    const unsubscribe = useProjectStore.subscribe(() => {
      notifications += 1;
    });

    commitClipTrimUpdate("missing", {
      edge: "left",
      edgeTime: 13,
      startTime: 13,
      duration: 5,
      inPoint: 5,
      outPoint: 10,
      keyframes: initialKeyframes,
    });

    expect(useProjectStore.getState()).toBe(before);
    expect(notifications).toBe(0);
    unsubscribe();
  });
});
