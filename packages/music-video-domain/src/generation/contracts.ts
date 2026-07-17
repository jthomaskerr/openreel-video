export const GENERATION_JOB_SCHEMA_VERSION = 2 as const;
export const GENERATION_JOB_CONTRACT_VERSION = 2 as const;

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type GenerationProvider = "kieai" | "wavespeed" | "atlascloud";
export type GenerationMode = "text-to-image" | "image-to-image" | "text-to-video" | "image-to-video";
export type GenerationPlacementPolicy = "none" | "create-linked-clip" | "replace-selected-clip-media";
export type GenerationPreparationStatus = "preparing" | "ready" | "failed";
export type GenerationDisposition =
  | "queued" | "submitting" | "running" | "completed" | "finalizing" | "succeeded" | "failed" | "canceled" | "needs-attention";

export interface GenerationRouteIdentity {
  providerInstanceId: string;
  providerModelId: string;
  requestedMode: GenerationMode;
  providerSchemaId: string;
  providerEndpointId: string;
  providerSchemaVersion: string;
}

export type GenerationEntryContext =
  | { kind: "new-asset" }
  | { kind: "unplaced-shot"; shotId: string }
  | { kind: "unlinked-range"; rangeId: string; startTime: number; endTime: number; destinationTrackId?: string }
  | { kind: "linked-projection"; shotId: string; clipId: string; startTime: number; endTime: number };

export type GenerationTarget =
  | { kind: "new-asset"; placeholderMediaId: string }
  | { kind: "new-version"; sourceMediaId: string; placeholderMediaId: string };

export interface GenerationTiming { source: "timeline" | "shot" | "manual"; startSeconds: number; endSeconds: number; durationSeconds: number }
export interface GenerationPlacementState { policy: GenerationPlacementPolicy; status: "pending" | "applied" | "failed" | "skipped"; appliedAt?: number; error?: GenerationError; replaySafe?: boolean }
export type GenerationReferenceOrigin = "source" | "character" | "shot" | "user";

export interface ResolvedGenerationReference {
  id: string; order: number; mediaId: string; versionId?: string; origins: GenerationReferenceOrigin[];
  state: "active" | "failed"; preparationStatus: GenerationPreparationStatus; errorHistory: GenerationError[]; uploadLeaseId?: string;
}
export interface ResolvedGenerationAudio {
  sourceMediaId: string; sourceVersionId: string; sourceClipId: string; projectStartSeconds: number; projectEndSeconds: number;
  sourceStartSeconds: number; sourceEndSeconds: number; mimeType: string; sha256: string; preparationStatus: GenerationPreparationStatus; uploadLeaseId?: string;
}

export interface GenerationContext {
  projectId: string; entryContext: GenerationEntryContext; mode: GenerationMode; placementPolicy: GenerationPlacementPolicy;
  prompt: string; negativePrompt?: string; references: ResolvedGenerationReference[]; audioAssetId?: string;
  audioRange?: { startTime: number; endTime: number };
}
export interface GenerationError { code: string; message: string; field?: string; retryable: boolean }
export type GenerationRouteErrorCode = "generation-route-unsupported" | "generation-route-ambiguous" | "generation-route-stale" | "generation-schema-drift" | "generation-v2-rollback-active";
export interface GenerationRouteError { code: GenerationRouteErrorCode; message: string; retryable: boolean; routing?: GenerationRouteIdentity }
export interface GenerationAttempt { attemptNumber: number; routing: GenerationRouteIdentity; providerJobId?: string; startedAt: number; endedAt?: number; terminalError?: GenerationError }
export type GenerationCheckpointName = "output-claimed" | "output-downloaded" | "output-verified" | "output-inspected" | "placeholder-finalized" | "shot-linked" | "placement-applied";
export interface GenerationCheckpointState { status: "pending" | "completed" | "failed"; timestamp?: number; error?: GenerationError }
export interface GenerationOutput { mediaId: string; versionId: string; mimeType: string; byteLength: number; sha256: string; width?: number; height?: number; durationSeconds?: number }

