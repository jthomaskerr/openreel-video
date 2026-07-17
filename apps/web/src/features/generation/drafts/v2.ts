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

const EXPIRING_TRANSPORT_QUERY_PARAMETERS = new Set([
  "expires",
  "key-pair-id",
  "se",
  "sig",
  "signature",
  "sv",
  "x-amz-algorithm",
  "x-amz-credential",
  "x-amz-date",
  "x-amz-expires",
  "x-amz-security-token",
  "x-amz-signature",
  "x-goog-algorithm",
  "x-goog-credential",
  "x-goog-date",
  "x-goog-expires",
  "x-goog-signature",
]);

const TRANSIENT_TRANSPORT_FIELD_NAMES = new Set([
  "bloburl",
  "downloadurl",
  "downloaduri",
  "expiresat",
  "expiresin",
  "expiration",
  "expiry",
  "fileurl",
  "localurl",
  "presignedurl",
  "signedurl",
  "uploadtoken",
  "uploadurl",
  "uploaduri",
]);

export class ProviderNeutralInputError extends TypeError {
  constructor(readonly path: string, reason: string) {
    super(`${reason} at ${path}`);
    this.name = "ProviderNeutralInputError";
  }
}

function isExpiringTransportUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return [...url.searchParams.keys()].some((key) =>
      EXPIRING_TRANSPORT_QUERY_PARAMETERS.has(key.toLowerCase()),
    );
  } catch {
    return false;
  }
}

function isTransientTransportFieldName(key: string): boolean {
  return TRANSIENT_TRANSPORT_FIELD_NAMES.has(key.replace(/[-_]/g, "").toLowerCase());
}

function normalizeProviderNeutralValue(
  value: unknown,
  path: string,
  ancestors: WeakSet<object>,
): unknown {
  if (value === undefined || value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ProviderNeutralInputError(path, "Provider-neutral numbers must be finite");
    }
    return value;
  }
  if (typeof value === "string") {
    if (isLocalSubmissionUrl(value) || isExpiringTransportUrl(value)) {
      throw new ProviderNeutralInputError(path, "Provider-neutral inputs cannot include transport URLs");
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      throw new ProviderNeutralInputError(path, "Provider-neutral inputs cannot be cyclic");
    }
    ancestors.add(value);
    const normalized = value.map((entry, index) =>
      normalizeProviderNeutralValue(entry, `${path}[${index}]`, ancestors),
    );
    ancestors.delete(value);
    return normalized;
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new ProviderNeutralInputError(path, "Provider-neutral inputs must use plain data objects");
    }
    if (ancestors.has(value)) {
      throw new ProviderNeutralInputError(path, "Provider-neutral inputs cannot be cyclic");
    }
    ancestors.add(value);
    const normalized: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      const entryPath = `${path}.${key}`;
      if (entry !== undefined && entry !== null && isTransientTransportFieldName(key)) {
        throw new ProviderNeutralInputError(entryPath, "Provider-neutral inputs cannot include transport fields");
      }
      normalized[key] = normalizeProviderNeutralValue(entry, entryPath, ancestors);
    }
    ancestors.delete(value);
    return normalized;
  }
  throw new ProviderNeutralInputError(path, `Unsupported provider-neutral value: ${typeof value}`);
}

export function normalizeProviderNeutralInputs(
  inputs: Record<string, unknown>,
  path = "providerInputs",
): Record<string, unknown> {
  return normalizeProviderNeutralValue(inputs, path, new WeakSet()) as Record<string, unknown>;
}

export function generationSubmissionDraftKey(input: {
  projectId: string;
  provider: string;
  modelId: string;
  modelSchemaVersion: string;
  target: GenerationTarget;
  context: Omit<GenerationContext, "target"> & { target?: never };
  providerInputs: Record<string, unknown>;
  canonicalPrompt?: string;
  references?: GenerationDraft["references"];
  audio?: GenerationDraft["audio"];
  placementPolicy?: GenerationContext["placementPolicy"];
  referenceOverflowAcknowledged?: boolean;
  idempotencyKey?: string;
}): string {
  const providerInputs = normalizeProviderNeutralInputs(input.providerInputs);
  return input.idempotencyKey ?? stableSubmissionStringify({
    projectId: input.projectId,
    provider: input.provider,
    modelId: input.modelId,
    modelSchemaVersion: input.modelSchemaVersion,
    target: input.target,
    context: input.context,
    providerInputs,
    canonicalPrompt: input.canonicalPrompt ?? String(input.providerInputs.prompt ?? ""),
    references: normalizeSubmissionReferences(input.references),
    audio: normalizeSubmissionAudio(input.audio),
    placementPolicy: input.placementPolicy ?? input.context.placementPolicy,
    referenceOverflowAcknowledged: input.referenceOverflowAcknowledged ?? false,
  });
}

function normalizeSubmissionReferences(
  references: GenerationDraft["references"],
): GenerationDraft["references"] {
  return references?.map((reference, index) => ({
    key: reference.key ?? `reference:${reference.mediaVersionId ?? reference.versionId ?? reference.mediaId}`,
    mediaId: reference.mediaId,
    mediaVersionId: reference.mediaVersionId ?? reference.versionId,
    role: reference.role ?? "reference-images",
    order: reference.order ?? index,
    ...(reference.origins ? { origins: reference.origins } : {}),
    ...(reference.canonicalTokens ? { canonicalTokens: reference.canonicalTokens } : {}),
    status: reference.status ?? "active",
    ...(reference.reason ? { reason: reference.reason } : {}),
  }))
    .slice()
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.key.localeCompare(right.key));
}

function normalizeSubmissionAudio(audio: GenerationDraft["audio"]): GenerationDraft["audio"] {
  if (!audio) return undefined;
  return {
    sourceMediaId: audio.sourceMediaId,
    sourceVersionId: audio.sourceVersionId,
    sourceClipId: audio.sourceClipId,
    projectStartSeconds: audio.projectStartSeconds,
    projectEndSeconds: audio.projectEndSeconds,
    sourceStartSeconds: audio.sourceStartSeconds,
    sourceEndSeconds: audio.sourceEndSeconds,
    mimeType: audio.mimeType,
    sha256: audio.sha256,
  };
}

export function buildImmutableGenerationSubmissionDraft(draft: GenerationDraft): GenerationDraft {
  const snapshot = structuredClone({
    ...draft,
    providerInputs: normalizeProviderNeutralInputs(draft.providerInputs),
  });
  return {
    ...snapshot,
    canonicalPrompt: snapshot.canonicalPrompt ?? String(snapshot.providerInputs.prompt ?? ""),
    providerInputs: snapshot.providerInputs,
    ...(snapshot.references ? { references: normalizeSubmissionReferences(snapshot.references) } : {}),
    ...(snapshot.audio ? { audio: normalizeSubmissionAudio(snapshot.audio) } : {}),
  };
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
      ...(reference.mediaVersionId ?? reference.versionId
        ? { versionId: reference.mediaVersionId ?? reference.versionId }
        : {}),
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
