import {
  validateWaveSpeedProviderInputs as validateSharedWaveSpeedProviderInputs,
  type WaveSpeedProviderInputError,
  type WaveSpeedRequestSchema,
} from "@openreel/core/generation/wavespeed";
import type { GenerationModelCapability } from "../model-capabilities";

type RequestSchema = WaveSpeedRequestSchema;

export interface ResolvedProviderMedia {
  tokenId: string;
}

export type InputFieldError = WaveSpeedProviderInputError;

export interface SanitizeWaveSpeedInputsArgs {
  schema: RequestSchema;
  capability: GenerationModelCapability;
  draftValues: Readonly<Record<string, unknown>>;
  source?: ResolvedProviderMedia;
  references?: readonly ResolvedProviderMedia[];
  audio?: ResolvedProviderMedia;
}

export interface ValidateWaveSpeedProviderInputsArgs {
  schema: RequestSchema;
  inputs: Readonly<Record<string, unknown>>;
  includeRequired?: boolean;
  mappedRoleFields?: Readonly<Record<string, "one" | "many">>;
}

export interface SanitizeWaveSpeedInputsResult {
  inputs: Record<string, unknown>;
  errors: InputFieldError[];
}

export function validateWaveSpeedProviderInputs(
  args: ValidateWaveSpeedProviderInputsArgs,
): InputFieldError[] {
  return validateSharedWaveSpeedProviderInputs(args);
}

export function sanitizeWaveSpeedInputs(
  args: SanitizeWaveSpeedInputsArgs,
): SanitizeWaveSpeedInputsResult {
  const { schema, capability } = args;
  const inputs: Record<string, unknown> = {};
  const errors: InputFieldError[] = [];
  const mediaFields = new Set(
    [
      capability.inputFields.sourceImage,
      capability.inputFields.referenceImages,
      capability.inputFields.audio,
    ].filter((field): field is string => Boolean(field)),
  );

  for (const key of schema["x-order-properties"] ?? Object.keys(schema.properties)) {
    if (!(key in schema.properties) || mediaFields.has(key)) {
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(args.draftValues, key)) {
      inputs[key] = args.draftValues[key];
    }
  }

  for (const key of Object.keys(schema.properties)) {
    if (mediaFields.has(key) || key in inputs) {
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(args.draftValues, key)) {
      inputs[key] = args.draftValues[key];
    }
  }

  const fields = capability.inputFields;
  if (args.source) {
    if (fields.sourceImage) {
      inputs[fields.sourceImage] = args.source.tokenId;
    } else {
      errors.push({ field: "$source", code: "source-unsupported" });
    }
  } else if (capability.mode === "image-to-image" || capability.mode === "image-to-video") {
    errors.push({ field: fields.sourceImage ?? "$source", code: "source-required" });
  }

  const references = args.references ?? [];
  if (references.length > 0) {
    if (fields.referenceImages) {
      inputs[fields.referenceImages] = references.map(({ tokenId }) => tokenId);
    } else {
      errors.push({ field: "$references", code: "references-unsupported" });
    }
  }

  if (capability.accepts.referenceImages) {
    const count = references.length;
    if (count < capability.accepts.referenceImages.min) {
      errors.push({
        field: fields.referenceImages ?? "$references",
        code: "below-min-references",
      });
    }
    if (count > capability.accepts.referenceImages.max) {
      errors.push({
        field: fields.referenceImages ?? "$references",
        code: "above-max-references",
      });
    }
  }

  if (args.audio) {
    if (fields.audio) {
      inputs[fields.audio] = args.audio.tokenId;
    } else {
      errors.push({ field: "$audio", code: "audio-unsupported" });
    }
  }

  for (const required of schema.required ?? []) {
    if (!(required in inputs)) {
      errors.push({ field: required, code: "required" });
    }
  }

  errors.push(
    ...validateSharedWaveSpeedProviderInputs({
      schema,
      inputs,
      includeRequired: false,
    }),
  );

  return { inputs, errors };
}
