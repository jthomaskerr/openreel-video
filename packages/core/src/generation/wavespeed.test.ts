import { describe, expect, it } from "vitest";
import {
  createRecordedWaveSpeedModel,
  deriveWaveSpeedEvidence,
  deriveWaveSpeedFieldMap,
  getRecordedWaveSpeedModelById,
  parseWaveSpeedRequestSchema,
  recordedWaveSpeedModels,
  validateWaveSpeedProviderInputs,
} from "./wavespeed";

describe("wavespeed shared contract", () => {
  it("derives accepted fields and media roles from recorded schema evidence", () => {
    const model = recordedWaveSpeedModels.imageToVideo;
    const schema = model.api_schema.api_schemas[0].request_schema;
    const fields = deriveWaveSpeedFieldMap(schema);
    const evidence = deriveWaveSpeedEvidence(schema, fields);

    expect(fields.sourceImage).toBe("first_frame");
    expect(evidence.acceptedFields).toEqual(["prompt", "first_frame", "duration"]);
    expect(evidence.referenceLimits).toBe(false);
    expect(evidence.mediaFields).toEqual({ sourceImage: "first_frame" });
  });

  it("derives reference bounds from recorded schema evidence", () => {
    const model = recordedWaveSpeedModels.referenceAndAudio;
    const schema = model.api_schema.api_schemas[0].request_schema;
    const evidence = deriveWaveSpeedEvidence(schema, deriveWaveSpeedFieldMap(schema));

    expect(evidence.referenceLimits).toEqual({ min: 1, max: 3 });
  });

  it("validates unknown fields and leakage before provider submission", () => {
    const schema = recordedWaveSpeedModels.textToImage.api_schema.api_schemas[0].request_schema;
    const errors = validateWaveSpeedProviderInputs({
      schema,
      inputs: {
        prompt: "http://localhost/private",
        rogue: true,
      },
    });

    expect(errors).toEqual([
      { field: "prompt", code: "forbidden-url" },
      { field: "rogue", code: "unknown-field" },
    ]);
  });

  it("creates reusable recorded models and looks them up by id", () => {
    const created = createRecordedWaveSpeedModel("fixture/custom", "text-to-image", {
      prompt: { type: "string" },
    });

    expect(created.api_schema.api_schemas[0].request_schema["x-order-properties"]).toEqual([
      "prompt",
    ]);
    expect(getRecordedWaveSpeedModelById("fixture/itv")?.model_id).toBe("fixture/itv");
  });

  it("compiles only the supported strict request-schema subset", () => {
    expect(parseWaveSpeedRequestSchema({
      type: "object",
      properties: {
        prompt: { type: "string", minLength: 1 },
        references: {
          type: "array",
          items: { type: "string", format: "uri" },
          "x-openreel-media-role": "reference-images",
        },
      },
      required: ["prompt"],
      additionalProperties: false,
    })).toMatchObject({ required: ["prompt"] });

    for (const malformed of [
      {},
      { type: "object", properties: {} },
      { type: "object", properties: { prompt: { type: "mystery" } }, additionalProperties: false },
      { type: "object", properties: { references: { type: "array" } }, additionalProperties: false },
      { type: "object", properties: { prompt: { type: "string" } }, required: ["missing"], additionalProperties: false },
    ]) {
      expect(() => parseWaveSpeedRequestSchema(malformed)).toThrow("generation-route-manifest-invalid");
    }
  });
});
