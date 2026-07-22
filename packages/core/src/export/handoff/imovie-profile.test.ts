import { describe, expect, it } from "vitest";
import { createHandoffFixtureProject } from "./__fixtures__/projects";
import { createImovieExportProfile } from "./imovie-profile";

describe("createImovieExportProfile", () => {
  it("returns an immutable MOV H.264/AAC profile using project geometry and frame rate", () => {
    const project = createHandoffFixtureProject();
    const selection = {
      projectId: project.id,
      projectModifiedAt: project.modifiedAt,
      target: "imovie" as const,
      range: { startTime: 0, endTime: project.timeline.duration },
    };
    const settings = createImovieExportProfile(project, selection);
    expect(settings).toMatchObject({
      format: "mov",
      codec: "h264",
      width: project.settings.width,
      height: project.settings.height,
      frameRate: project.settings.frameRate,
      audioSettings: { format: "aac", sampleRate: 48_000, channels: 2 },
      range: selection.range,
    });
    expect(Object.isFrozen(settings)).toBe(true);
    expect(Object.isFrozen(settings.audioSettings)).toBe(true);
    expect(Object.isFrozen(settings.range)).toBe(true);
  });

  it("preserves a selected range without mutating the selection", () => {
    const project = createHandoffFixtureProject();
    const selection = {
      projectId: project.id,
      projectModifiedAt: project.modifiedAt,
      target: "imovie" as const,
      range: { startTime: 1, endTime: 4 },
    };
    const settings = createImovieExportProfile(project, selection);
    expect(settings.range).toEqual({ startTime: 1, endTime: 4 });
    expect(settings.range).not.toBe(selection.range);
  });
});
