import { describe, expect, it } from "vitest";
import type { MediaItem } from "@openreel/core";
import { resolveAssetCategory } from "./asset-category";

function metadataMedia(metadata: Record<string, unknown>): MediaItem {
  return {
    id: "media-1",
    name: "Scene metadata",
    type: "video",
    sourceFile: { name: "scene.json", size: 0, lastModified: 0, folder: JSON.stringify(metadata) },
  } as MediaItem;
}

describe("resolveAssetCategory scene compatibility", () => {
  it.each([
    ["canonical", { kind: "storyboard-shot", shotId: "scene-1", source: "manual" }],
    ["legacy", { kind: "scene", sceneId: "scene-1", providerRequestId: "request-1" }],
  ])("classifies %s scene metadata through the canonical normalizer", (_name, metadata) => {
    expect(resolveAssetCategory(metadataMedia(metadata))).toMatchObject({
      category: "scene",
      label: "Scenes",
      isMetadata: true,
      metadataKind: "scene",
    });
  });
});
