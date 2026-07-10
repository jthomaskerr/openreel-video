import { describe, expect, it, vi } from "vitest";
import type { MediaItem, Project } from "@openreel/core";
import { finalizeGeneratedAsset, type GeneratedAssetFinalizationStore } from "./finalize-generated-asset";

const media = (id: string): MediaItem => ({ id, name: `${id}.png`, type: "image", fileHandle: null, blob: null, metadata: { duration: 0, width: 10, height: 10, frameRate: 0, codec: "", sampleRate: 0, channels: 0, fileSize: 1 }, thumbnailUrl: null });
const project = (placeholder = "placeholder"): Project => ({ id: "project", name: "test", createdAt: 1, modifiedAt: 1, settings: { width: 1, height: 1, frameRate: 30, sampleRate: 48000, channels: 2 }, mediaLibrary: { items: [media(placeholder)] }, timeline: { tracks: [], duration: 0, markers: [], subtitles: [] } });

describe("finalizeGeneratedAsset", () => {
  it("finalizes a new asset and appends one shot attempt with stable keys", async () => {
    const store: GeneratedAssetFinalizationStore = { project: project(), finalizePlaceholder: vi.fn(async () => ({ success: true, actionId: "a" })), appendShotAttempt: vi.fn(async () => ({ success: true, actionId: "s" })) };
    const result = await finalizeGeneratedAsset(store, { target: { kind: "new-asset", placeholderMediaId: "placeholder" }, item: media("placeholder"), blob: new Blob(["x"]), jobId: "job-1", shotId: "shot-1", attempt: { number: 1 } });
    expect(result).toMatchObject({ success: true, mediaId: "placeholder", shotLinked: true });
    expect(store.finalizePlaceholder).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "generation-finalize:job-1:new-asset" }));
    expect(store.appendShotAttempt).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "generation-shot:job-1:shot-1", generatedMediaId: "placeholder" }));
  });

  it("passes the explicit source only for new-version targets", async () => {
    const store: GeneratedAssetFinalizationStore = { project: { ...project(), mediaLibrary: { items: [media("placeholder"), media("source")] } }, finalizeVersion: vi.fn(async () => ({ success: true, actionId: "v" })) };
    await finalizeGeneratedAsset(store, { target: { kind: "new-version", sourceMediaId: "source", placeholderMediaId: "placeholder" }, item: media("placeholder"), blob: new Blob(["x"]), jobId: "job-2" });
    expect(store.finalizeVersion).toHaveBeenCalledWith(expect.objectContaining({ sourceMediaId: "source", placeholderMediaId: "placeholder" }));
  });

  it("does not guess a source when the placeholder is missing", async () => {
    const store: GeneratedAssetFinalizationStore = { project: project("other"), finalizePlaceholder: vi.fn() };
    const result = await finalizeGeneratedAsset(store, { target: { kind: "new-asset", placeholderMediaId: "missing" }, item: media("missing"), blob: new Blob(), jobId: "job-3" });
    expect(result.error?.code).toBe("MEDIA_NOT_FOUND");
    expect(store.finalizePlaceholder).not.toHaveBeenCalled();
  });
});
