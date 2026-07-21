import { z } from "zod";
import type {
  GenerationContext,
  GenerationError,
  GenerationTarget,
} from "@openreel/music-video-domain/generation";
import {
  GenerationContextSchema,
  GenerationReferenceDeactivateCommandSchema,
  GenerationReferenceRemoveCommandSchema,
  GenerationReferenceRetryCommandSchema,
  ResolvedGenerationReferenceSchema,
} from "@openreel/music-video-domain/generation";
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
  providerInstanceId: string;
  routing: import("@openreel/music-video-domain/generation").GenerationRouteIdentity;
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
    providerInstanceId: input.providerInstanceId,
    routing: input.routing,
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
  referenceTokens: readonly { tokenId: string }[];
  audioToken?: { tokenId: string };
  preparationStatus?: "preparing" | "ready";
}): GenerationContext {
  const preparationStatus = input.preparationStatus ?? "preparing";
  const references = (input.draft.references ?? []).map((reference, index) => {
    const token = required(input.referenceTokens[index]?.tokenId, `references[${index}]`);
    const versionId = reference.mediaVersionId ?? reference.versionId;
    return {
      id: versionId ? `${reference.mediaId}:${versionId}` : reference.mediaId,
      order: index + 1,
      mediaId: reference.mediaId,
      ...(versionId ? { versionId } : {}),
      origins: reference.origins ?? ["user" as const],
      state: "active" as const,
      preparationStatus,
      errorHistory: [],
      uploadLeaseId: token,
    };
  });

  return GenerationContextSchema.parse({
    ...input.draft.context,
    projectId: input.draft.projectId,
    references,
    placementPolicy: input.draft.placementPolicy ?? input.draft.context.placementPolicy,
  }) as GenerationContext;
}

export interface GenerationReferenceRecoveryDraft {
  id: string;
  mediaId: string;
  versionId?: string;
  origins?: GenerationReferenceOrigin[];
  value?: unknown;
}

export type GenerationReferenceOrigin = "source" | "character" | "shot" | "user";

export interface GenerationReferenceCanonical {
  id: string;
  order: number;
  mediaId: string;
  versionId?: string;
  origins: GenerationReferenceOrigin[];
  state: "active" | "failed";
  preparationStatus: "preparing" | "ready" | "failed";
  errorHistory: GenerationError[];
  uploadLeaseId?: string;
}

export type GenerationReferenceRecoveryReference = GenerationReferenceCanonical & {
  active: boolean;
};

const GenerationReferenceCommandSchema = z.discriminatedUnion("action", [
  GenerationReferenceRetryCommandSchema.extend({ action: z.literal("retry") }),
  GenerationReferenceRemoveCommandSchema.extend({ action: z.literal("remove") }),
  GenerationReferenceDeactivateCommandSchema.extend({ action: z.literal("deactivate") }),
]);

export type GenerationReferenceCommand = z.infer<typeof GenerationReferenceCommandSchema>;

export interface GenerationReferenceRecoveryState {
  projectId: string;
  jobId: string;
  references: readonly GenerationReferenceRecoveryReference[];
  drafts: readonly GenerationReferenceRecoveryDraft[];
  providerReferences: readonly GenerationReferenceCanonical[];
}

export interface GenerationReferenceRecoveryPorts {
  retryReference(input: GenerationReferenceRecoveryDraft): Promise<{ tokenId: string }>;
  releaseUploadLease(input: { tokenId: string }): Promise<void>;
  referenceMinimum?: number;
}

export class GenerationReferenceRecoveryScopeError extends Error {
  readonly code = "generation-reference-recovery-scope-mismatch";

  constructor(readonly projectId: string, readonly jobId: string) {
    super(`Reference recovery command is scoped to ${projectId}/${jobId}`);
    this.name = "GenerationReferenceRecoveryScopeError";
  }
}

export class GenerationReferenceRecoveryError extends Error {
  readonly code: "generation-reference-release-failed" | "generation-reference-release-cleanup-failed";
  readonly field: string;
  readonly referenceId: string;
  readonly state: GenerationReferenceRecoveryState;
  readonly newLeaseId: string;

  constructor(
    referenceId: string,
    newLeaseId: string,
    state: GenerationReferenceRecoveryState,
    cause: unknown,
    code: GenerationReferenceRecoveryError["code"] = "generation-reference-release-failed",
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "GenerationReferenceRecoveryError";
    this.field = `references.${referenceId}.uploadLeaseId`;
    this.referenceId = referenceId;
    this.state = state;
    this.newLeaseId = newLeaseId;
    this.code = code;
  }
}

const generationReferenceCollectionSchema = z.array(ResolvedGenerationReferenceSchema);

export function parseGenerationReferenceCommand(value: unknown): GenerationReferenceCommand {
  return GenerationReferenceCommandSchema.parse(value) as GenerationReferenceCommand;
}

export function parseGenerationReferencePreparation(value: unknown): GenerationReferenceCanonical[] {
  return generationReferenceCollectionSchema.parse(value) as GenerationReferenceCanonical[];
}

export function validateGenerationReferenceMinimum<T extends { active: boolean }>(
  references: readonly T[],
  minimum: number | undefined,
): void {
  if (minimum !== undefined && references.filter((reference) => reference.active).length < minimum) {
    throw new Error("generation-reference-required");
  }
}

function providerReferences(
  references: readonly GenerationReferenceRecoveryReference[],
): GenerationReferenceCanonical[] {
  return references
    .filter((reference) =>
      reference.active && reference.state === "active" && reference.preparationStatus === "ready")
    .map(({ active: _active, ...reference }, index) => ({ ...reference, order: index + 1 }));
}

