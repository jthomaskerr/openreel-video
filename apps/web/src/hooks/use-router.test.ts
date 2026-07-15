import { describe, expect, it } from "vitest";
import { parseLocation } from "./use-router";

describe("parseLocation", () => {
  it("parses the canonical hash query project id", () => {
    expect(parseLocation("#/editor?projectId=vintage-tokyo", "")).toEqual({
      route: "editor",
      params: { projectId: "vintage-tokyo" },
    });
  });

  it("merges the compatibility page query before the hash route", () => {
    expect(parseLocation("#/editor", "?projectId=vintage-tokyo")).toEqual({
      route: "editor",
      params: { projectId: "vintage-tokyo" },
    });
  });

  it("prefers canonical hash query values over compatibility page query values", () => {
    expect(parseLocation("#/editor?projectId=canonical", "?projectId=legacy")).toEqual({
      route: "editor",
      params: { projectId: "canonical" },
    });
  });
});
