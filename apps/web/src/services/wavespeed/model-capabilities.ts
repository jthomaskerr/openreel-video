import type { GenerationModelCapability as SharedGenerationModelCapability } from "@openreel/music-video-domain/generation";
import {
  deriveWaveSpeedEvidence,
  deriveWaveSpeedFieldMap,
  type WaveSpeedCapabilityEvidenceBase,
  type WaveSpeedRequestSchema,
} from "@openreel/core/generation/wavespeed";
import type { SchemaProperty, WavespeedModel } from "./index";

export interface GenerationModelCapability extends SharedGenerationModelCapability {
  provider: "wavespeed";
  modelId: string;
  displayName: string;
  output: "image" | "video";
  mode: "text-to-image" | "image-to-image" | "text-to-video" | "image-to-video";
  accepts: {
    prompt: boolean;
    negativePrompt: boolean;
    sourceImage: boolean;
    referenceImages: { min: number; max: number } | false;
    audio: boolean;
    seed: boolean;
  };
  duration?: { min: number; max: number; step?: number; allowed?: number[] };
  aspectRatios?: string[];
  requestSchemaVersion: string;
  schemaVersion: string;
  supportsAudio: boolean;
  sourceField?: string;
  referenceField?: string;
  audioField?: string;
  inputFields: ModelInputFields;
}

export interface ModelInputFields {
  prompt?: string;
  negativePrompt?: string;
  sourceImage?: string;
  referenceImages?: string;
  audio?: string;
  seed?: string;
  duration?: string;
  aspectRatio?: string;
}

export interface WaveSpeedModelOverride {
  version: string;
  output: GenerationModelCapability["output"];
  mode: GenerationModelCapability["mode"];
  fields?: Partial<ModelInputFields>;
}

export type WaveSpeedOverrideRegistry = Readonly<Record<string, WaveSpeedModelOverride>>;

export interface CapabilityEvidence extends WaveSpeedCapabilityEvidenceBase {
  classification: "request-schema-type" | "override";
  value: string;
  overrideVersion?: string;
}

export type NormalizeWaveSpeedModelResult =
  | { ok: true; capability: GenerationModelCapability; evidence: CapabilityEvidence }
  | { ok: false; code: "unsupported-schema"; evidence: CapabilityEvidence };

type RequestSchema = WaveSpeedRequestSchema;
type ProviderRequestSchema = WavespeedModel["api_schema"]["api_schemas"][number]["request_schema"];

function parseProviderRequestSchema(value: ProviderRequestSchema): RequestSchema {
  if (value.type !== "object") throw new Error("generation-route-manifest-invalid");
  if ("additionalProperties" in value && value.additionalProperties !== false) {
    throw new Error("generation-route-manifest-invalid");
  }
  return {
    ...structuredClone(value),
    type: "object",
    additionalProperties: false,
  };
}

const SCHEMA_TYPES: Record<
  string,
  Pick<GenerationModelCapability, "output" | "mode">
> = {
  "text-to-image": { output: "image", mode: "text-to-image" },
  "image-to-image": { output: "image", mode: "image-to-image" },
  "text-to-video": { output: "video", mode: "text-to-video" },
  "image-to-video": { output: "video", mode: "image-to-video" },
};

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function schemaVersion(
  schema: RequestSchema,
  override?: WaveSpeedModelOverride,
): string {
  const subset = {
    type: schema.type,
    required: [...(schema.required ?? [])].sort(),
    ordered: [...(schema["x-order-properties"] ?? Object.keys(schema.properties))],
    properties: schema.properties,
    overrideFields: override?.fields ?? {},
  };

  return stableHash(canonicalize(subset));
}

function numericRule(
  property: SchemaProperty | undefined,
): GenerationModelCapability["duration"] | undefined {
  if (!property || (property.type !== "integer" && property.type !== "number")) {
    return undefined;
  }

  const allowed = property.enum?.map(Number).filter(Number.isFinite);
  if (allowed?.length) {
    return {
      min: Math.min(...allowed),
      max: Math.max(...allowed),
      allowed,
    };
  }

  if (property.minimum == null || property.maximum == null) {
    return undefined;
  }

  return {
    min: property.minimum,
    max: property.maximum,
    ...(property.multipleOf ? { step: property.multipleOf } : {}),
  };
}

