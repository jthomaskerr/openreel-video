import type {
  GenerationContext,
  GenerationError,
  GenerationJob,
  GenerationProvider,
  GenerationReferenceOrigin,
  GenerationRouteIdentity,
  GenerationTarget,
} from "@openreel/music-video-domain/generation";
import { GenerationRouteIdentitySchema } from "@openreel/music-video-domain/generation";
import {
  clearGenerationSubmissionDraftCache,
  createGenerationSubmissionRetryableDraft,
  generationSubmissionDraftCache,
  type GenerationSubmissionDraftCacheEntry,
  type GenerationSubmissionDraftCachePort,
} from "./drafts/cache";
import {
  assertNoLocalSubmissionUrls,
  applyGenerationReferenceCommand,
  buildImmutableGenerationSubmissionDraft,
  buildGenerationSubmissionContext,
  generationSubmissionDraftKey,
  normalizeProviderNeutralInputs,
  ProviderNeutralInputError,
  type GenerationReferenceRecoveryPorts,
  type GenerationReferenceRecoveryState,
} from "./drafts/v2";

export interface GenerationDraft {
  projectId: string;
  provider: GenerationProvider;
  providerInstanceId: string;
  routing: GenerationRouteIdentity;
  modelId: string;
  modelSchemaVersion: string;
  canonicalPrompt?: string;
  target: { kind: "new-asset" | "new-version"; sourceMediaId?: string };
  context: Omit<GenerationContext, "target"> & { target?: never };
  providerInputs: Record<string, unknown>;
  references?: readonly GenerationReferenceDraft[];
  audio?: GenerationAudioDraft;
  placementPolicy?: GenerationContext["placementPolicy"];
  referenceOverflowAcknowledged?: boolean;
  idempotencyKey?: string;
}

export interface GenerationReferenceDraft {
  key?: string;
  mediaId: string;
  mediaVersionId?: string;
  versionId?: string;
  role?: string;
  order?: number;
  origins?: readonly GenerationReferenceOrigin[];
  canonicalTokens?: readonly string[];
  status?: "active" | "unresolved" | "ambiguous" | "unavailable" | "unsupported" | "overflow" | "cyclic";
  reason?: string;
  value?: unknown;
}

export interface GenerationAudioDraft {
  value?: unknown;
  sourceMediaId?: string;
  sourceVersionId?: string;
  sourceClipId?: string;
  projectStartSeconds?: number;
  projectEndSeconds?: number;
  sourceStartSeconds?: number;
  sourceEndSeconds?: number;
  mimeType?: string;
  sha256?: string;
}

export interface PlaceholderInput {
  projectId: string;
  target: GenerationTarget;
  sourceMediaId?: string;
}

export interface GenerationMutationPort {
  createPlaceholder(input: PlaceholderInput): Promise<{ mediaId?: string; placeholderMediaId?: string } | string>;
  markPlaceholderFailed(input: {
    projectId: string;
    placeholderMediaId: string;
    error: GenerationError;
  }): Promise<void>;
}

export interface ReferenceUploadPort {
  uploadReference(input: GenerationReferenceDraft): Promise<{ tokenId: string }>;
}

export interface AudioUploadPort {
  uploadAudio(input: GenerationAudioDraft): Promise<{ tokenId: string }>;
}

export interface GenerationSanitizerPort {
  sanitize(input: {
    draft: GenerationDraft;
    source?: { tokenId: string };
    references: readonly { tokenId: string }[];
    audio?: { tokenId: string };
  }): { inputs: Record<string, unknown>; errors?: readonly { field: string; code: string }[] };
}

export interface ProviderSubmitPort {
  submit(input: {
    provider: GenerationProvider;
    providerInstanceId: string;
    modelId: string;
    modelSchemaVersion: string;
    routing: GenerationRouteIdentity;
    inputs: Record<string, unknown>;
    context: GenerationContext;
    references?: ReadonlyArray<{
      key: string;
      mediaId: string;
      mediaVersionId: string;
      origins: readonly GenerationReferenceOrigin[];
      role: string;
      canonicalTokens: readonly string[];
      order: number;
      status: "active";
      remoteInput: { kind: "upload-token"; value: string };
    }>;
    idempotencyKey: string;
  }): Promise<{ providerJobId: string }>;
}

export interface GenerationJobCachePort {
  put(job: GenerationJob): Promise<void>;
}

export interface GenerationClock {
  now(): number;
}

