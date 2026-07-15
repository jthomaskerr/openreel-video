import type {
  GenerationContext,
  GenerationError,
  GenerationJob,
  GenerationReferenceOrigin,
  GenerationTarget,
} from "@openreel/music-video-domain/generation";
import {
  clearGenerationSubmissionDraftCache,
  createGenerationSubmissionRetryableDraft,
  generationSubmissionDraftCache,
  type GenerationSubmissionDraftCacheEntry,
  type GenerationSubmissionDraftCachePort,
} from "./drafts/cache";
import {
  assertNoLocalSubmissionUrls,
  buildGenerationSubmissionContext,
  stableSubmissionStringify,
} from "./drafts/v2";

export interface GenerationDraft {
  projectId: string;
  provider: string;
  modelId: string;
  modelSchemaVersion: string;
  target: { kind: "new-asset" | "new-version"; sourceMediaId?: string };
  context: Omit<GenerationContext, "target"> & { target?: never };
  providerInputs: Record<string, unknown>;
  references?: readonly GenerationReferenceDraft[];
  audio?: GenerationAudioDraft;
  placementPolicy?: GenerationContext["placementPolicy"];
  idempotencyKey?: string;
}

export interface GenerationReferenceDraft {
  mediaId: string;
  versionId?: string;
  origins?: GenerationReferenceOrigin[];
  value?: unknown;
}

export interface GenerationAudioDraft {
  value: unknown;
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
    provider: string;
    modelId: string;
    modelSchemaVersion: string;
    inputs: Record<string, unknown>;
    context: GenerationContext;
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
  for (const [index, reference] of (draft.references ?? []).entries()) {
    if (!reference || typeof reference !== "object") {
      throw new GenerationSubmissionError("invalid-draft", "Reference is required", `references.${index}`);
    }
    if (!reference.mediaId) {
      throw new GenerationSubmissionError("invalid-draft", "Reference media is required", `references.${index}.mediaId`);
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
    id: ids.next("job"),
    provider: draft.provider,
    modelId: draft.modelId,
    modelSchemaVersion: draft.modelSchemaVersion,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    context,
    providerInputs: inputs as GenerationJob["providerInputs"],
    attempts: [{ attemptNumber: 1, providerJobId, startedAt: now }],
    checkpoints: {},
  };
}

export async function submitGeneration(draft: GenerationDraft, ports: SubmitGenerationPorts): Promise<GenerationJob> {
  validateDraft(draft);
  const submissionKey = draft.idempotencyKey ?? stableSubmissionStringify({
    projectId: draft.projectId,
    provider: draft.provider,
    modelId: draft.modelId,
    modelSchemaVersion: draft.modelSchemaVersion,
    target: draft.target,
    context: draft.context,
    providerInputs: draft.providerInputs,
    references: draft.references,
    audio: draft.audio,
    placementPolicy: draft.placementPolicy ?? draft.context.placementPolicy,
  });
  const existing = inflight.get(submissionKey);
  if (existing) return existing;

  const operation = executeSubmission(draft, ports, submissionKey);
  inflight.set(submissionKey, operation);
  void operation
    .finally(() => {
      if (inflight.get(submissionKey) === operation) inflight.delete(submissionKey);
    })
    .catch(() => undefined);
  return operation;
}

async function executeSubmission(
  draft: GenerationDraft,
  ports: SubmitGenerationPorts,
  submissionKey: string,
): Promise<GenerationJob> {
  const placeholderMediaId = ports.ids.next("placeholder");
  const target: GenerationTarget =
    draft.target.kind === "new-version"
      ? { kind: "new-version", sourceMediaId: draft.target.sourceMediaId!, placeholderMediaId }
      : { kind: "new-asset", placeholderMediaId };

  const placeholderResult = await ports.mutations.createPlaceholder({
    projectId: draft.projectId,
    target,
    sourceMediaId: draft.target.sourceMediaId,
  });
  const exactPlaceholderMediaId = extractPlaceholderMediaId(placeholderResult, placeholderMediaId);
  const retryableDraft = createGenerationSubmissionRetryableDraft({
    draft,
    placeholderMediaId: exactPlaceholderMediaId,
    updatedAt: ports.clock.now(),
    key: submissionKey,
  });

  let referenceTokens: readonly { tokenId: string }[] = [];
  try {
    await stageRetryableDraft(ports, retryableDraft);
    if (draft.references?.length) {
      if (!ports.references) {
        throw new GenerationSubmissionError("reference-upload-unavailable", "Reference upload is unavailable", "references");
      }
      const uploaded: { tokenId: string }[] = [];
      for (const reference of draft.references) {
        uploaded.push(await ports.references.uploadReference(reference));
      }
      referenceTokens = uploaded;
    }
  } catch (cause) {
    return failSubmission(ports, {
      draft,
      stage: "reference-upload",
      cause,
      placeholderMediaId: exactPlaceholderMediaId,
      retryableDraft,
      field: "references",
    });
  }

  let audioToken: { tokenId: string } | undefined;
  try {
    if (draft.audio) {
      if (!ports.audio) {
        throw new GenerationSubmissionError("audio-upload-unavailable", "Audio upload is unavailable", "audio");
      }
      audioToken = await ports.audio.uploadAudio(draft.audio);
    }
  } catch (cause) {
    return failSubmission(ports, {
      draft,
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
      draft,
      references: referenceTokens,
      audio: audioToken,
    });
    sanitizedInputs = sanitized?.inputs ?? { ...draft.providerInputs };
    if ((sanitized?.errors ?? []).length) {
      const [firstError] = sanitized!.errors!;
      throw new GenerationSubmissionError("invalid-input", "Provider inputs are invalid", firstError.field, false);
    }
    assertNoLocalSubmissionUrls(sanitizedInputs, "providerInputs");
  } catch (cause) {
    return failSubmission(ports, {
      draft,
      stage: "sanitize",
      cause,
      placeholderMediaId: exactPlaceholderMediaId,
      retryableDraft,
      field: "providerInputs",
    });
  }

  const context = buildGenerationSubmissionContext({
    draft,
    target,
    referenceTokens,
    audioToken,
  });
  assertNoLocalSubmissionUrls(context, "context");

  let providerSubmit: { providerJobId: string };
  try {
    providerSubmit = await ports.provider.submit({
      provider: draft.provider,
      modelId: draft.modelId,
      modelSchemaVersion: draft.modelSchemaVersion,
      inputs: sanitizedInputs,
      context,
      idempotencyKey: draft.idempotencyKey ?? submissionKey,
    });
  } catch (cause) {
    return failSubmission(ports, {
      draft,
      stage: "submit",
      cause,
      placeholderMediaId: exactPlaceholderMediaId,
      retryableDraft,
      field: "provider",
    });
  }

  const job = buildJob(draft, providerSubmit.providerJobId, context, sanitizedInputs, ports.ids, ports.clock);

  try {
    await ports.cache.put(job);
    await (ports.draftCache ?? generationSubmissionDraftCache).clear(submissionKey);
    return job;
  } catch (cause) {
    return failSubmission(ports, {
      draft,
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
