import { describe, expect, it } from "vitest";
import type { StoryboardShot } from "./types.js";
import {
  createSceneProjectionMetadata,
  getSceneIdFromClip,
  isSceneProjection,
  normalizeSceneProjectionMetadata,
} from "./scene-projection.js";

const manualUnplacedScene = {
  id: "scene-manual",
  index: 0,
  label: "Untitled Scene",
  prompt: "",
  model: "default",
  resolution: "1920x1080",
  aspectRatio: "16:9",
  includeMainAudio: false,
  referenceAssetIds: [],
  generatedAssetIds: [],
  validation: { valid: true, warnings: [], errors: [] },
  outputs: [],
  selected: false,
  source: "manual",
} satisfies StoryboardShot;

describe("StoryboardShot compatibility", () => {
  it("accepts a manual unplaced scene without fake planning timing", () => {
    expect(manualUnplacedScene).not.toHaveProperty("startSeconds");
    expect(manualUnplacedScene).not.toHaveProperty("endSeconds");
  });
});

describe("scene projection metadata", () => {
  it("normalizes canonical metadata and preserves unknown fields", () => {
    const metadata = {
      kind: "storyboard-shot",
      shotId: "scene-1",
      source: "manual",
      providerRequestId: "request-1",
    };

    expect(normalizeSceneProjectionMetadata(metadata)).toEqual(metadata);
  });

  it.each([
    ["canonical", { kind: "storyboard-shot", shotId: "scene-1", source: "manual" }],
    ["legacy shotId", { kind: "scene", shotId: "scene-1" }],
    ["legacy sceneId", { kind: "scene", sceneId: "scene-1" }],
    [
      "NeuralFrames legacy",
      { kind: "scene", shotId: "scene-1", source: "llm", importSource: "neuralframes", importId: "nf-1" },
    ],
  ])("resolves the %s shape to the same scene link", (_name, metadata) => {
    const clip = { metadata };
    expect(getSceneIdFromClip(clip)).toBe("scene-1");
    expect(isSceneProjection(clip)).toBe(true);
  });

  it("derives NeuralFrames source while retaining provider markers", () => {
    const normalized = normalizeSceneProjectionMetadata({
      kind: "scene",
      shotId: "scene-nf",
      source: "llm",
      importSource: "neuralframes",
      importId: "nf-7",
    });

    expect(normalized).toMatchObject({
      kind: "storyboard-shot",
      shotId: "scene-nf",
      source: "neuralframes",
      importSource: "neuralframes",
      importId: "nf-7",
    });
  });

  it.each([
    undefined,
    null,
    [],
    {},
    { kind: "storyboard-shot" },
    { kind: "storyboard-shot", shotId: " " },
    { kind: "scene" },
    { kind: "scene", id: "metadata-id-only" },
    { kind: "other", shotId: "scene-1" },
  ])("returns no link for malformed or unrelated metadata %#", (metadata) => {
    expect(() => normalizeSceneProjectionMetadata(metadata)).not.toThrow();
    expect(normalizeSceneProjectionMetadata(metadata)).toBeUndefined();
    expect(getSceneIdFromClip({ metadata })).toBeUndefined();
  });

  it("always writes the canonical kind and requested source", () => {
    expect(createSceneProjectionMetadata(manualUnplacedScene, "manual")).toEqual({
      kind: "storyboard-shot",
      shotId: "scene-manual",
      shotIndex: 0,
      label: "Untitled Scene",
      prompt: "",
      source: "manual",
    });
  });
});
