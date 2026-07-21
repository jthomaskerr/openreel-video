export interface WaveSpeedSchemaProperty {
  type: "string" | "integer" | "number" | "boolean" | "array" | "object";
  title?: string;
  description?: string;
  default?: unknown;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  format?: string;
  items?: WaveSpeedSchemaProperty;
  properties?: Record<string, WaveSpeedSchemaProperty>;
  minItems?: number;
  maxItems?: number;
  multipleOf?: number;
  "x-ui-component"?: string;
  "x-ui-component-props"?: Record<string, unknown>;
  "x-rows"?: number;
  "x-accept"?: string;
  "x-order-properties"?: string[];
  "x-media-role"?: string;
  "x-openreel-media-role"?: string;
}

export interface WaveSpeedRequestSchema {
  type: "object";
  properties: Record<string, WaveSpeedSchemaProperty>;
  required?: string[];
  "x-order-properties"?: string[];
  additionalProperties?: false;
}

const REQUEST_SCHEMA_KEYS = new Set([
  "type",
  "properties",
  "required",
  "x-order-properties",
  "additionalProperties",
]);
const PROPERTY_SCHEMA_KEYS = new Set([
  "type",
  "title",
  "description",
  "default",
  "enum",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "format",
  "items",
  "minItems",
  "maxItems",
  "multipleOf",
  "x-ui-component",
  "x-rows",
  "x-accept",
  "x-order-properties",
  "x-media-role",
  "x-openreel-media-role",
]);
const SCALAR_TYPES = new Set(["string", "integer", "number", "boolean"]);
const MEDIA_ROLES = new Set(["source-image", "reference-images", "audio"]);

function schemaRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteOptional(value: unknown): boolean {
  return value === undefined || typeof value === "number" && Number.isFinite(value);
}

function nonnegativeIntegerOptional(value: unknown): boolean {
  return value === undefined || Number.isInteger(value) && Number(value) >= 0;
}

function validPropertySchema(value: unknown, nested = false): value is WaveSpeedSchemaProperty {
  if (!schemaRecord(value) || Object.keys(value).some((key) => !PROPERTY_SCHEMA_KEYS.has(key))) return false;
  if (typeof value.type !== "string") return false;
  if (value.type === "array") {
    if (nested || !validPropertySchema(value.items, true) || value.items.type === "array") return false;
  } else if (!SCALAR_TYPES.has(value.type) || value.items !== undefined) {
    return false;
  }
  for (const field of ["title", "description", "format", "x-ui-component", "x-accept"] as const) {
    if (value[field] !== undefined && typeof value[field] !== "string") return false;
  }
  for (const field of ["minimum", "maximum", "multipleOf"] as const) {
    if (!finiteOptional(value[field])) return false;
  }
  for (const field of ["minLength", "maxLength", "minItems", "maxItems", "x-rows"] as const) {
    if (!nonnegativeIntegerOptional(value[field])) return false;
  }
  if (typeof value.minimum === "number" && typeof value.maximum === "number" && value.minimum > value.maximum) return false;
  if (typeof value.minLength === "number" && typeof value.maxLength === "number" && value.minLength > value.maxLength) return false;
  if (typeof value.minItems === "number" && typeof value.maxItems === "number" && value.minItems > value.maxItems) return false;
  if (value.enum !== undefined && (!Array.isArray(value.enum) || value.enum.length === 0 || value.enum.some((item) => typeof item !== "string"))) return false;
  for (const field of ["x-order-properties"] as const) {
    if (value[field] !== undefined && (!Array.isArray(value[field]) || value[field].some((item) => typeof item !== "string"))) return false;
  }
  for (const field of ["x-media-role", "x-openreel-media-role"] as const) {
    if (value[field] !== undefined && (typeof value[field] !== "string" || !MEDIA_ROLES.has(value[field]))) return false;
  }
  return true;
}

