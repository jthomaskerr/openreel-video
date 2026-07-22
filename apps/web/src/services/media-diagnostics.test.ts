import { describe, expect, it } from "vitest";
import { createMediaDiagnostic } from "./media-diagnostics";

describe("createMediaDiagnostic", () => {
  it("keeps actionable identifiers and normalizes unknown errors", () => {
    expect(
      createMediaDiagnostic({
        operation: "import",
        projectId: "project-1",
        mediaId: "media-1",
        filename: "clip.mov",
        stage: "local-persistence",
        error: new Error("quota exceeded"),
      }),
    ).toEqual({
      operation: "import",
      projectId: "project-1",
      mediaId: "media-1",
      filename: "clip.mov",
      stage: "local-persistence",
      errorName: "Error",
      errorMessage: "quota exceeded",
    });
  });
});
