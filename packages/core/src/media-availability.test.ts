import { describe, expect, expectTypeOf, it } from "vitest";
import type { Project } from "./types/project";
import {
  MEDIA_AVAILABILITY_STATUSES,
  isAuthoritativeMissing,
  type MediaAvailabilityStatus,
} from "./media-availability";

describe("MediaAvailabilityStatus", () => {
  it("contains exactly the runtime-only states from the availability contract", () => {
    expect(MEDIA_AVAILABILITY_STATUSES).toEqual([
      "available",
      "verifying",
      "temporarily_unavailable",
      "confirmed_missing",
      "decode_error",
      "unauthorized",
    ]);
  });
});

describe("isAuthoritativeMissing", () => {
  it("requires both authoritative mapping and object absence", () => {
    expect(isAuthoritativeMissing({ mapping: "absent", object: "absent", authoritative: true })).toBe(true);
    expect(isAuthoritativeMissing({ mapping: "present", object: "absent", authoritative: true })).toBe(true);
    expect(isAuthoritativeMissing({ mapping: "absent", object: "present", authoritative: true })).toBe(false);
    expect(isAuthoritativeMissing({ mapping: "unknown", object: "absent", authoritative: true })).toBe(false);
    expect(isAuthoritativeMissing({ mapping: "absent", object: "unknown", authoritative: true })).toBe(false);
    expect(isAuthoritativeMissing({ mapping: "absent", object: "absent", authoritative: false })).toBe(false);
  });
});

describe("runtime availability serialization", () => {
  it("keeps runtime availability in a sidecar that cannot enter Project JSON", () => {
    const project: Project = {
      id: "project-1",
      name: "Serialization proof",
      createdAt: 1,
      modifiedAt: 2,
      settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48_000, channels: 2 },
      mediaLibrary: { items: [] },
      timeline: { tracks: [], subtitles: [], duration: 0, markers: [] },
    };
    const runtimeAvailability = new Map<string, MediaAvailabilityStatus>([["media-1", "verifying"]]);

    expectTypeOf(project).not.toHaveProperty("runtimeAvailability");
    expect(JSON.parse(JSON.stringify(project))).toEqual(project);
    expect(JSON.stringify(project)).not.toContain("runtimeAvailability");
    expect(JSON.stringify(project)).not.toContain("verifying");
    expect(runtimeAvailability.get("media-1")).toBe("verifying");
  });
});