export function parseWaveSpeedRequestSchema(value: unknown): WaveSpeedRequestSchema {
  const invalid = () => { throw new Error("generation-route-manifest-invalid"); };
  if (!schemaRecord(value) || Object.keys(value).some((key) => !REQUEST_SCHEMA_KEYS.has(key))) return invalid();
  if (value.type !== "object" || value.additionalProperties !== false || !schemaRecord(value.properties)) return invalid();
  const properties = Object.entries(value.properties);
  if (properties.length === 0) return invalid();
  const parsedProperties: Record<string, WaveSpeedSchemaProperty> = {};
  for (const [key, property] of properties) {
    if (!key.trim() || !validPropertySchema(property)) return invalid();
    parsedProperties[key] = structuredClone(property);
  }
  const propertyNames = new Set(Object.keys(parsedProperties));
  const parseFieldNames = (field: "required" | "x-order-properties"): string[] | undefined => {
    const names = value[field];
    if (names === undefined) return undefined;
    if (!Array.isArray(names)) return invalid();
    const parsedNames: string[] = [];
    for (const name of names) {
      if (typeof name !== "string" || !propertyNames.has(name) || parsedNames.includes(name)) return invalid();
      parsedNames.push(name);
    }
    return parsedNames;
  };
  const required = parseFieldNames("required");
  const orderedProperties = parseFieldNames("x-order-properties");
  const parsed: WaveSpeedRequestSchema = {
    type: "object",
    properties: parsedProperties,
    additionalProperties: false,
    ...(required ? { required } : {}),
    ...(orderedProperties ? { "x-order-properties": orderedProperties } : {}),
  };
  for (const [field, property] of Object.entries(parsed.properties)) {
    if (property.default === undefined) continue;
    const errors: WaveSpeedProviderInputError[] = [];
    validateValue(field, property.default, property, errors);
    if (errors.length > 0) return invalid();
  }
  return parsed;
}

export interface WaveSpeedApiSchemaEntry {
  type: string;
  method: string;
  server: string;
  api_path: string;
  request_schema: WaveSpeedRequestSchema;
}

export interface WaveSpeedRecordedModel {
  model_id: string;
  name: string;
  type: string;
  description: string;
  base_price: number;
  formula: string;
  sort_order: number;
  api_schema: {
    api_schemas: WaveSpeedApiSchemaEntry[];
  };
}

export interface WaveSpeedInputFieldMap {
  prompt?: string;
  negativePrompt?: string;
  sourceImage?: string;
  referenceImages?: string;
  audio?: string;
  seed?: string;
  duration?: string;
  aspectRatio?: string;
}

export interface WaveSpeedCapabilityEvidenceBase {
  acceptedFields: readonly string[];
  referenceLimits: { min: number; max: number } | false;
  mediaFields: Readonly<Record<string, string>>;
}

export interface WaveSpeedProviderInputError {
  field: string;
  code: string;
}

export interface ValidateWaveSpeedProviderInputsArgs {
  schema: WaveSpeedRequestSchema;
  inputs: Readonly<Record<string, unknown>>;
  includeRequired?: boolean;
  mappedRoleFields?: Readonly<Record<string, "one" | "many">>;
}

export function resolveWaveSpeedMediaRole(
  property: WaveSpeedSchemaProperty,
): "source-image" | "reference-images" | "audio" | undefined {
  const role = property["x-media-role"] ?? property["x-openreel-media-role"];
  if (typeof role === "string") {
    if (role === "source-image" || role === "reference-images" || role === "audio") {
      return role;
    }
    return undefined;
  }

  const accept = property["x-accept"]?.toLowerCase();
  const component = property["x-ui-component"];
  if (component !== "uploader" && component !== "uploaders") {
    return undefined;
  }
  if (accept?.includes("audio")) {
    return "audio";
  }
  if (accept?.includes("image") && property.type === "array") {
    return "reference-images";
  }
  if (accept?.includes("image")) {
    return "source-image";
  }
  return undefined;
}

function findConventionalField(
  schema: WaveSpeedRequestSchema,
  names: readonly string[],
): string | undefined {
  return names.find((name) => name in schema.properties);
}

export function deriveWaveSpeedFieldMap(
  schema: WaveSpeedRequestSchema,
  overrides: Partial<WaveSpeedInputFieldMap> = {},
): WaveSpeedInputFieldMap {
  const fields: WaveSpeedInputFieldMap = {
    prompt: findConventionalField(schema, ["prompt"]),
    negativePrompt: findConventionalField(schema, ["negative_prompt"]),
    seed: findConventionalField(schema, ["seed"]),
    duration: findConventionalField(schema, ["duration"]),
    aspectRatio: findConventionalField(schema, ["aspect_ratio"]),
  };

  for (const [key, property] of Object.entries(schema.properties)) {
    const role = resolveWaveSpeedMediaRole(property);
    if (role === "source-image" && !fields.sourceImage) {
      fields.sourceImage = key;
    }
    if (role === "reference-images" && !fields.referenceImages) {
      fields.referenceImages = key;
    }
    if (role === "audio" && !fields.audio) {
      fields.audio = key;
    }
  }

  return { ...fields, ...overrides };
}

