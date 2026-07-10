import { describe, expect, it } from "vitest";
import { getModelDefaults, normalizeWaveSpeedModel } from "./model-capabilities";
import { sanitizeWaveSpeedInputs } from "./adapters";
import {
  imageToImage, imageToVideo, misleadingType, recordedModel, referenceAndAudio,
  textToImage, textToVideo, untypedUri,
} from "./__fixtures__/recorded-models";

function normalized(model = textToImage) {
  const result = normalizeWaveSpeedModel(model);
  if (!result.ok) throw new Error(result.code);
  return result.capability;
}

function schema(model = textToImage) {
  return model.api_schema.api_schemas[0].request_schema;
}

describe("normalizeWaveSpeedModel", () => {
  it.each([
    [textToImage, "image", "text-to-image"],
    [imageToImage, "image", "image-to-image"],
    [textToVideo, "video", "text-to-video"],
    [imageToVideo, "video", "image-to-video"],
  ] as const)("normalizes recorded schema families", (model, output, mode) => {
    const result = normalizeWaveSpeedModel(model);
    expect(result).toMatchObject({ ok: true, capability: { output, mode } });
  });

  it("does not classify from a misleading general model type", () => {
    expect(normalizeWaveSpeedModel(misleadingType)).toMatchObject({
      ok: false, code: "unsupported-schema", evidence: { value: "unknown-task" },
    });
  });

  it("accepts a reviewed override and records its evidence", () => {
    const result = normalizeWaveSpeedModel(misleadingType, {
      "fixture/misleading": { version: "review-2", output: "video", mode: "text-to-video" },
    });
    expect(result).toMatchObject({ ok: true, evidence: { classification: "override", overrideVersion: "review-2" } });
  });

  it("fails closed when an override maps a missing media field", () => {
    expect(normalizeWaveSpeedModel(misleadingType, {
      "fixture/misleading": { version: "1", output: "video", mode: "image-to-video", fields: { sourceImage: "guess" } },
    })).toMatchObject({ ok: false, code: "unsupported-schema" });
  });

  it("does not treat an untyped URI as media", () => {
    const capability = normalized(untypedUri);
    expect(capability.accepts.sourceImage).toBe(false);
    expect(capability.inputFields).not.toHaveProperty("sourceImage");
  });

  it("extracts explicit reference, audio, duration and aspect capabilities", () => {
    expect(normalized(referenceAndAudio)).toMatchObject({
      accepts: { referenceImages: { min: 1, max: 3 }, audio: true },
    });
    expect(normalized(imageToVideo).duration).toEqual({ min: 2, max: 8, step: 0.5 });
    expect(normalized(textToImage).aspectRatios).toEqual(["16:9", "1:1"]);
    expect(normalized(textToVideo).duration).toEqual({ min: 5, max: 10, allowed: [5, 10] });
  });

  it("computes a stable version from canonical schema content and override version", () => {
    const first = normalized(textToImage).requestSchemaVersion;
    const reordered = recordedModel("fixture/tti", "text-to-image", {
      enhance: { default: false, type: "boolean" },
      aspect_ratio: { enum: ["16:9", "1:1"], type: "string" },
      seed: { minimum: 0, type: "integer" },
      negative_prompt: { type: "string" },
      prompt: { default: "", minLength: 1, type: "string" },
    }, ["prompt"]);
    reordered.api_schema.api_schemas[0].request_schema["x-order-properties"] = schema(textToImage)["x-order-properties"];
    expect(normalized(reordered).requestSchemaVersion).toBe(first);
    const drifted = structuredClone(textToImage);
    drifted.api_schema.api_schemas[0].request_schema.properties.prompt.maxLength = 500;
    expect(normalized(drifted).requestSchemaVersion).not.toBe(first);
  });

  it("returns defaults separately and preserves false, zero, and empty arrays", () => {
    const defaultsSchema = schema(recordedModel("defaults", "text-to-image", {
      flag: { type: "boolean", default: false }, count: { type: "integer", default: 0 }, refs: { type: "array", default: [] },
    }));
    expect(getModelDefaults(defaultsSchema)).toEqual({ flag: false, count: 0, refs: [] });
  });
});

describe("sanitizeWaveSpeedInputs", () => {
  it("strips unknown fields while preserving false, zero, and empty arrays", () => {
    const model = recordedModel("values", "text-to-image", {
      prompt: { type: "string" }, flag: { type: "boolean" }, count: { type: "integer" }, values: { type: "array", items: { type: "string" } },
    });
    const result = sanitizeWaveSpeedInputs({ schema: schema(model), capability: normalized(model), draftValues: {
      prompt: "p", flag: false, count: 0, values: [], injected: "remove",
    } });
    expect(result).toEqual({ inputs: { prompt: "p", flag: false, count: 0, values: [] }, errors: [] });
  });

  it("maps source, references, and audio only to reviewed fields", () => {
    const result = sanitizeWaveSpeedInputs({ schema: schema(referenceAndAudio), capability: normalized(referenceAndAudio), draftValues: { prompt: "p" },
      references: [{ tokenId: "upload-ref-1" }], audio: { tokenId: "upload-audio-1" },
    });
    expect(result).toEqual({ inputs: { prompt: "p", references: ["upload-ref-1"], soundtrack: "upload-audio-1" }, errors: [] });
  });

  it("rejects media for unannotated URI fields", () => {
    const result = sanitizeWaveSpeedInputs({ schema: schema(untypedUri), capability: normalized(untypedUri), draftValues: {}, source: { tokenId: "upload-1" } });
    expect(result.errors).toContainEqual({ field: "$source", code: "source-unsupported" });
    expect(result.inputs.callback_url).toBeUndefined();
  });

  it("requires conditional image source", () => {
    const result = sanitizeWaveSpeedInputs({ schema: schema(imageToImage), capability: normalized(imageToImage), draftValues: {} });
    expect(result.errors).toContainEqual({ field: "image", code: "source-required" });
  });

  it.each([
    [[], "below-min-references"],
    [[{ tokenId: "1" }, { tokenId: "2" }, { tokenId: "3" }, { tokenId: "4" }], "above-max-references"],
  ] as const)("validates reference count without truncating", (references, code) => {
    const result = sanitizeWaveSpeedInputs({ schema: schema(referenceAndAudio), capability: normalized(referenceAndAudio), draftValues: { prompt: "p" }, references });
    expect(result.errors).toContainEqual({ field: "references", code });
    if (references.length) expect(result.inputs.references).toHaveLength(4);
  });

  it.each([
    [1, "below-minimum"], [9, "above-maximum"],
  ])("validates duration bounds", (duration, code) => {
    const result = sanitizeWaveSpeedInputs({ schema: schema(imageToVideo), capability: normalized(imageToVideo), draftValues: { duration }, source: { tokenId: "source" } });
    expect(result.errors).toContainEqual({ field: "duration", code });
  });

  it("validates duration allowed values, required, enum, and string length in provider order", () => {
    const result = sanitizeWaveSpeedInputs({ schema: schema(textToVideo), capability: normalized(textToVideo), draftValues: { duration: 7 } });
    expect(result.errors).toEqual([
      { field: "prompt", code: "required" },
      { field: "duration", code: "invalid-enum" },
    ]);
  });
});