export function normalizeWaveSpeedModel(
  rawModel: WavespeedModel,
  overrideRegistry: WaveSpeedOverrideRegistry = {},
): NormalizeWaveSpeedModelResult {
  const entry = rawModel.api_schema?.api_schemas?.[0];
  const override = overrideRegistry[rawModel.model_id];
  const exact = entry ? SCHEMA_TYPES[entry.type.toLowerCase()] : undefined;
  const classification: CapabilityEvidence["classification"] = override
    ? "override"
    : "request-schema-type";

  if (!entry?.request_schema?.properties || (!override && !exact)) {
    return {
      ok: false,
      code: "unsupported-schema",
      evidence: {
        classification,
        value: override ? rawModel.model_id : entry?.type ?? "missing",
        ...(override ? { overrideVersion: override.version } : {}),
        acceptedFields: [],
        referenceLimits: false,
        mediaFields: {},
      },
    };
  }

  let schema: RequestSchema;
  try {
    schema = parseProviderRequestSchema(entry.request_schema);
  } catch {
    return {
      ok: false,
      code: "unsupported-schema",
      evidence: {
        classification,
        value: override ? rawModel.model_id : entry.type,
        ...(override ? { overrideVersion: override.version } : {}),
        acceptedFields: [],
        referenceLimits: false,
        mediaFields: {},
      },
    };
  }
  const inputFields = deriveWaveSpeedFieldMap(schema, override?.fields);
  const evidence: CapabilityEvidence = {
    classification,
    value: override ? rawModel.model_id : entry.type,
    ...(override ? { overrideVersion: override.version } : {}),
    ...deriveWaveSpeedEvidence(schema, inputFields),
  };

  for (const field of Object.values(override?.fields ?? {})) {
    if (field && !(field in schema.properties)) {
      return { ok: false, code: "unsupported-schema", evidence };
    }
  }

  const classified = override ?? exact!;
  const durationProperty = inputFields.duration
    ? schema.properties[inputFields.duration]
    : undefined;
  const aspectProperty = inputFields.aspectRatio
    ? schema.properties[inputFields.aspectRatio]
    : undefined;
  const requestSchemaVersion = schemaVersion(schema, override);
  const durationRule = numericRule(durationProperty);

  const capability: GenerationModelCapability = {
    provider: "wavespeed",
    modelId: rawModel.model_id,
    displayName: rawModel.name,
    output: classified.output,
    mode: classified.mode,
    accepts: {
      prompt: Boolean(inputFields.prompt),
      negativePrompt: Boolean(inputFields.negativePrompt),
      sourceImage: Boolean(inputFields.sourceImage),
      referenceImages: evidence.referenceLimits,
      audio: Boolean(inputFields.audio),
      seed: Boolean(inputFields.seed),
    },
    ...(durationRule ? { duration: durationRule } : {}),
    ...(aspectProperty?.enum ? { aspectRatios: [...aspectProperty.enum] } : {}),
    requestSchemaVersion,
    schemaVersion: requestSchemaVersion,
    supportsAudio: Boolean(inputFields.audio),
    ...(inputFields.sourceImage ? { sourceField: inputFields.sourceImage } : {}),
    ...(inputFields.referenceImages
      ? { referenceField: inputFields.referenceImages }
      : {}),
    ...(inputFields.audio ? { audioField: inputFields.audio } : {}),
    inputFields,
  };

  return { ok: true, capability, evidence };
}

export function getModelDefaults(schema: RequestSchema): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(schema.properties)
      .filter(([, property]) =>
        Object.prototype.hasOwnProperty.call(property, "default"),
      )
      .map(([key, property]) => [key, property.default]),
  );
}