export function deriveWaveSpeedEvidence(
  schema: WaveSpeedRequestSchema,
  fields: WaveSpeedInputFieldMap,
): WaveSpeedCapabilityEvidenceBase {
  const referenceProperty = fields.referenceImages
    ? schema.properties[fields.referenceImages]
    : undefined;
  const referenceLimits =
    referenceProperty?.type === "array"
      ? {
          min: referenceProperty.minItems ?? 0,
          max: referenceProperty.maxItems ?? Number.MAX_SAFE_INTEGER,
        }
      : false;

  const mediaFields = Object.fromEntries(
    Object.entries(fields).filter(
      ([key, value]) =>
        typeof value === "string" &&
        (key === "sourceImage" || key === "referenceImages" || key === "audio"),
    ),
  ) as Readonly<Record<string, string>>;

  return {
    acceptedFields: [...(schema["x-order-properties"] ?? Object.keys(schema.properties))],
    referenceLimits,
    mediaFields,
  };
}

const FORBIDDEN_VALUE_PATTERNS = [
  {
    code: "forbidden-url",
    pattern: /\b(?:blob:|file:|https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0))/i,
  },
  {
    code: "forbidden-canonical-token",
    pattern: /@\{[^}]+\}/,
  },
] as const;

const FORBIDDEN_KEY_PATTERN =
  /^(?:projectId|mediaId|mediaVersionId|apiKey|secret|password|authorization|credential)$/i;

function validateValue(
  field: string,
  value: unknown,
  property: WaveSpeedSchemaProperty,
  errors: WaveSpeedProviderInputError[],
): void {
  const typeOk =
    property.type === "array"
      ? Array.isArray(value)
      : property.type === "integer"
        ? typeof value === "number" && Number.isInteger(value)
        : property.type === "number"
          ? typeof value === "number" && Number.isFinite(value)
          : property.type === "object"
            ? Boolean(value) && typeof value === "object" && !Array.isArray(value)
            : typeof value === property.type;

  if (!typeOk) {
    errors.push({ field, code: "invalid-type" });
    return;
  }

  if (property.enum && typeof value !== "number" && !property.enum.includes(value as string)) {
    errors.push({ field, code: "invalid-enum" });
  }

  if (typeof value === "number") {
    if (property.minimum != null && value < property.minimum) {
      errors.push({ field, code: "below-minimum" });
    }
    if (property.maximum != null && value > property.maximum) {
      errors.push({ field, code: "above-maximum" });
    }
    const allowed = property.enum?.map(Number).filter(Number.isFinite);
    if (allowed?.length && !allowed.includes(value)) {
      errors.push({ field, code: "invalid-enum" });
    }
  }

  if (typeof value === "string") {
    if (property.minLength != null && value.length < property.minLength) {
      errors.push({ field, code: "below-min-length" });
    }
    if (property.maxLength != null && value.length > property.maxLength) {
      errors.push({ field, code: "above-max-length" });
    }
  }

  if (Array.isArray(value)) {
    if (property.minItems != null && value.length < property.minItems) {
      errors.push({ field, code: "below-min-items" });
    }
    if (property.maxItems != null && value.length > property.maxItems) {
      errors.push({ field, code: "above-max-items" });
    }
    if (property.items) {
      value.forEach((item, index) => {
        validateValue(`${field}[${index}]`, item, property.items!, errors);
      });
    }
  }
}

function scanForLeaks(
  value: unknown,
  path: string,
  errors: WaveSpeedProviderInputError[],
): void {
  if (typeof value === "string") {
    for (const { code, pattern } of FORBIDDEN_VALUE_PATTERNS) {
      if (pattern.test(value)) {
        errors.push({ field: path, code });
      }
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      scanForLeaks(item, `${path}[${index}]`, errors);
    });
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEY_PATTERN.test(key)) {
      errors.push({ field: path ? `${path}.${key}` : key, code: "forbidden-key" });
    }
    scanForLeaks(item, path ? `${path}.${key}` : key, errors);
  }
}