export interface GenerationIdFactory {
  next(prefix: string): string;
}

export interface SubmitGenerationPorts {
  mutations: GenerationMutationPort;
  references?: ReferenceUploadPort;
  audio?: AudioUploadPort;
  sanitizer?: GenerationSanitizerPort;
  provider: ProviderSubmitPort;
  cache: GenerationJobCachePort;
  draftCache?: GenerationSubmissionDraftCachePort;
  clock: GenerationClock;
  ids: GenerationIdFactory;
}

export async function recoverGenerationReference(input: {
  state: GenerationReferenceRecoveryState;
  command: unknown;
  ports: GenerationReferenceRecoveryPorts;
}): Promise<GenerationReferenceRecoveryState> {
  return applyGenerationReferenceCommand(input.state, input.command, input.ports);
}

export class GenerationSubmissionError extends Error {
  readonly code: string;
  readonly field?: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, field?: string, retryable = false) {
    super(message);
    this.name = "GenerationSubmissionError";
    this.code = code;
    this.field = field;
    this.retryable = retryable;
  }
}

const inflight = new Map<string, Promise<GenerationJob>>();

const errorFor = (stage: string, cause: unknown, field?: string): GenerationError => ({
  code: `generation-${stage}-failed`,
  message: cause instanceof Error ? cause.message : String(cause),
  field,
  retryable: true,
});

function validateDraft(draft: GenerationDraft): void {
  if (!draft.projectId) throw new GenerationSubmissionError("invalid-draft", "Project is required", "projectId");
  if (!draft.provider) throw new GenerationSubmissionError("invalid-draft", "Provider is required", "provider");
  if (!draft.modelId) throw new GenerationSubmissionError("invalid-draft", "Model is required", "modelId");
  if (!draft.modelSchemaVersion) {
    throw new GenerationSubmissionError("invalid-draft", "Model schema version is required", "modelSchemaVersion");
  }
  if (!(draft.provider === "kieai" || draft.provider === "wavespeed" || draft.provider === "atlascloud")) {
    throw new GenerationSubmissionError("invalid-draft", "Provider is unsupported", "provider");
  }
  const route = GenerationRouteIdentitySchema.safeParse(draft.routing);
  if (!route.success) {
    throw new GenerationSubmissionError("invalid-draft", "Routing identity is invalid", "routing");
  }
  if (route.data.providerInstanceId !== draft.providerInstanceId) {
    throw new GenerationSubmissionError(
      "invalid-draft",
      "Routing provider instance must match draft",
      "routing.providerInstanceId",
    );
  }
  if (route.data.providerModelId !== draft.modelId) {
    throw new GenerationSubmissionError(
      "invalid-draft",
      "Routing provider model must match draft",
      "routing.providerModelId",
    );
  }
  if (route.data.providerSchemaVersion !== draft.modelSchemaVersion) {
    throw new GenerationSubmissionError(
      "invalid-draft",
      "Routing schema version must match draft",
      "routing.providerSchemaVersion",
    );
  }
  if (route.data.requestedMode !== draft.context.mode) {
    throw new GenerationSubmissionError(
      "invalid-draft",
      "Routing requested mode must match context mode",
      "routing.requestedMode",
    );
  }
  if (draft.context.projectId !== draft.projectId) {
    throw new GenerationSubmissionError("invalid-draft", "Context project must match draft project", "context.projectId");
  }
  if (draft.context.target !== undefined) {
    throw new GenerationSubmissionError("invalid-draft", "Context target must stay implicit in the draft", "context.target");
  }
  if (draft.target.kind === "new-version" && !draft.target.sourceMediaId) {
    throw new GenerationSubmissionError("invalid-draft", "Source media is required", "target.sourceMediaId");
  }
  if (draft.target.kind === "new-asset" && draft.target.sourceMediaId !== undefined) {
    throw new GenerationSubmissionError("invalid-draft", "New asset targets cannot carry a source media id", "target.sourceMediaId");
  }
  if (!draft.providerInputs || typeof draft.providerInputs !== "object" || Array.isArray(draft.providerInputs)) {
    throw new GenerationSubmissionError("invalid-draft", "Inputs are required", "providerInputs");
  }
  try {
    normalizeProviderNeutralInputs(draft.providerInputs);
  } catch (cause) {
    if (cause instanceof ProviderNeutralInputError) {
      throw new GenerationSubmissionError(
        "invalid-draft",
        "Provider inputs must contain only provider-neutral values",
        cause.path,
      );
    }
    throw cause;
  }
  for (const [index, reference] of (draft.references ?? []).entries()) {
    if (!reference || typeof reference !== "object") {
      throw new GenerationSubmissionError("invalid-draft", "Reference is required", `references.${index}`);
    }
    if (!reference.mediaId) {
      throw new GenerationSubmissionError("invalid-draft", "Reference media is required", `references.${index}.mediaId`);
    }
    const status = reference.status ?? "active";
    if (status === "overflow" && !draft.referenceOverflowAcknowledged) {
      throw new GenerationSubmissionError(
        "invalid-draft",
        "Reference overflow requires acknowledgement",
        "references",
      );
    }
    if (status === "cyclic") {
      throw new GenerationSubmissionError(
        "invalid-draft",
        reference.reason ?? "Reference cycles are not allowed",
        `references.${index}.status`,
      );
    }
    if (status !== "active" && status !== "overflow") {
      throw new GenerationSubmissionError(
        "invalid-draft",
        reference.reason ?? "Only active references can be submitted",
        `references.${index}.status`,
      );
    }
  }
  if (draft.audio) {
    const requiredAudioFields: Array<[keyof GenerationAudioDraft, string]> = [
      ["sourceMediaId", "audio.sourceMediaId"],
      ["sourceVersionId", "audio.sourceVersionId"],
      ["sourceClipId", "audio.sourceClipId"],
      ["projectStartSeconds", "audio.projectStartSeconds"],
      ["projectEndSeconds", "audio.projectEndSeconds"],
      ["sourceStartSeconds", "audio.sourceStartSeconds"],
      ["sourceEndSeconds", "audio.sourceEndSeconds"],
      ["mimeType", "audio.mimeType"],
      ["sha256", "audio.sha256"],
    ];
    for (const [field, path] of requiredAudioFields) {
      const value = draft.audio[field];
      if (value === undefined || value === null || value === "") {
        throw new GenerationSubmissionError("invalid-draft", "Audio draft is incomplete", path);
      }
    }
  }
}

