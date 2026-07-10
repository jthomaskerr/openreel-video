import type { WavespeedModel } from "../index";

type Property = Record<string, unknown>;

export function recordedModel(
  id: string,
  schemaType: string,
  properties: Record<string, Property>,
  required: string[] = [],
  generalType = "model",
): WavespeedModel {
  return {
    model_id: id,
    name: id,
    type: generalType,
    description: "Anonymized recorded WaveSpeed schema fixture",
    base_price: 0,
    formula: "",
    sort_order: 0,
    api_schema: { api_schemas: [{
      type: schemaType,
      method: "POST",
      server: "https://example.invalid",
      api_path: "/fixture",
      request_schema: {
        type: "object",
        properties: properties as unknown as WavespeedModel["api_schema"]["api_schemas"][number]["request_schema"]["properties"],
        required,
        "x-order-properties": Object.keys(properties),
      },
    }] },
  };
}

export const textToImage = recordedModel("fixture/tti", "text-to-image", {
  prompt: { type: "string", minLength: 1, default: "" },
  negative_prompt: { type: "string" },
  seed: { type: "integer", minimum: 0 },
  aspect_ratio: { type: "string", enum: ["16:9", "1:1"] },
  enhance: { type: "boolean", default: false },
}, ["prompt"]);

export const imageToImage = recordedModel("fixture/iti", "image-to-image", {
  prompt: { type: "string" },
  image: { type: "string", format: "uri", "x-ui-component": "uploader", "x-accept": "image/*" },
}, ["image"]);

export const textToVideo = recordedModel("fixture/ttv", "text-to-video", {
  prompt: { type: "string" },
  duration: { type: "integer", enum: ["5", "10"] },
}, ["prompt", "duration"]);

export const imageToVideo = recordedModel("fixture/itv", "image-to-video", {
  prompt: { type: "string" },
  first_frame: { type: "string", "x-media-role": "source-image" },
  duration: { type: "number", minimum: 2, maximum: 8, multipleOf: 0.5 },
}, ["first_frame"]);

export const referenceAndAudio = recordedModel("fixture/reference-audio", "text-to-video", {
  prompt: { type: "string" },
  references: { type: "array", items: { type: "string", format: "uri" }, minItems: 1, maxItems: 3, "x-media-role": "reference-images" },
  soundtrack: { type: "string", "x-media-role": "audio" },
}, ["prompt", "references"]);

export const untypedUri = recordedModel("fixture/untyped-uri", "text-to-image", {
  prompt: { type: "string" },
  callback_url: { type: "string", format: "uri" },
});

export const misleadingType = recordedModel("fixture/misleading", "unknown-task", {
  prompt: { type: "string" },
}, [], "image-to-video");
