import { describe, expect, it } from "vitest";
import {
  AVAILABLE_MEDIA,
  createHandoffFixtureClip,
  createHandoffFixtureProject,
  MISSING_MEDIA,
  SELECTED_PROJECT_RANGE,
} from "./__fixtures__/projects";
import { assessHandoff, COMPATIBILITY_MATRIX, sortCompatibilityIssues } from "./compatibility";
import type { CompatibilityIssue, HandoffSelection, HandoffTargetProfile } from "./types";

const profiles = new Map<"resolve" | "imovie", HandoffTargetProfile>([
  [
    "resolve",
    {
      id: "resolve",
      label: "DaVinci Resolve",
      mode: "editable",
      contractVersion: "fcpxml-1.10",
      applicationVersions: [],
      requiredCapabilities: ["directory-write"],
      issueMatrixVersion: "1.0",
    },
  ],
  [
    "imovie",
    {
      id: "imovie",
      label: "iMovie",
      mode: "flattened",
      contractVersion: "mov-h264-aac-1.0",
      applicationVersions: [],
      requiredCapabilities: ["mov-h264-aac-encode"],
      issueMatrixVersion: "1.0",
    },
  ],
]);

const selection = (target: "resolve" | "imovie" = "resolve"): HandoffSelection => ({
  projectId: "handoff-project-1",
  projectModifiedAt: 1_700_000_000_100,
  target,
  range: SELECTED_PROJECT_RANGE,
});

