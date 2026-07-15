import { describe, expect, it, vi } from "vitest";
import type { MediaItem, MediaVerificationBatchResponse } from "@openreel/core";
import {
  selectMediaAvailabilityStatus,
  selectMediaAvailabilityView,
} from "./media-availability-view";
import {
  MediaAvailabilityRuntime,
  MediaVerificationCoordinator,
} from "./media-verification";

function media(): MediaItem {
  return {
    id: "media-1",
    name: "shot.mp4",
    type: "video",
    fileHandle: null,
    blob: null,
    thumbnailUrl: null,
    metadata: {
      duration: 1,
      width: 1920,
      height: 1080,
      frameRate: 24,
      codec: "h264",
      sampleRate: 0,
      channels: 0,
      fileSize: 100,
    },
  };
}

describe("media availability view model", () => {
  it.each([
    ["confirmed_missing", true],
    ["temporarily_unavailable", false],
    ["unauthorized", false],
    ["decode_error", false],
    ["verifying", false],
    ["available", false],
  ] as const)("classifies %s without conflating outages with absence", (status, isMissing) => {
    expect(selectMediaAvailabilityView(media(), status).isMissing).toBe(isMissing);
  });

  it("counts an absent semantic media row as missing but not a legacy placeholder", () => {
    expect(selectMediaAvailabilityView(undefined, undefined).isMissing).toBe(true);
    expect(selectMediaAvailabilityStatus(media(), undefined)).toBe("verifying");
  });

  it("one-item and all-item verification retries do not mutate semantic project data", async () => {
    const batch = vi.fn(async (projectId: string, mediaIds: readonly string[]): Promise<MediaVerificationBatchResponse> => ({
      projectId,
      outcomes: mediaIds.map((mediaId) => ({
        mediaId,
        status: "temporarily_unavailable" as const,
        evidence: { authoritative: false, mapping: "unknown" as const, object: "unknown" as const },
      })),
    }));
    const runtime = new MediaAvailabilityRuntime(
      new MediaVerificationCoordinator({ batch, concurrency: 2, maxRetries: 0 }),
      { automaticRecoveryAttempts: 0 },
    );
    const project = Object.freeze({
      id: "project-1",
      mediaLibrary: Object.freeze({ items: Object.freeze([media(), { ...media(), id: "media-2" }]) }),
      timeline: Object.freeze({ tracks: Object.freeze([]) }),
    });
    const before = JSON.stringify(project);

    await runtime.verify(project.id, ["media-1"]);
    expect(JSON.stringify(project)).toBe(before);
    await runtime.verify(project.id, ["media-1", "media-2"]);
    expect(JSON.stringify(project)).toBe(before);
  });
});