export function validateWaveSpeedProviderInputs(
  args: ValidateWaveSpeedProviderInputsArgs,
): WaveSpeedProviderInputError[] {
  const errors: WaveSpeedProviderInputError[] = [];

  if (args.includeRequired !== false) {
    for (const required of args.schema.required ?? []) {
      if (!(required in args.inputs)) {
        errors.push({ field: required, code: "required" });
      }
    }
  }

  for (const [field, value] of Object.entries(args.inputs)) {
    const mappedCardinality = args.mappedRoleFields?.[field];
    if (mappedCardinality) {
      const validMappedValue =
        mappedCardinality === "one"
          ? typeof value === "number" && Number.isFinite(value)
          : Array.isArray(value) &&
            value.every((item) => typeof item === "number" && Number.isFinite(item));
      if (!validMappedValue) {
        errors.push({ field, code: "invalid-type" });
      }
      continue;
    }

    const property = args.schema.properties[field];
    if (!property) {
      errors.push({ field, code: "unknown-field" });
      continue;
    }
    validateValue(field, value, property, errors);
    scanForLeaks(value, field, errors);
  }

  return errors;
}

type RecordedProperty = Record<string, unknown>;

export function createRecordedWaveSpeedModel(
  id: string,
  schemaType: string,
  properties: Record<string, RecordedProperty>,
  required: string[] = [],
  generalType = "model",
): WaveSpeedRecordedModel {
  return {
    model_id: id,
    name: id,
    type: generalType,
    description: "Anonymized recorded WaveSpeed schema fixture",
    base_price: 0,
    formula: "",
    sort_order: 0,
    api_schema: {
      api_schemas: [
        {
          type: schemaType,
          method: "POST",
          server: "https://example.invalid",
          api_path: "/fixture",
          request_schema: {
            type: "object",
            properties: properties as unknown as Record<string, WaveSpeedSchemaProperty>,
            required,
            "x-order-properties": Object.keys(properties),
          },
        },
      ],
    },
  };
}

export const recordedWaveSpeedModels = {
  textToImage: createRecordedWaveSpeedModel(
    "fixture/tti",
    "text-to-image",
    {
      prompt: { type: "string", minLength: 1, default: "" },
      negative_prompt: { type: "string" },
      seed: { type: "integer", minimum: 0 },
      aspect_ratio: { type: "string", enum: ["16:9", "1:1"] },
      enhance: { type: "boolean", default: false },
    },
    ["prompt"],
  ),
  imageToImage: createRecordedWaveSpeedModel(
    "fixture/iti",
    "image-to-image",
    {
      prompt: { type: "string" },
      image: {
        type: "string",
        format: "uri",
        "x-ui-component": "uploader",
        "x-accept": "image/*",
      },
    },
    ["image"],
  ),
  textToVideo: createRecordedWaveSpeedModel(
    "fixture/ttv",
    "text-to-video",
    {
      prompt: { type: "string", minLength: 1 },
      duration: { type: "integer", enum: ["5", "10"] },
    },
    ["prompt"],
  ),
  imageToVideo: createRecordedWaveSpeedModel(
    "fixture/itv",
    "image-to-video",
    {
      prompt: { type: "string" },
      first_frame: { type: "string", "x-media-role": "source-image" },
      duration: { type: "number", minimum: 2, maximum: 8, multipleOf: 0.5 },
    },
    ["first_frame"],
  ),
  referenceAndAudio: createRecordedWaveSpeedModel(
    "fixture/reference-audio",
    "text-to-video",
    {
      prompt: { type: "string", minLength: 1 },
      references: {
        type: "array",
        items: { type: "string", format: "uri" },
        minItems: 1,
        maxItems: 3,
        "x-media-role": "reference-images",
      },
      soundtrack: { type: "string", "x-media-role": "audio" },
    },
    ["prompt", "references"],
  ),
  untypedUri: createRecordedWaveSpeedModel(
    "fixture/untyped-uri",
    "text-to-image",
    {
      prompt: { type: "string" },
      callback_url: { type: "string", format: "uri" },
    },
  ),
  misleadingType: createRecordedWaveSpeedModel(
    "fixture/misleading",
    "unknown-task",
    {
      prompt: { type: "string" },
    },
    [],
    "image-to-video",
  ),
} as const;

export function getRecordedWaveSpeedModelById(
  modelId: string,
): WaveSpeedRecordedModel | undefined {
  return Object.values(recordedWaveSpeedModels).find(
    (model) => model.model_id === modelId,
  );
}
