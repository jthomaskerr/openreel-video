import {
  deriveWaveSpeedEvidence,
  deriveWaveSpeedFieldMap,
  getRecordedWaveSpeedModelById,
  recordedWaveSpeedModels,
} from "../../../../../../../packages/core/src/generation/wavespeed";
import type {
  ProviderReferenceFixture,
  UnsupportedProviderReferenceFixture,
} from "../types";

const evidenceCapturedAt = "2026-07-16T00:00:00.000Z";
const evidenceUrl =
  "file:///Volumes/Joseph/Projects1/ai-agents/openreel-video/apps/web/src/services/wavespeed/model-capabilities.test.ts";

function buildFixture(
  modelId: string,
  options: {
    roles: ProviderReferenceFixture["roles"];
    exampleRequest: ProviderReferenceFixture["exampleRequest"];
    minReferences?: number;
    maxReferences?: number;
  },
): ProviderReferenceFixture {
  const model = getRecordedWaveSpeedModelById(modelId);
  if (!model) {
    throw new Error(`missing recorded model ${modelId}`);
  }

  const schema = model.api_schema.api_schemas[0].request_schema;
  const evidence = deriveWaveSpeedEvidence(schema, deriveWaveSpeedFieldMap(schema));
  const referenceLimits = evidence.referenceLimits;

  return {
    provider: "wavespeed",
    modelId,
    evidenceUrl,
    evidenceCapturedAt,
    acceptedFields: evidence.acceptedFields,
    roles: options.roles,
    minReferences: referenceLimits ? referenceLimits.min : (options.minReferences ?? 0),
    maxReferences: referenceLimits ? referenceLimits.max : (options.maxReferences ?? 0),
    promptTokenRule: "remove",
    exampleRequest: options.exampleRequest,
  };
}

export const WAVE_SPEED_REFERENCE_FIXTURES = {
  textToImage: buildFixture(recordedWaveSpeedModels.textToImage.model_id, {
    roles: {},
    exampleRequest: {
      prompt: "still frame study",
      negative_prompt: "blurry",
      seed: 7,
      aspect_ratio: "16:9",
      enhance: false,
    },
  }),
  imageToImage: buildFixture(recordedWaveSpeedModels.imageToImage.model_id, {
    roles: {
      source: { field: "image", cardinality: "one" },
    },
    exampleRequest: {
      prompt: "refined frame",
      image: 1,
    },
    minReferences: 1,
    maxReferences: 1,
  }),
  textToVideo: buildFixture(recordedWaveSpeedModels.textToVideo.model_id, {
    roles: {},
    exampleRequest: {
      prompt: "cinematic motion",
      duration: 5,
    },
  }),
  imageToVideo: buildFixture(recordedWaveSpeedModels.imageToVideo.model_id, {
    roles: {
      source: { field: "first_frame", cardinality: "one" },
    },
    exampleRequest: {
      prompt: "animate still",
      first_frame: 1,
      duration: 5,
    },
    minReferences: 1,
    maxReferences: 1,
  }),
  referenceAndAudio: buildFixture(recordedWaveSpeedModels.referenceAndAudio.model_id, {
    roles: {
      reference: { field: "references", cardinality: "many" },
    },
    exampleRequest: {
      prompt: "synchronized scene",
      references: [1],
      soundtrack: "provider-audio-slot",
    },
  }),
} satisfies Record<string, ProviderReferenceFixture>;

export const WAVE_SPEED_UNSUPPORTED_REFERENCE_FIXTURES = {
  misleadingType: {
    provider: "wavespeed",
    modelId: recordedWaveSpeedModels.misleadingType.model_id,
    evidenceUrl,
    evidenceCapturedAt,
    supported: false,
    reason:
      "The recorded schema advertises an unknown general type with no explicit request schema evidence.",
  },
  untypedUri: {
    provider: "wavespeed",
    modelId: recordedWaveSpeedModels.untypedUri.model_id,
    evidenceUrl,
    evidenceCapturedAt,
    supported: false,
    reason:
      "The recorded schema exposes only an untyped URI with no provider-reachable reference field.",
  },
} satisfies Record<string, UnsupportedProviderReferenceFixture>;