function normalizeReferenceDraft(
  reference: GenerationReferenceDraft,
  index: number,
): Required<Pick<GenerationReferenceDraft, "mediaId">> & {
  key: string;
  mediaVersionId: string;
  role: string;
  order: number;
  origins: readonly GenerationReferenceOrigin[];
  canonicalTokens: readonly string[];
  status: NonNullable<GenerationReferenceDraft["status"]>;
  reason?: string;
  value?: unknown;
} {
  const mediaVersionId = reference.mediaVersionId ?? reference.versionId ?? reference.mediaId;
  const key = reference.key ?? `reference:${mediaVersionId}`;
  return {
    key,
    mediaId: reference.mediaId,
    mediaVersionId,
    role: reference.role ?? "reference-images",
    order: reference.order ?? index,
    origins: reference.origins ?? ["user"],
    canonicalTokens: reference.canonicalTokens ?? [`@{${key}}`],
    status: reference.status ?? "active",
    ...(reference.reason ? { reason: reference.reason } : {}),
    ...(reference.value === undefined ? {} : { value: reference.value }),
  };
}

function activeSubmissionReferences(draft: GenerationDraft) {
  return (draft.references ?? [])
    .map((reference, index) => normalizeReferenceDraft(reference, index))
    .filter((reference) => reference.status === "active")
    .sort((left, right) => left.order - right.order || left.key.localeCompare(right.key));
}

function extractPlaceholderMediaId(
  result: { mediaId?: string; placeholderMediaId?: string } | string,
  fallback: string,
): string {
  if (typeof result === "string") return result || fallback;
  return result.placeholderMediaId ?? result.mediaId ?? fallback;
}

async function markPlaceholderFailed(
  ports: SubmitGenerationPorts,
  projectId: string,
  placeholderMediaId: string,
  error: GenerationError,
): Promise<void> {
  await ports.mutations.markPlaceholderFailed({ projectId, placeholderMediaId, error });
}

async function stageRetryableDraft(
  ports: SubmitGenerationPorts,
  entry: GenerationSubmissionDraftCacheEntry,
): Promise<void> {
  const cache = ports.draftCache ?? generationSubmissionDraftCache;
  await cache.stagePending(entry);
}

