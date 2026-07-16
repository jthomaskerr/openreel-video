import type { ProviderReferenceFixture, UnsupportedProviderReferenceFixture } from "../types";

const capturedAt = "2026-07-16T00:00:00.000Z";
const evidenceUrl = "file:///Volumes/Joseph/Projects1/ai-agents/openreel-video/apps/web/src/services/wavespeed/model-capabilities.test.ts";

export const WAVE_SPEED_REFERENCE_FIXTURES = {
  textToImage: {
    provider: "wavespeed",
    modelId: "fixture/tti",
    evidenceUrl,
    evidenceCapturedAt: capturedAt,
    acceptedFields: ["prompt", "negative_prompt", "seed", "aspect_ratio"],
    roles: {},
    minReferences: 0,
    maxReferences: 0,
    promptTokenRule: "remove",
    exampleRequest: {
      prompt: "sunlit portrait",
      negative_prompt: "blurry",
      seed: 7,
      aspect_ratio: "16:9",
    },
  },
  imageToImage: {
    provider: "wavespeed",
    modelId: "fixture/iti",
    evidenceUrl,
    evidenceCapturedAt: capturedAt,
    acceptedFields: ["prompt", "image"],
    roles: {
      source: { field: "image", cardinality: "one" },
    },
    minReferences: 1,
    maxReferences: 1,
    promptTokenRule: "remove",
    exampleRequest: {
      prompt: "refined frame",
      image: 1,
    },
  },
  textToVideo: {
    provider: "wavespeed",
    modelId: "fixture/ttv",
    evidenceUrl,
    evidenceCapturedAt: capturedAt,
    acceptedFields: ["prompt", "duration"],
    roles: {},
    minReferences: 0,
    maxReferences: 0,
    promptTokenRule: "remove",
    exampleRequest: {
      prompt: "cinematic motion",
      duration: 5,
    },
  },
  imageToVideo: {
    provider: "wavespeed",
    modelId: "fixture/itv",
    evidenceUrl,
    evidenceCapturedAt: capturedAt,
    acceptedFields: ["prompt", "image", "duration"],
    roles: {
      source: { field: "image", cardinality: "one" },
    },
    minReferences: 1,
    maxReferences: 1,
    promptTokenRule: "remove",
    exampleRequest: {
      prompt: "animate the still",
      image: 1,
      duration: 5,
    },
  },
  referenceAndAudio: {
    provider: "wavespeed",
    modelId: "fixture/reference-audio",
    evidenceUrl,
    evidenceCapturedAt: capturedAt,
    acceptedFields: ["prompt", "references", "soundtrack"],
    roles: {
      reference: { field: "references", cardinality: "many" },
    },
    minReferences: 1,
    maxReferences: 3,
    promptTokenRule: "remove",
    exampleRequest: {
      prompt: "synchronized scene",
      references: [1],
      soundtrack: "provider-audio-slot",
    },
  },
} as const satisfies Record<string, ProviderReferenceFixture>;

export const WAVE_SPEED_UNSUPPORTED_REFERENCE_FIXTURES = {
  misleadingType: {
    provider: "wavespeed",
    modelId: "fixture/misleading",
    evidenceUrl,
    evidenceCapturedAt: capturedAt,
    supported: false,
    reason: "The recorded schema advertises an unknown general type and no explicit request schema evidence.",
  },
  untypedUri: {
    provider: "wavespeed",
    modelId: "fixture/untyped-uri",
    evidenceUrl,
    evidenceCapturedAt: capturedAt,
    supported: false,
    reason: "The recorded schema exposes only an untyped URI field, which is not provider-reachable media evidence.",
  },
} as const satisfies Record<string, UnsupportedProviderReferenceFixture>;