describe("handoff compatibility assessment", () => {
  it("publishes a versioned exhaustive representability matrix", () => {
    expect(COMPATIBILITY_MATRIX.map(({ code, classification }) => [code, classification])).toEqual([
      ["handoff.multitrack", "supported"],
      ["handoff.normal-speed-media", "supported"],
      ["handoff.selected-range", "supported"],
      ["handoff.hidden-video-excluded", "info"],
      ["handoff.muted-audio-excluded", "info"],
      ["handoff.missing-media", "blocking"],
      ["handoff.invalid-frame-rate", "blocking"],
      ["handoff.invalid-source-range", "blocking"],
      ["handoff.zero-frame-segment", "blocking"],
      ["handoff.unsupported-retime", "target-dependent"],
      ["handoff.unsupported-picture-edit", "target-dependent"],
      ["handoff.unsupported-audio-edit", "target-dependent"],
      ["handoff.unsupported-transition", "target-dependent"],
      ["handoff.unsupported-generated-content", "target-dependent"],
      ["handoff.unknown-material-edit", "target-dependent"],
    ]);
  });

  it("marks a supported Resolve project ready", () => {
    const assessment = assessHandoff(createHandoffFixtureProject(), selection(), {
      mediaAvailability: AVAILABLE_MEDIA,
      targetProfiles: profiles,
      now: () => 123,
    });

    expect(assessment).toMatchObject({
      target: "resolve",
      status: "ready",
      issues: [],
      includedTrackIds: ["video-track-1", "audio-track-1"],
      includedClipIds: ["video-clip-1", "audio-clip-1"],
      requiredMediaIds: ["audio-media-1", "video-media-1"],
      createdAt: 123,
    });
  });

  it("treats omitted legacy clip edit arrays as empty", () => {
    const project = createHandoffFixtureProject();
    const videoTrack = project.timeline.tracks[0];
    const legacyClip = {
      ...videoTrack.clips[0],
      effects: undefined,
      audioEffects: undefined,
      keyframes: undefined,
    } as unknown as (typeof videoTrack.clips)[number];
    const legacyProject = {
      ...project,
      timeline: {
        ...project.timeline,
        tracks: [{ ...videoTrack, clips: [legacyClip] }, project.timeline.tracks[1]],
      },
    };

    expect(
      assessHandoff(legacyProject, selection(), {
        mediaAvailability: AVAILABLE_MEDIA,
        targetProfiles: profiles,
      }),
    ).toMatchObject({ status: "ready", issues: [] });
  });

  it("blocks missing required media before planning", () => {
    const assessment = assessHandoff(createHandoffFixtureProject(), selection(), {
      mediaAvailability: MISSING_MEDIA,
      targetProfiles: profiles,
    });
    expect(assessment.status).toBe("blocked");
    expect(assessment.issues).toContainEqual(
      expect.objectContaining({ code: "handoff.missing-media", severity: "blocking" }),
    );
  });

  it("blocks unsupported editable retiming but discloses it as flattened for iMovie", () => {
    const project = createHandoffFixtureProject();
    const changedVideoTrack = {
      ...project.timeline.tracks[0],
      clips: [createHandoffFixtureClip({ speed: 2 })],
    };
    const changed = {
      ...project,
      timeline: { ...project.timeline, tracks: [changedVideoTrack, project.timeline.tracks[1]] },
    };

    const resolve = assessHandoff(changed, selection("resolve"), {
      mediaAvailability: AVAILABLE_MEDIA,
      targetProfiles: profiles,
    });
    const imovie = assessHandoff(changed, selection("imovie"), {
      mediaAvailability: AVAILABLE_MEDIA,
      targetProfiles: profiles,
    });

    expect(resolve).toMatchObject({ status: "blocked" });
    expect(resolve.issues).toContainEqual(
      expect.objectContaining({ code: "handoff.unsupported-retime", severity: "blocking" }),
    );
    expect(imovie).toMatchObject({ status: "ready" });
    expect(imovie.issues).toContainEqual(
      expect.objectContaining({ code: "handoff.unsupported-retime", severity: "flattening" }),
    );
  });

  it("blocks a stale project selection", () => {
    const assessment = assessHandoff(createHandoffFixtureProject(), { ...selection(), projectModifiedAt: 1 }, {
      mediaAvailability: AVAILABLE_MEDIA,
      targetProfiles: profiles,
    });
    expect(assessment).toMatchObject({ status: "blocked" });
    expect(assessment.issues[0]).toMatchObject({ code: "handoff.stale-project", severity: "blocking" });
  });

  it("sorts issues by severity, track, frame, entity, and code", () => {
    const issue = (overrides: Partial<CompatibilityIssue>): CompatibilityIssue => ({
      code: "z",
      severity: "info",
      entity: { kind: "clip", id: "z", label: "z", trackIndex: null, timelineFrame: null },
      message: "message",
      action: "action",
      retryable: false,
      details: {},
      ...overrides,
    });
    const sorted = sortCompatibilityIssues([
      issue({ code: "b", entity: { kind: "clip", id: "b", label: "b", trackIndex: 1, timelineFrame: 20 } }),
      issue({ code: "a", severity: "blocking", entity: { kind: "clip", id: "a", label: "a", trackIndex: 2, timelineFrame: 0 } }),
      issue({ code: "c", severity: "flattening", entity: { kind: "clip", id: "c", label: "c", trackIndex: 0, timelineFrame: 10 } }),
      issue({ code: "a", entity: { kind: "clip", id: "b", label: "b", trackIndex: 1, timelineFrame: 20 } }),
    ]);
    expect(sorted.map((entry) => entry.code)).toEqual(["a", "c", "a", "b"]);
  });
});

describe("handoff compatibility performance gate", () => {
  it("assesses a 1,000-clip project five times with a median below five seconds and no run above six", () => {
    const base = createHandoffFixtureProject();
    const clips = Array.from({ length: 1_000 }, (_, index) =>
      createHandoffFixtureClip({
        id: `video-clip-${index}`,
        startTime: index / 100,
        duration: 1,
        inPoint: index / 100,
        outPoint: index / 100 + 1,
      }),
    );
    const project = {
      ...base,
      timeline: {
        ...base.timeline,
        tracks: base.timeline.tracks.map((track, index) =>
          index === 0 ? { ...track, clips } : { ...track, clips: [] },
        ),
      },
    };
    const timings = Array.from({ length: 5 }, () => {
      const started = performance.now();
      const assessment = assessHandoff(
        project,
        {
          projectId: project.id,
          projectModifiedAt: project.modifiedAt,
          target: "resolve",
          range: { startTime: 0, endTime: 11 },
        },
        { mediaAvailability: AVAILABLE_MEDIA, targetProfiles: profiles },
      );
      expect(assessment.includedClipIds).toHaveLength(1_000);
      return performance.now() - started;
    }).sort((left, right) => left - right);
    expect(timings[2]).toBeLessThan(5_000);
    expect(timings.every((duration) => duration < 6_000)).toBe(true);
  });
});