function withProviderReferences(
  references: readonly GenerationReferenceRecoveryReference[],
  drafts: readonly GenerationReferenceRecoveryDraft[],
  scope: Pick<GenerationReferenceRecoveryState, "projectId" | "jobId">,
): GenerationReferenceRecoveryState {
  return {
    projectId: scope.projectId,
    jobId: scope.jobId,
    references,
    drafts,
    providerReferences: providerReferences(references),
  };
}

export function createGenerationReferenceRecoveryState(input: {
  projectId: string;
  jobId: string;
  references: readonly (Omit<GenerationReferenceRecoveryReference, "active"> & { active?: boolean })[];
  drafts: readonly GenerationReferenceRecoveryDraft[];
}): GenerationReferenceRecoveryState {
  const references = input.references.map((reference) => ({
    ...reference,
    active: reference.active ?? true,
  }));
  return withProviderReferences(references, input.drafts, input);
}

function recoveryError(
  cause: unknown,
  field: string,
  code = "generation-reference-retry-failed",
): GenerationError {
  return {
    code,
    message: cause instanceof Error ? cause.message : String(cause),
    field,
    retryable: true,
  };
}

function leaseIsReferenced(
  references: readonly GenerationReferenceRecoveryReference[],
  tokenId: string,
  exceptId?: string,
): boolean {
  return references.some((reference) =>
    reference.id !== exceptId && reference.uploadLeaseId === tokenId);
}

export async function applyGenerationReferenceCommand(
  state: GenerationReferenceRecoveryState,
  commandInput: unknown,
  ports: GenerationReferenceRecoveryPorts,
): Promise<GenerationReferenceRecoveryState> {
  const command = parseGenerationReferenceCommand(commandInput);
  if (command.projectId !== state.projectId || command.jobId !== state.jobId) {
    throw new GenerationReferenceRecoveryScopeError(command.projectId, command.jobId);
  }
  const index = state.references.findIndex((reference) => reference.id === command.referenceId);
  if (index < 0) throw new Error("generation-reference-not-found");
  const reference = state.references[index];

  if (command.action === "remove") {
    const references = state.references.filter((candidate) => candidate.id !== command.referenceId);
    validateGenerationReferenceMinimum(references, ports.referenceMinimum);
    if (reference.uploadLeaseId && !leaseIsReferenced(references, reference.uploadLeaseId)) {
      await ports.releaseUploadLease({ tokenId: reference.uploadLeaseId });
    }
    return withProviderReferences(
      references,
      state.drafts.filter((draft) => draft.id !== command.referenceId),
      state,
    );
  }

  if (command.action === "deactivate") {
    const references = state.references.map((candidate) =>
      candidate.id === command.referenceId ? { ...candidate, active: false } : candidate);
    validateGenerationReferenceMinimum(references, ports.referenceMinimum);
    return withProviderReferences(references, state.drafts, state);
  }

  if (reference.active && reference.state === "active" && reference.preparationStatus === "ready") {
    return state;
  }

  const draft = state.drafts.find((candidate) => candidate.id === command.referenceId);
  if (!draft) throw new Error("generation-reference-draft-not-found");

  let uploaded: { tokenId: string };
  try {
    uploaded = await ports.retryReference(draft);
  } catch (cause) {
    const error = recoveryError(cause, `references.${command.referenceId}.value`);
    const references = state.references.map((candidate) =>
      candidate.id === command.referenceId
        ? {
            ...candidate,
            state: "failed" as const,
            preparationStatus: "failed" as const,
            errorHistory: [...candidate.errorHistory, error],
          }
        : candidate);
    return withProviderReferences(references, state.drafts, state);
  }

  const references = state.references.map((candidate) =>
    candidate.id === command.referenceId
      ? {
          ...candidate,
          active: true,
          state: "active" as const,
          preparationStatus: "ready" as const,
          uploadLeaseId: uploaded.tokenId,
        }
      : candidate);
  if (
    reference.uploadLeaseId
    && reference.uploadLeaseId !== uploaded.tokenId
    && !leaseIsReferenced(references, reference.uploadLeaseId, command.referenceId)
  ) {
    try {
      await ports.releaseUploadLease({ tokenId: reference.uploadLeaseId });
    } catch (cause) {
      try {
        await ports.releaseUploadLease({ tokenId: uploaded.tokenId });
      } catch (cleanupCause) {
        const error = recoveryError(
          cleanupCause,
          `references.${command.referenceId}.uploadLeaseId`,
          "generation-reference-release-cleanup-failed",
        );
        const failedReferences = references.map((candidate) =>
          candidate.id === command.referenceId
            ? {
                ...candidate,
                preparationStatus: "failed" as const,
                errorHistory: [...candidate.errorHistory, error],
              }
            : candidate);
        throw new GenerationReferenceRecoveryError(
          command.referenceId,
          uploaded.tokenId,
          withProviderReferences(failedReferences, state.drafts, state),
          cleanupCause,
          "generation-reference-release-cleanup-failed",
        );
      }
      const error = recoveryError(
        cause,
        `references.${command.referenceId}.uploadLeaseId`,
        "generation-reference-release-failed",
      );
      const retainedReferences = state.references.map((candidate) =>
        candidate.id === command.referenceId
          ? { ...candidate, errorHistory: [...candidate.errorHistory, error] }
          : candidate);
      throw new GenerationReferenceRecoveryError(
        command.referenceId,
        uploaded.tokenId,
        withProviderReferences(retainedReferences, state.drafts, state),
        cause,
      );
    }
  }
  return withProviderReferences(references, state.drafts, state);
}
