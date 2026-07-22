import { describe, expect, it } from "vitest";
import { createHandoffFixtureProject, SELECTED_PROJECT_RANGE } from "./__fixtures__/projects";
import {
  getImovieVideoSettings,
  HANDOFF_TARGET_PROFILES,
  IMOVIE_CANDIDATE,
  promoteTargetProfile,
  RESOLVE_CANDIDATE,
} from "./target-profiles";

describe("handoff target profiles", () => {
  it("defines immutable target modes and contract versions with empty advertised support", () => {
    expect(HANDOFF_TARGET_PROFILES.get("resolve")).toMatchObject({
      id: "resolve",
      mode: "editable",
      contractVersion: "fcpxml-1.10",
      applicationVersions: [],
    });
    expect(HANDOFF_TARGET_PROFILES.get("imovie")).toMatchObject({
      id: "imovie",
      mode: "flattened",
      contractVersion: "mov-h264-aac-1.0",
      applicationVersions: [],
    });
    expect(Object.isFrozen(HANDOFF_TARGET_PROFILES.get("resolve"))).toBe(true);
  });

  it("records only the exact locally installed Resolve candidate", () => {
    expect(RESOLVE_CANDIDATE).toEqual({
      target: "resolve",
      application: "DaVinci Resolve",
      version: "20.3.2",
      build: "20.3.20009",
    });
    expect(IMOVIE_CANDIDATE).toBeNull();
  });

  it("does not promote a candidate without a complete passing evidence row", () => {
    const profile = HANDOFF_TARGET_PROFILES.get("resolve")!;
    expect(() =>
      promoteTargetProfile(profile, RESOLVE_CANDIDATE, {
        target: "resolve",
        applicationVersion: "20.3.2",
        applicationBuild: "20.3.20009",
        operatingSystem: "macOS",
        fixtureId: "basic-multitrack",
        artifactSha256: "abc",
        result: "failed",
        comparisons: "not run",
        evidence: "screenshot",
        verifier: "Joseph",
        verifiedAt: "2026-07-22",
      }),
    ).toThrow(/passing evidence/i);
    expect(profile.applicationVersions).toEqual([]);
  });

  it("promotes only the exact candidate build from a complete passing row", () => {
    const promoted = promoteTargetProfile(HANDOFF_TARGET_PROFILES.get("resolve")!, RESOLVE_CANDIDATE, {
      target: "resolve",
      applicationVersion: "20.3.2",
      applicationBuild: "20.3.20009",
      operatingSystem: "macOS 15.5",
      fixtureId: "basic-multitrack",
      artifactSha256: "a".repeat(64),
      result: "passed",
      comparisons: "timeline and media mapping matched",
      evidence: "resolve-import.png",
      verifier: "Joseph",
      verifiedAt: "2026-07-22",
    });
    expect(promoted.applicationVersions).toEqual(["20.3.2 (20.3.20009)"]);
    expect(HANDOFF_TARGET_PROFILES.get("resolve")!.applicationVersions).toEqual([]);
  });

  it("returns a deeply immutable iMovie MOV AVC/AAC profile from project settings and selection", () => {
    const project = createHandoffFixtureProject();
    const settings = getImovieVideoSettings(project, {
      projectId: project.id,
      projectModifiedAt: project.modifiedAt,
      target: "imovie",
      range: SELECTED_PROJECT_RANGE,
    });
    expect(settings).toEqual({
      format: "mov",
      codec: "h264",
      width: 1920,
      height: 1080,
      frameRate: 30,
      bitrate: 5000,
      bitrateMode: "cbr",
      quality: 80,
      keyframeInterval: 60,
      audioSettings: { format: "aac", sampleRate: 48_000, bitDepth: 16, bitrate: 192, channels: 2 },
      range: SELECTED_PROJECT_RANGE,
    });
    expect(Object.isFrozen(settings)).toBe(true);
    expect(Object.isFrozen(settings.audioSettings)).toBe(true);
    expect(Object.isFrozen(settings.range)).toBe(true);
  });
});