async function failSubmission(
  ports: SubmitGenerationPorts,
  input: {
    draft: GenerationDraft;
    stage: string;
    cause: unknown;
    placeholderMediaId: string;
    retryableDraft: GenerationSubmissionDraftCacheEntry;
    field?: string;
  },
): Promise<never> {
  const error = errorFor(input.stage, input.cause, input.field);
  const cache = ports.draftCache ?? generationSubmissionDraftCache;
  await Promise.allSettled([
    markPlaceholderFailed(ports, input.draft.projectId, input.placeholderMediaId, error),
    cache.markFailed({
      key: input.retryableDraft.key,
      error,
      updatedAt: ports.clock.now(),
    }),
  ]);
  throw error;
}

function buildJob(
  draft: GenerationDraft,
  providerJobId: string,
  context: GenerationContext,
  inputs: Record<string, unknown>,
  ids: GenerationIdFactory,
  clock: GenerationClock,
): GenerationJob {
  const now = clock.now();
  return {
    schemaVersion: 2,
    contractVersion: 2,
    id: ids.next("job"),
    projectId: draft.projectId,
    provider: draft.provider,
    providerInstanceId: draft.providerInstanceId,
    modelId: draft.modelId,
    modelSchemaVersion: draft.modelSchemaVersion,
    routing: draft.routing,
    providerJobId,
    status: "submitting",
    attempt: 1,
    createdAt: now,
    updatedAt: now,
    context,
    providerInputs: inputs as GenerationJob["providerInputs"],
    attempts: [{ attemptNumber: 1, routing: draft.routing, providerJobId, startedAt: now }],
    checkpoints: {},
  };
}

export async function submitGeneration(draft: GenerationDraft, ports: SubmitGenerationPorts): Promise<GenerationJob> {
  validateDraft(draft);
  const snapshot = buildImmutableGenerationSubmissionDraft({
    ...draft,
    references: activeSubmissionReferences(draft),
  });
  const submissionKey = generationSubmissionDraftKey({
    projectId: snapshot.projectId,
    provider: snapshot.provider,
    providerInstanceId: snapshot.providerInstanceId,
    routing: snapshot.routing,
    modelId: snapshot.modelId,
    modelSchemaVersion: snapshot.modelSchemaVersion,
    target: snapshot.target.kind === "new-version"
      ? {
          kind: "new-version",
          sourceMediaId: snapshot.target.sourceMediaId ?? "",
          placeholderMediaId: "__submission__",
        }
      : { kind: "new-asset", placeholderMediaId: "__submission__" },
    context: snapshot.context,
    providerInputs: snapshot.providerInputs,
    canonicalPrompt: snapshot.canonicalPrompt,
    references: snapshot.references,
    audio: snapshot.audio,
    placementPolicy: snapshot.placementPolicy ?? snapshot.context.placementPolicy,
    referenceOverflowAcknowledged: snapshot.referenceOverflowAcknowledged,
    idempotencyKey: snapshot.idempotencyKey,
  });
  const existing = inflight.get(submissionKey);
  if (existing) return existing;

  const operation = executeSubmission(snapshot, ports, submissionKey);
  inflight.set(submissionKey, operation);
  void operation
    .finally(() => {
      if (inflight.get(submissionKey) === operation) inflight.delete(submissionKey);
    })
    .catch(() => undefined);
  return operation;
}

