import { describe, expect, it } from "vitest";
import { hasRequestedProjectId } from "./useTour";

describe("hasRequestedProjectId", () => {
  it("recognizes the canonical hash query", () => {
    expect(hasRequestedProjectId({
      search: "",
      hash: "#/editor?projectId=vintage-tokyo",
    })).toBe(true);
  });

  it("recognizes the compatibility page query", () => {
    expect(hasRequestedProjectId({
      search: "?projectId=vintage-tokyo",
      hash: "#/editor",
    })).toBe(true);
  });

  it("allows onboarding when no project is requested", () => {
    expect(hasRequestedProjectId({ search: "", hash: "#/editor" })).toBe(false);
  });
});
