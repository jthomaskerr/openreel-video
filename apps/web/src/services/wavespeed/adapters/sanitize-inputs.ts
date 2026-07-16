import type { SchemaProperty, WavespeedModel } from "../index";
import type { GenerationModelCapability } from "../model-capabilities";

type RequestSchema = WavespeedModel["api_schema"]["api_schemas"][number]["request_schema"];
export interface ResolvedProviderMedia { tokenId: string }
export interface InputFieldError { field: string; code: string; }

export interface SanitizeWaveSpeedInputsArgs {
  schema: RequestSchema;
  capability: GenerationModelCapability;
  draftValues: Readonly<Record<string, unknown>>;
  source?: ResolvedProviderMedia;
  references?: readonly ResolvedProviderMedia[];
  audio?: ResolvedProviderMedia;
}

export interface SanitizeWaveSpeedInputsResult {
  inputs: Record<string, unknown>;
  errors: InputFieldError[];
}

const FORBIDDEN_VALUE_PATTERNS = [
  { code: "forbidden-url", pattern: /\b(?:blob:|file:|https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0))/i },
  { code: "forbidden-canonical-token", pattern: /@\{[^}]+\}/ },
];

const FORBIDDEN_KEY_PATTERN = /^(?:projectId|mediaId|mediaVersionId|apiKey|secret|password|authorization|credential)$/i;

function validateValue(field: string, value: unknown, property: SchemaProperty, errors: InputFieldError[]): void {
  const typeOk = property.type === "array" ? Array.isArray(value)
    : property.type === "integer" ? typeof value === "number" && Number.isInteger(value)
    : property.type === "number" ? typeof value === "number" && Number.isFinite(value)
    : property.type === "object" ? Boolean(value) && typeof value === "object" && !Array.isArray(value)
    : typeof value === property.type;
  if (!typeOk) { errors.push({ field, code: "invalid-type" }); return; }
  if (property.enum && typeof value !== "number" && !property.enum.includes(value as string)) errors.push({ field, code: "invalid-enum" });
  if (typeof value === "number") {
    if (property.minimum != null && value < property.minimum) errors.push({ field, code: "below-minimum" });
    if (property.maximum != null && value > property.maximum) errors.push({ field, code: "above-maximum" });
    const allowed = property.enum?.map(Number);
    if (allowed?.length && !allowed.includes(value)) errors.push({ field, code: "invalid-enum" });
  }
  if (typeof value === "string") {
    if (property.minLength != null && value.length < property.minLength) errors.push({ field, code: "below-min-length" });
    if (property.maxLength != null && value.length > property.maxLength) errors.push({ field, code: "above-max-length" });
  }
  if (Array.isArray(value)) {
    const limits = property as SchemaProperty & { minItems?: number; maxItems?: number };
    if (limits.minItems != null && value.length < limits.minItems) errors.push({ field, code: "below-min-items" });
    if (limits.maxItems != null && value.length > limits.maxItems) errors.push({ field, code: "above-max-items" });
    if (property.items) value.forEach((item) => validateValue(field, item, property.items!, errors));
  }
}

function scanForLeaks(value: unknown, path: string, errors: InputFieldError[]): void {
  if (typeof value === "string") {
    for (const { code, pattern } of FORBIDDEN_VALUE_PATTERNS) {
      if (pattern.test(value)) errors.push({ field: path, code });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForLeaks(item, `${path}[${index}]`, errors));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEY_PATTERN.test(key)) errors.push({ field: path ? `${path}.${key}` : key, code: "forbidden-key" });
    scanForLeaks(item, path ? `${path}.${key}` : key, errors);
  }
}

export function sanitizeWaveSpeedInputs(args: SanitizeWaveSpeedInputsArgs): SanitizeWaveSpeedInputsResult {
  const { schema, capability } = args;
  const inputs: Record<string, unknown> = {};
  const errors: InputFieldError[] = [];
  const mediaFields = new Set([
    capability.inputFields.sourceImage,
    capability.inputFields.referenceImages,
    capability.inputFields.audio,
  ].filter((field): field is string => Boolean(field)));
  for (const key of schema["x-order-properties"] ?? Object.keys(schema.properties)) {
    if (!(key in schema.properties) || mediaFields.has(key)) continue;
    if (Object.prototype.hasOwnProperty.call(args.draftValues, key)) inputs[key] = args.draftValues[key];
  }
  for (const key of Object.keys(schema.properties)) {
    if (mediaFields.has(key) || key in inputs) continue;
    if (Object.prototype.hasOwnProperty.call(args.draftValues, key)) inputs[key] = args.draftValues[key];
  }

  const fields = capability.inputFields;
  if (args.source) {
    if (fields.sourceImage) inputs[fields.sourceImage] = args.source.tokenId;
    else errors.push({ field: "$source", code: "source-unsupported" });
  } else if (capability.mode === "image-to-image" || capability.mode === "image-to-video") {
    errors.push({ field: fields.sourceImage ?? "$source", code: "source-required" });
  }
  const references = args.references ?? [];
  if (references.length) {
    if (fields.referenceImages) inputs[fields.referenceImages] = references.map(({ tokenId }) => tokenId);
    else errors.push({ field: "$references", code: "references-unsupported" });
  }
  if (capability.accepts.referenceImages) {
    const count = references.length;
    if (count < capability.accepts.referenceImages.min) errors.push({ field: fields.referenceImages!, code: "below-min-references" });
    if (count > capability.accepts.referenceImages.max) errors.push({ field: fields.referenceImages!, code: "above-max-references" });
  }
  if (args.audio) {
    if (fields.audio) inputs[fields.audio] = args.audio.tokenId;
    else errors.push({ field: "$audio", code: "audio-unsupported" });
  }
  for (const required of schema.required ?? []) {
    if (!(required in inputs)) errors.push({ field: required, code: "required" });
  }
  for (const [field, value] of Object.entries(inputs)) validateValue(field, value, schema.properties[field], errors);
  for (const [field, value] of Object.entries(inputs)) scanForLeaks(value, field, errors);
  return { inputs, errors };
}