export interface GenerationJob {
  schemaVersion: typeof GENERATION_JOB_SCHEMA_VERSION; contractVersion: typeof GENERATION_JOB_CONTRACT_VERSION; id: string; projectId: string;
  provider: GenerationProvider; providerInstanceId: string; modelId: string; modelSchemaVersion: string; routing: GenerationRouteIdentity;
  providerJobId?: string; status: GenerationDisposition; attempt: number; context: GenerationContext; providerInputs: Record<string, JsonValue>;
  attempts: GenerationAttempt[]; checkpoints: Partial<Record<GenerationCheckpointName, GenerationCheckpointState>>; output?: GenerationOutput;
  outputUrls?: string[]; outputMediaIds?: string[]; error?: GenerationError; createdAt: string | number; updatedAt: string | number; placement?: GenerationPlacementState;
}
export interface GenerationModelCapability { provider: GenerationProvider; modelId: string; schemaVersion: string; output: "image" | "video"; mode: GenerationMode; supportsAudio: boolean; sourceField?: string; referenceField?: string; audioField?: string; referenceMinimum?: number; referenceMaximum?: number }
export interface GenerationSubmitRequest { projectId: string; jobId: string; routing: GenerationRouteIdentity; context: GenerationContext; providerInputs: Record<string, JsonValue> }
export interface GenerationStatusRequest { projectId: string; jobId: string }
export interface GenerationCancelRequest { projectId: string; jobId: string; providerJobId: string }
export interface GenerationProviderRetryRequest { projectId: string; jobId: string; attemptNumber: number; failedProviderJobId: string }
export interface GenerationFinalizationRetryRequest { projectId: string; jobId: string; output: GenerationOutput }
export interface GenerationPlacementRetryRequest { projectId: string; jobId: string; placementPolicy: GenerationPlacementPolicy }
export interface GenerationReferenceRetryCommand { projectId: string; jobId: string; referenceId: string }
export interface GenerationReferenceRemoveCommand extends GenerationReferenceRetryCommand {}
export interface GenerationReferenceDeactivateCommand extends GenerationReferenceRetryCommand {}
export interface SanitizedGenerationProvenance { provider: GenerationProvider; modelId: string; modelSchemaVersion: string; jobId: string; routing: GenerationRouteIdentity; timing?: GenerationTiming; sha256?: string; width?: number; height?: number; durationSeconds?: number; audio?: Omit<ResolvedGenerationAudio, "uploadLeaseId">; output?: GenerationOutput; checkpoints: Array<{ name: GenerationCheckpointName; status: GenerationCheckpointState["status"]; timestamp: number; error?: GenerationError }>; references: Array<{ id: string; order: number; mediaId: string; versionId?: string; origins: GenerationReferenceOrigin[]; state: "active" | "failed"; preparationStatus: GenerationPreparationStatus }> }
export interface ProjectCharacter { id: string; slug: string; displayName: string; primaryImageMediaId: string; primaryImageVersionId?: string }

