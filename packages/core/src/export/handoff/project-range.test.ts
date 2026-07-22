import { describe, expect, it } from "vitest";
import {
  createHandoffFixtureClip,
  createHandoffFixtureProject,
  createHandoffFixtureTrack,
  FULL_PROJECT_RANGE,
  SELECTED_PROJECT_RANGE,
} from "./__fixtures__/projects";
import { projectRange } from "./project-range";
import { createTimebase } from "./timebase";

describe("handoff project range projection", () => {
  const timebase = createTimebase(30);

  it("projects the complete range without changing source offsets", () => {
    const projected = projectRange(createHandoffFixtureProject(), FULL_PROJECT_RANGE, timebase);

    expect(projected.frameRange).toEqual({ startFrame: 0, endFrame: 360, durationFrames: 360 });
    expect(projected.clips.map((clip) => clip.clipId)).toEqual(["video-clip-1", "audio-clip-1"]);
    expect(projected.clips[0]).toMatchObject({
      timelineRange: { startFrame: 0, endFrame: 300, durationFrames: 300 },
      sourceStartFrame: 60,
      sourceDurationFrames: 300,
    });
  });

  it("rebases a selected range and trims both source boundaries", () => {
    const projected = projectRange(createHandoffFixtureProject(), SELECTED_PROJECT_RANGE, timebase);

    expect(projected.frameRange.durationFrames).toBe(150);
    expect(projected.clips[0]).toMatchObject({
      timelineRange: { startFrame: 0, endFrame: 150, durationFrames: 150 },
      sourceStartFrame: 150,
      sourceDurationFrames: 150,
    });
  });

  it("preserves gaps relative to the selected range origin", () => {
    const project = createHandoffFixtureProject({
      timeline: {
        tracks: [
          createHandoffFixtureTrack({
            clips: [createHandoffFixtureClip({ startTime: 5, duration: 2, inPoint: 0, outPoint: 2 })],
          }),
        ],
        subtitles: [],
        duration: 10,
        markers: [],
      },
    });

    expect(projectRange(project, { startTime: 0, endTime: 10 }, timebase).clips[0].timelineRange).toEqual({
      startFrame: 150,
      endFrame: 210,
      durationFrames: 60,
    });
  });

  it("omits clips with an empty range intersection", () => {
    const project = createHandoffFixtureProject({
      timeline: {
        tracks: [createHandoffFixtureTrack({ clips: [createHandoffFixtureClip({ startTime: 9 })] })],
        subtitles: [],
        duration: 14,
        markers: [],
      },
    });
    expect(projectRange(project, { startTime: 0, endTime: 8 }, timebase).clips).toEqual([]);
  });

  it("excludes hidden video tracks", () => {
    const project = createHandoffFixtureProject();
    const hiddenVideo = { ...project.timeline.tracks[0], hidden: true };
    expect(
      projectRange(
        { ...project, timeline: { ...project.timeline, tracks: [hiddenVideo, project.timeline.tracks[1]] } },
        FULL_PROJECT_RANGE,
        timebase,
      ).clips.map((clip) => clip.kind),
    ).toEqual(["audio"]);
  });

  it("excludes muted audio tracks and muted audio clips", () => {
    const project = createHandoffFixtureProject();
    const mutedAudioTrack = { ...project.timeline.tracks[1], muted: true };
    expect(
      projectRange(
        { ...project, timeline: { ...project.timeline, tracks: [project.timeline.tracks[0], mutedAudioTrack] } },
        FULL_PROJECT_RANGE,
        timebase,
      ).clips.map((clip) => clip.kind),
    ).toEqual(["video"]);
  });

  it("adds the boundary trim to the source in-point", () => {
    const project = createHandoffFixtureProject({
      timeline: {
        tracks: [
          createHandoffFixtureTrack({
            clips: [createHandoffFixtureClip({ startTime: 2, duration: 5, inPoint: 4, outPoint: 9 })],
          }),
        ],
        subtitles: [],
        duration: 9,
        markers: [],
      },
    });
    const [clip] = projectRange(project, { startTime: 3, endTime: 6 }, timebase).clips;
    expect(clip.sourceStartFrame).toBe(150);
    expect(clip.sourceDurationFrames).toBe(90);
  });
});

