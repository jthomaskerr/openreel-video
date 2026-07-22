import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import type { CompatibilityReport } from "./types";
import { renderCompatibilityReport } from "./report";

const expectedReport = readFileSync(
  new URL("./__fixtures__/expected/compatibility-report.md", import.meta.url),
  "utf8",
).trim();
const compatibilityReportSchema = JSON.parse(
  readFileSync(
    new URL("../../../../../specs/006-resolve-imovie-export/contracts/compatibility-report.schema.json", import.meta.url),
    "utf8",
  ),
) as object;
const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
addFormats(ajv);
const validateReport = ajv.compile(compatibilityReportSchema);

function report(overrides: Partial<CompatibilityReport> = {}): CompatibilityReport {
  return {
    schemaVersion: "1.0",
    project: { id: "handoff-project-1", name: "Resolve & iMovie Fixture" },
    target: {
      id: "resolve",
      label: "DaVinci Resolve",
      mode: "editable",
      contractVersion: "fcpxml-1.10",
      applicationVersions: [],
    },
    range: {
      startFrame: 0,
      endFrame: 180,
      durationFrames: 180,
      frameRate: "30/1",
      startDisplay: "00:00:00:00",
      endDisplay: "00:00:06:00",
      durationDisplay: "00:00:06:00",
    },
    artifacts: [
      { kind: "fcpxml", relativePath: "Resolve & iMovie Fixture.fcpxml", mediaType: "application/xml", required: true, status: "written" },
      { kind: "report", relativePath: "compatibility-report.md", mediaType: "text/markdown", required: true, status: "written" },
      { kind: "media", relativePath: "Media/Camera A.mov", mediaType: "video/quicktime", required: true, status: "written" },
    ],
    issues: [],
    unsupportedItems: [],
    result: { status: "completed", summary: "Handoff complete" },
    generatedAt: "2026-07-22T00:00:00.000Z",
    ...overrides,
  };
}

describe("compatibility Markdown report", () => {
  it("renders deterministic reviewed project, target, range, artifact, and result output", () => {
    expect(renderCompatibilityReport(report())).toBe(expectedReport);
    expect(renderCompatibilityReport(report())).toBe(renderCompatibilityReport(report()));
  });

  it("renders warnings and blocking or flattened-only items with corrective actions", () => {
    const blocking = {
      code: "handoff.missing-media",
      severity: "blocking" as const,
      entity: { kind: "media" as const, id: "media-1", label: "Camera.mov", trackIndex: 0, timelineFrame: 30 },
      message: "Camera.mov is unavailable.",
      action: "Relink the media and retry.",
      retryable: true,
      details: {},
    };
    const flattened = {
      ...blocking,
      code: "handoff.unsupported-retime",
      severity: "flattening" as const,
      message: "Speed changes are rendered into the MOV.",
      action: "Review the flattened result.",
    };
    const markdown = renderCompatibilityReport(report({ issues: [blocking, flattened], unsupportedItems: [blocking, flattened] }));
    expect(markdown).toContain("[BLOCKING] Camera.mov is unavailable.");
    expect(markdown).toContain("Action: Relink the media and retry.");
    expect(markdown).toContain("[FLATTENED] Speed changes are rendered into the MOV.");
  });
});

describe("compatibility report JSON Schema contract", () => {
  it.each([
    ["ready", report()],
    [
      "blocked",
      report({
        artifacts: [],
        issues: [{
          code: "handoff.missing-media",
          severity: "blocking",
          entity: { kind: "media", id: "media-1", label: "Camera.mov", trackIndex: null, timelineFrame: null },
          message: "Required media is missing.",
          action: "Relink the media and reassess.",
          retryable: true,
          details: {},
        }],
        result: { status: "failed", summary: "Compatibility assessment blocked the handoff." },
      }),
    ],
    ["cancelled", report({ artifacts: [], result: { status: "cancelled", summary: "User cancelled the handoff." } })],
    ["failed", report({ artifacts: [], result: { status: "failed", summary: "Destination write failed." } })],
  ])("validates the %s report shape", (_label, value) => {
    expect(validateReport(value), JSON.stringify(validateReport.errors, null, 2)).toBe(true);
  });
});
