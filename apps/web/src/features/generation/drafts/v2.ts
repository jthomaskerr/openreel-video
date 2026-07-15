import type { GenerationContext, GenerationTarget } from "@openreel/music-video-domain/generation";
import type { GenerationDraft } from "../submit-generation";

function stableValue(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableValue(entry)}`)
      .join(",")}}`;
  }
  throw new TypeError(`Unsupported submission value: ${typeof value}`);
}

export function stableSubmissionStringify(value: unknown): string {
  return stableValue(value);
}

export function isLocalSubmissionUrl(value: string): boolean {
  if (/^(blob:|file:)/i.test(value)) return true;
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function assertNoLocalSubmissionUrls(value: unknown, path = "value"): void {
  if (typeof value === "string") {
    if (isLocalSubmissionUrl(value)) throw new Error(`Local submission URL at ${path}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoLocalSubmissionUrls(entry, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      assertNoLocalSubmissionUrls(entry, `${path}.${key}`);
    }
  }
}

export function generationSubmissionDraftKey(input: {
  projectId: string;
  provider: string;
  modelId: string;
  modelSchemaVersion: string;
  target: GenerationTarget;
  context: Omit<GenerationContext, "target"> & { target?: never };
  providerInputs: Record<string, unknown>;
  references?: GenerationDraft["references"];
  audio?: GenerationDraft["audio"];
  placementPolicy?: GenerationContext["placementPolicy"];
  idempotencyKey?: string;
}): string {
  return input.idempotencyKey ?? stableSubmissionStringify({
    projectId: input.projectId,
    provider: input.provider,
    modelId: input.modelId,
    modelSchemaVersion: input.modelSchemaVersion,
    target: input.target,
    context: input.context,
    providerInputs: input.providerInputs,
    references: input.references,
    audio: input.audio,
    placementPolicy: input.placementPolicy ?? input.context.placementPolicy,
  });
}

function required<T>(value: T | undefined, field: string): T {
  if (value === undefined || value === "") throw new Error(`Missing resolved audio field: ${field}`);
  return value;
}

export function buildGenerationSubmissionContext(input: {
  draft: GenerationDraft;
  target: GenerationTarget;
  referenceTokens: readonly { tokenId: string }[];
  audioToken?: { tokenId: string };
}): GenerationContext {
  const references = (input.draft.references ?? []).map((reference, index) => {
    const token = required(input.referenceTokens[index]?.tokenId, `references[${index}]`);
    return {
      mediaId: reference.mediaId,
      ...(reference.versionId ? { versionId: reference.versionId } : {}),
      origins: reference.origins ?? ["user" as const],
      remoteInput: { kind: "upload-token" as const, value: token },
    };
  });
  const audio = input.draft.audio && input.audioToken
    ? {
        sourceMediaId: required(input.draft.audio.sourceMediaId, "sourceMediaId"),
        sourceVersionId: required(input.draft.audio.sourceVersionId, "sourceVersionId"),
        sourceClipId: required(input.draft.audio.sourceClipId, "sourceClipId"),
        projectStartSeconds: required(input.draft.audio.projectStartSeconds, "projectStartSeconds"),
        projectEndSeconds: required(input.draft.audio.projectEndSeconds, "projectEndSeconds"),
        sourceStartSeconds: required(input.draft.audio.sourceStartSeconds, "sourceStartSeconds"),
        sourceEndSeconds: required(input.draft.audio.sourceEndSeconds, "sourceEndSeconds"),
        mimeType: required(input.draft.audio.mimeType, "mimeType"),
        sha256: required(input.draft.audio.sha256, "sha256"),
        remoteInput: { kind: "upload-token" as const, value: input.audioToken.tokenId },
      }
    : undefined;
  return {
    projectId: input.draft.projectId,
    shotId: input.draft.context.shotId,
    clipId: input.draft.context.clipId,
    target: input.target,
    timing: input.draft.context.timing,
    references,
    ...(audio ? { audio } : {}),
    placementPolicy: input.draft.placementPolicy ?? input.draft.context.placementPolicy,
  };
}