async function executeSubmission(
  snapshot: GenerationDraft,
  ports: SubmitGenerationPorts,
  submissionKey: string,
): Promise<GenerationJob> {
  const draftCache = ports.draftCache ?? generationSubmissionDraftCache;
  const cachedDraft = draftCache.get(submissionKey);
  const placeholderMediaId = cachedDraft?.placeholderMediaId ?? ports.ids.next("placeholder");
  const target: GenerationTarget =
    snapshot.target.kind === "new-version"
      ? { kind: "new-version", sourceMediaId: snapshot.target.sourceMediaId!, placeholderMediaId }
      : { kind: "new-asset", placeholderMediaId };
  const orderedReferences = activeSubmissionReferences(snapshot);
  const exactPlaceholderMediaId = cachedDraft
    ? cachedDraft.placeholderMediaId
    : extractPlaceholderMediaId(
        await ports.mutations.createPlaceholder({
          projectId: snapshot.projectId,
          target,
          sourceMediaId: snapshot.target.sourceMediaId,
        }),
        placeholderMediaId,
      );
  const retryableDraft = createGenerationSubmissionRetryableDraft({
    draft: snapshot,
    placeholderMediaId: exactPlaceholderMediaId,
    updatedAt: ports.clock.now(),
    key: submissionKey,
  });

  let referenceTokens: readonly { tokenId: string }[] = [];
  try {
    await stageRetryableDraft(ports, retryableDraft);
    if (orderedReferences.length) {
      if (!ports.references) {
        throw new GenerationSubmissionError("reference-upload-unavailable", "Reference upload is unavailable", "references");
      }
      const uploaded: { tokenId: string }[] = [];
      for (const reference of orderedReferences) {
        uploaded.push(await ports.references.uploadReference(reference));
      }
      referenceTokens = uploaded;
    }
  } catch (cause) {
    return failSubmission(ports, {
      draft: snapshot,
      stage: "reference-upload",
      cause,
      placeholderMediaId: exactPlaceholderMediaId,
      retryableDraft,
      field: "references",
    });
  }

  let audioToken: { tokenId: string } | undefined;
  try {
    if (snapshot.audio) {
      if (!ports.audio) {
        throw new GenerationSubmissionError("audio-upload-unavailable", "Audio upload is unavailable", "audio");
      }
      audioToken = await ports.audio.uploadAudio(snapshot.audio);
    }
  } catch (cause) {
    return failSubmission(ports, {
      draft: snapshot,
      stage: "audio-upload",
      cause,
      placeholderMediaId: exactPlaceholderMediaId,
      retryableDraft,
      field: "audio",
    });
  }

  let sanitizedInputs: Record<string, unknown>;
  try {
    const sanitized = ports.sanitizer?.sanitize({
      draft: snapshot,
      references: referenceTokens,
      audio: audioToken,
    });
    sanitizedInputs = sanitized?.inputs ?? { ...snapshot.providerInputs };
    if ((sanitized?.errors ?? []).length) {
      const [firstError] = sanitized!.errors!;
      throw new GenerationSubmissionError("invalid-input", "Provider inputs are invalid", firstError.field, false);
    }
    assertNoLocalSubmissionUrls(sanitizedInputs, "providerInputs");
  } catch (cause) {
    return failSubmission(ports, {
      draft: snapshot,
      stage: "sanitize",
      cause,
      placeholderMediaId: exactPlaceholderMediaId,
      retryableDraft,
      field: "providerInputs",
    });
  }

  const context = buildGenerationSubmissionContext({
    draft: snapshot,
    referenceTokens,
    audioToken,
    preparationStatus: "ready",
  });
  assertNoLocalSubmissionUrls(context, "context");
  const submittedReferences = orderedReferences.map((reference, index) => ({
    key: reference.key,
    mediaId: reference.mediaId,
    mediaVersionId: reference.mediaVersionId,
    origins: reference.origins,
    role: reference.role,
    canonicalTokens: reference.canonicalTokens,
    order: reference.order,
    status: "active" as const,
    remoteInput: { kind: "upload-token" as const, value: referenceTokens[index]?.tokenId ?? "" },
  }));

  let providerSubmit: { providerJobId: string };
  try {
    providerSubmit = await ports.provider.submit({
      provider: snapshot.provider,
      providerInstanceId: snapshot.providerInstanceId,
      modelId: snapshot.modelId,
      modelSchemaVersion: snapshot.modelSchemaVersion,
      routing: snapshot.routing,
      inputs: sanitizedInputs,
      context,
      ...(submittedReferences.length ? { references: submittedReferences } : {}),
      idempotencyKey: snapshot.idempotencyKey ?? submissionKey,
    });
  } catch (cause) {
    return failSubmission(ports, {
      draft: snapshot,
      stage: "submit",
      cause,
      placeholderMediaId: exactPlaceholderMediaId,
      retryableDraft,
      field: "provider",
    });
  }

  const job = buildJob(snapshot, providerSubmit.providerJobId, context, sanitizedInputs, ports.ids, ports.clock);

  try {
    await ports.cache.put(job);
    await (ports.draftCache ?? generationSubmissionDraftCache).clear(submissionKey);
    return job;
  } catch (cause) {
    return failSubmission(ports, {
      draft: snapshot,
      stage: "cache",
      cause,
      placeholderMediaId: exactPlaceholderMediaId,
      retryableDraft,
      field: "cache",
    });
  }
}

export function clearGenerationSubmissionInflight(): void {
  inflight.clear();
  clearGenerationSubmissionDraftCache();
}
