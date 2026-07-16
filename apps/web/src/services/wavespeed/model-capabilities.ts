import type { SchemaProperty, WavespeedModel } from "./index";
import type { GenerationModelCapability as SharedGenerationModelCapability } from "@openreel/music-video-domain/generation";

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

export interface CapabilityEvidence {
  classification: "request-schema-type" | "override";
  value: string;
  overrideVersion?: string;
  acceptedFields: readonly string[];
  referenceLimits: { min: number; max: number } | false;
  mediaFields: Readonly<Record<string, string>>;
}

export type NormalizeWaveSpeedModelResult =
  | { ok: true; capability: GenerationModelCapability; evidence: CapabilityEvidence }
  | { ok: false; code: "unsupported-schema"; evidence: CapabilityEvidence };

type RequestSchema = WavespeedModel["api_schema"]["api_schemas"][number]["request_schema"];

const SCHEMA_TYPES: Record<string, Pick<GenerationModelCapability, "output" | "mode">> = {
  "text-to-image": { output: "image", mode: "text-to-image" },
  "image-to-image": { output: "image", mode: "image-to-image" },
  "text-to-video": { output: "video", mode: "text-to-video" },
  "image-to-video": { output: "video", mode: "image-to-video" },
};

function mediaRole(property: SchemaProperty): string | undefined {
  const raw = property as SchemaProperty & {
    "x-media-role"?: unknown;
    "x-openreel-media-role"?: unknown;
  };
  const role = raw["x-media-role"] ?? raw["x-openreel-media-role"];
  if (typeof role === "string") return role;
  const accept = property["x-accept"]?.toLowerCase();
  const component = property["x-ui-component"];
  if (component !== "uploader" && component !== "uploaders") return undefined;
  if (accept?.includes("audio")) return "audio";
  if (accept?.includes("image") && property.type === "array") return "reference-images";
  if (accept?.includes("image")) return "source-image";
  return undefined;
}

function findConventionalField(schema: RequestSchema, names: string[]): string | undefined {
  return names.find((name) => name in schema.properties);
}

function fieldMap(schema: RequestSchema, override?: WaveSpeedModelOverride): ModelInputFields {
  const fields: ModelInputFields = {
    prompt: findConventionalField(schema, ["prompt"]),
    negativePrompt: findConventionalField(schema, ["negative_prompt"]),
    seed: findConventionalField(schema, ["seed"]),
    duration: findConventionalField(schema, ["duration"]),
    aspectRatio: findConventionalField(schema, ["aspect_ratio"]),
  };
  for (const [key, value] of Object.entries(schema.properties)) {
    const role = mediaRole(value);
    if (role === "source-image" && !fields.sourceImage) fields.sourceImage = key;
    if (role === "reference-images" && !fields.referenceImages) fields.referenceImages = key;
    if (role === "audio" && !fields.audio) fields.audio = key;
  }
  return { ...fields, ...override?.fields };
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function schemaVersion(schema: RequestSchema, override?: WaveSpeedModelOverride): string {
  const subset = {
    type: schema.type,
    required: [...(schema.required ?? [])].sort(),
    order: schema["x-order-properties"] ?? [],
    properties: schema.properties,
    overrideVersion: override?.version ?? null,
  };
  return `wavespeed-${stableHash(canonicalize(subset))}`;
}

function numericRule(property: SchemaProperty | undefined): GenerationModelCapability["duration"] {
  if (!property || (property.type !== "integer" && property.type !== "number")) return undefined;
  const allowed = property.enum?.map(Number).filter(Number.isFinite);
  const raw = property as SchemaProperty & { multipleOf?: number };
  if (allowed?.length) return { min: Math.min(...allowed), max: Math.max(...allowed), allowed };
  if (property.minimum == null || property.maximum == null) return undefined;
  return { min: property.minimum, max: property.maximum, ...(raw.multipleOf ? { step: raw.multipleOf } : {}) };
}

export function normalizeWaveSpeedModel(
  rawModel: WavespeedModel,
  overrideRegistry: WaveSpeedOverrideRegistry = {},
): NormalizeWaveSpeedModelResult {
  const entry = rawModel.api_schema?.api_schemas?.[0];
  const override = overrideRegistry[rawModel.model_id];
  const exact = entry ? SCHEMA_TYPES[entry.type.toLowerCase()] : undefined;
  const classification = override ? "override" : "request-schema-type";
  if (!entry?.request_schema?.properties || (!override && !exact)) {
    return {
      ok: false,
      code: "unsupported-schema",
      evidence: {
        classification,
        value: override ? rawModel.model_id : (entry?.type ?? "missing"),
        ...(override ? { overrideVersion: override.version } : {}),
        acceptedFields: [],
        referenceLimits: false,
        mediaFields: {},
      },
    };
  }
  const schema = entry.request_schema;
  const fields = fieldMap(schema, override);
  const referenceProperty = fields.referenceImages ? schema.properties[fields.referenceImages] : undefined;
  const arrayLimits = referenceProperty as (SchemaProperty & { minItems?: number; maxItems?: number }) | undefined;
  const referenceLimits = referenceProperty?.type === "array"
    ? { min: arrayLimits?.minItems ?? 0, max: arrayLimits?.maxItems ?? Number.MAX_SAFE_INTEGER }
    : false;
  const evidence: CapabilityEvidence = {
    classification,
    value: override ? rawModel.model_id : (entry?.type ?? "missing"),
    ...(override ? { overrideVersion: override.version } : {}),
    acceptedFields: [...(schema["x-order-properties"] ?? Object.keys(schema.properties))],
    referenceLimits,
    mediaFields: Object.fromEntries(
      Object.entries(fields).filter(([key]) => ["sourceImage", "referenceImages", "audio"].includes(key)),
    ) as Record<string, string>,
  };
  for (const field of Object.values(override?.fields ?? {})) {
    if (field && !(field in schema.properties)) return { ok: false, code: "unsupported-schema", evidence };
  }
  const classified = override ?? exact!;
  const aspectProperty = fields.aspectRatio ? schema.properties[fields.aspectRatio] : undefined;
  const capability: GenerationModelCapability = {
    provider: "wavespeed",
    modelId: rawModel.model_id,
    displayName: rawModel.name,
    output: classified.output,
    mode: classified.mode,
    accepts: {
      prompt: Boolean(fields.prompt),
      negativePrompt: Boolean(fields.negativePrompt),
      sourceImage: Boolean(fields.sourceImage),
      referenceImages: referenceLimits,
      audio: Boolean(fields.audio),
      seed: Boolean(fields.seed),
    },
    ...(fields.duration ? { duration: numericRule(schema.properties[fields.duration]) } : {}),
    ...(aspectProperty?.enum ? { aspectRatios: [...aspectProperty.enum] } : {}),
    requestSchemaVersion: schemaVersion(schema, override),
    schemaVersion: schemaVersion(schema, override),
    supportsAudio: Boolean(fields.audio),
    ...(fields.sourceImage ? { sourceField: fields.sourceImage } : {}),
    ...(fields.referenceImages ? { referenceField: fields.referenceImages } : {}),
    ...(fields.audio ? { audioField: fields.audio } : {}),
    ...(referenceLimits ? {
      referenceMinimum: referenceLimits.min,
      referenceMaximum: referenceLimits.max,
    } : {}),
    inputFields: fields,
  };
  return { ok: true, capability, evidence };
}

export function getModelDefaults(schema: RequestSchema): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(schema.properties)
      .filter(([, property]) => Object.prototype.hasOwnProperty.call(property, "default"))
      .map(([key, property]) => [key, property.default]),
  );
}