export const GENERATION_DISPOSITION_TRANSITIONS: Readonly<Record<GenerationDisposition, readonly GenerationDisposition[]>> = {
  queued: ["submitting", "canceled", "needs-attention"], submitting: ["running", "failed", "canceled", "needs-attention"],
  running: ["completed", "failed", "canceled", "needs-attention"], completed: ["finalizing", "needs-attention", "failed"],
  finalizing: ["succeeded", "needs-attention", "failed"], "needs-attention": ["queued", "submitting", "running", "finalizing", "failed", "canceled"],
  failed: ["queued", "canceled"], canceled: [], succeeded: [],
};
export const ACTIVE_GENERATION_DISPOSITIONS = ["queued", "submitting", "running", "finalizing"] as const;
export const TERMINAL_GENERATION_DISPOSITIONS = ["canceled", "failed", "succeeded"] as const;
export const isLegalGenerationTransition = (from: GenerationDisposition, to: GenerationDisposition) => GENERATION_DISPOSITION_TRANSITIONS[from].includes(to);
export const isGenerationPollingActive = (status: GenerationDisposition) => status === "queued" || status === "submitting" || status === "running" || status === "finalizing";
export const isGenerationTerminal = (status: GenerationDisposition) => TERMINAL_GENERATION_DISPOSITIONS.includes(status as (typeof TERMINAL_GENERATION_DISPOSITIONS)[number]);
export function transitionGenerationDisposition(job: GenerationJob, next: GenerationDisposition): GenerationJob {
  if (!isLegalGenerationTransition(job.status, next)) throw new Error("generation-invalid-transition");
  return { ...job, status: next };
}
export function shouldResumeGenerationAfterReload(job: GenerationJob): boolean {
  if (job.status === "queued") return true;
  return (job.status === "submitting" || job.status === "running" || job.status === "finalizing") && Boolean(job.providerJobId);
}
export function beginGenerationProviderRetry(job: GenerationJob, providerJobId: string, startedAt: number): GenerationJob {
  if (job.status !== "failed") throw new Error("generation-invalid-transition");
  assertNewProviderJobId(job.providerJobId, providerJobId);
  const nextAttempt = job.attempt + 1;
  const attempt = { attemptNumber: nextAttempt, routing: job.routing, providerJobId, startedAt };
  return { ...job, status: "submitting", attempt: nextAttempt, providerJobId, attempts: [...job.attempts, attempt], error: undefined, updatedAt: startedAt };
}
export function beginGenerationFinalizationRetry(job: GenerationJob): GenerationJob {
  if (job.status !== "needs-attention" || !job.output || !job.providerJobId) throw new Error("generation-finalization-retry-unavailable");
  return { ...job, status: "finalizing" };
}
export type GenerationV2Operation = "poll" | "cancel" | "provider-retry" | "recover" | "finalize" | "finalization-retry";
export interface GenerationSubmittedV2Precondition { contractVersion: typeof GENERATION_JOB_CONTRACT_VERSION; providerJobId: string; attempt: number; }
export function getGenerationSubmittedV2Precondition(job: GenerationJob): GenerationSubmittedV2Precondition {
  if (job.contractVersion !== GENERATION_JOB_CONTRACT_VERSION || !job.providerJobId) throw new Error("generation-v2-submission-not-persisted");
  return { contractVersion: job.contractVersion, providerJobId: job.providerJobId, attempt: job.attempt };
}
export function assertGenerationV2SubmissionAllowed(contractVersion: number, generationV2ReleaseEnabled: boolean): void {
  if (contractVersion === GENERATION_JOB_CONTRACT_VERSION && !generationV2ReleaseEnabled) throw new Error("generation-v2-rollback-active");
}
export function assertGenerationV2ExistingOperationAllowed(job: GenerationJob, operation: GenerationV2Operation, generationV2ReleaseEnabled: boolean): GenerationSubmittedV2Precondition {
  const precondition = getGenerationSubmittedV2Precondition(job);
  const allowed: Record<GenerationV2Operation, readonly GenerationDisposition[]> = {
    poll: ["submitting", "running"], cancel: ["queued", "submitting", "running", "needs-attention"], "provider-retry": ["failed"],
    recover: ["needs-attention"], finalize: ["finalizing"], "finalization-retry": ["needs-attention"],
  };
  if (!allowed[operation].includes(job.status)) throw new Error("generation-v2-operation-invalid-state");
  void generationV2ReleaseEnabled;
  return precondition;
}
export function assertNewProviderJobId(previous: string | undefined, next: string): void { if (previous !== undefined && previous === next) throw new Error("generation-provider-job-id-reused"); }
export const PROVIDER_RESPONSE_DISPOSITIONS = ["submitting", "running"] as const;
export function acceptGenerationProviderResponse(job: GenerationJob, projectId: string, attempt: number, providerJobId: string): boolean {
  if (job.projectId !== projectId || job.attempt !== attempt || !PROVIDER_RESPONSE_DISPOSITIONS.includes(job.status as (typeof PROVIDER_RESPONSE_DISPOSITIONS)[number])) return false;
  const activeAttempt = job.attempts.find((candidate) => candidate.attemptNumber === attempt);
  return Boolean(job.providerJobId && job.providerJobId === providerJobId && activeAttempt?.providerJobId === providerJobId);
}
export function assertDurableGenerationValue(value: unknown): void {
  const text = JSON.stringify(value);
  if (text && /(?:blob:|local:|file:|data:|https?:\/\/localhost(?::|\/)|signed:|temporary:)/i.test(text)) throw new Error("generation-local-url-forbidden");
}
export function serializeDurableGenerationValue<T>(value: T): string { assertDurableGenerationValue(value); return JSON.stringify(value); }
