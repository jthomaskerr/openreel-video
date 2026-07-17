import { describe, expect, it, vi } from "vitest";
import type { ActionResult, MediaItem, Project } from "@openreel/core";
import { finalizeGeneratedAsset, type GeneratedAssetFinalizationStore } from "./finalize-generated-asset";

const project = (item: MediaItem): Project => ({ id: "project", name: "fixture", createdAt: 1, modifiedAt: 1, settings: { width: 1, height: 1, frameRate: 30, sampleRate: 48_000, channels: 2 }, mediaLibrary: { items: [item] }, timeline: { tracks: [], duration: 0, markers: [], subtitles: [] } });
const item = (thumbnailUrl: string): MediaItem => ({ id: "placeholder", name: "placeholder.png", type: "image", fileHandle: null, blob: null, metadata: { duration: 0, width: 10, height: 10, frameRate: 0, codec: "", sampleRate: 0, channels: 0, fileSize: 1 }, thumbnailUrl, assetGroupId: undefined });
const localPrefixes = ["blob:", "local:", "file:"] as const;

describe("generation-local-url-boundaries.fixture", () => {
  it.each(localPrefixes.map((prefix) => `${prefix}http://localhost/unsafe`))("rejects %s before project mutation", async (thumbnailUrl) => {
    const finalizePlaceholder = vi.fn(async (): Promise<ActionResult> => ({ success: true, actionId: "must-not-run" }));
    const store: GeneratedAssetFinalizationStore = { project: project(item(thumbnailUrl)), finalizePlaceholder };
    const result = await finalizeGeneratedAsset(store, { target: { kind: "new-asset", placeholderMediaId: "placeholder" }, item: item(thumbnailUrl), blob: new Blob(["x"]), jobId: "job-url-boundary" });
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("ACTION_FAILED");
    expect(result.error?.message).toContain("generation-local-url-forbidden");
    expect(finalizePlaceholder).not.toHaveBeenCalled();
  });

  it.each(localPrefixes)("rejects %s target identities before project mutation", async (prefix) => {
    const finalizeVersion = vi.fn(async (): Promise<ActionResult> => ({ success: true, actionId: "must-not-run" }));
    const store: GeneratedAssetFinalizationStore = { project: project(item("https://cdn.example/thumbnail.png")), finalizeVersion };
    const result = await finalizeGeneratedAsset(store, { target: { kind: "new-version", sourceMediaId: `${prefix}source`, placeholderMediaId: "placeholder" }, item: item("https://cdn.example/thumbnail.png"), blob: new Blob(["x"]), jobId: "job-url-target" });
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("ACTION_FAILED");
    expect(result.error?.message).toContain("generation-local-url-forbidden");
    expect(finalizeVersion).not.toHaveBeenCalled();
  });
});
