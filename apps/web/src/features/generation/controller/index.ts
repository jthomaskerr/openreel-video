import type {
  GenerationError,
  GenerationJob,
  GenerationProvider,
  GenerationRouteIdentity,
  JsonValue,
} from "@openreel/music-video-domain/generation";
import {
  assertDurableGenerationValue,
  isGenerationPollingActive,
  shouldResumeGenerationAfterReload,
} from "@openreel/music-video-domain/generation";
import { stableSubmissionStringify } from "../drafts/v2";
import {
  submitGeneration,
  type GenerationAudioDraft,
  type GenerationDraft,
  type GenerationReferenceDraft,
  type SubmitGenerationPorts,
} from "../submit-generation";

export interface GenerationSubmissionIdentity {
  key: string;
  projectId: string;
  provider: GenerationProvider;
  providerInstanceId: string;
  modelId: string;
  modelSchemaVersion: string;
  routing: GenerationRouteIdentity;
  target: GenerationDraft["target"];
  context: GenerationDraft["context"];
  providerInputs: GenerationDraft["providerInputs"];
  references: readonly GenerationReferenceDraft[];
  audio?: GenerationAudioDraft;
  placementPolicy?: GenerationDraft["placementPolicy"];
}

export type SubmissionClaimResult =
  | { status: "claimed"; claimId: string }
  | { status: "existing"; job: GenerationJob }
  | { status: "pending"; waitForCompletion: Promise<GenerationJob> };

export type ReconciliationClaimResult =
  | { status: "claimed"; claimId: string }
  | { status: "existing"; job: GenerationJob }
  | { status: "pending"; waitForCompletion: Promise<GenerationJob> };

export interface LegacyGenerationRecord {
  kind: "legacy";
  storeKey: string;
  projectId: string;
  payload: Record<string, JsonValue>;
}

export interface V2GenerationRecord {
  kind: "v2";
  job: GenerationJob;
}

export type GenerationStoredRecord = LegacyGenerationRecord | V2GenerationRecord;

export interface LegacyGenerationNeedsAttention {
  kind: "legacy";
  storeKey: string;
  projectId: string;
  status: "needs-attention";
  error: GenerationError;
}

export type ReconciledGenerationJob = GenerationJob | LegacyGenerationNeedsAttention;

export interface GenerationLeaseReleaseCapability {
  readonly acquiredTokenIds: readonly string[];
  releaseAll(): Promise<void>;
  transferOwnership(): void;
}

export interface GenerationControllerJobCache {
  claimSubmission(input: { identity: GenerationSubmissionIdentity }): Promise<SubmissionClaimResult>;
  completeSubmission(input: { key: string; claimId: string; job: GenerationJob }): Promise<void>;
  failSubmission(input: { key: string; claimId: string; error: GenerationError }): Promise<void>;
  claimReconciliation(input: { projectId: string; jobId: string; sessionId: string }): Promise<ReconciliationClaimResult>;
  completeReconciliation(input: { projectId: string; jobId: string; sessionId: string; claimId: string; job: GenerationJob }): Promise<void>;
  invalidateReconciliation(input: { projectId: string; jobId: string; sessionId: string }): Promise<void>;
  list(projectId: string): Promise<readonly GenerationStoredRecord[]>;
  save(job: ReconciledGenerationJob): Promise<ReconciledGenerationJob>;
}

export interface GenerationReferenceLeasePort {
  releaseUploadLease(input: { tokenId: string }): Promise<void>;
}

export interface GenerationStatusPort {
  read(job: GenerationJob): Promise<GenerationJob>;
}

export interface GenerationControllerPorts {
  submission: SubmitGenerationPorts;
  leases: GenerationReferenceLeasePort;
  jobs: GenerationControllerJobCache;
  status: GenerationStatusPort;
}

export interface GenerationControllerOptions {
  sessionId?: string;
}

export interface GenerationController {
  submit(draft: GenerationDraft): Promise<GenerationJob>;
  reconcile(projectId: string): Promise<readonly ReconciledGenerationJob[]>;
  invalidateReconciliation(input: { projectId: string; jobId: string }): Promise<void>;
}

export class GenerationControllerOwnershipError extends Error {
  constructor(readonly code: "generation-job-project-mismatch" | "generation-context-project-mismatch", message: string) {
    super(message);
    this.name = "GenerationControllerOwnershipError";
  }
}

export class GenerationLeaseReleaseError extends Error {
  readonly code = "generation-reference-release-failed";

  constructor(readonly tokenIds: readonly string[], readonly causes: readonly unknown[]) {
    super(`Failed to release ${causes.length} generation reference lease(s)`);
    this.name = "GenerationLeaseReleaseError";
  }
}

function submissionKey(draft: GenerationDraft): string {
  return stableSubmissionStringify({
    projectId: draft.projectId,
    provider: draft.provider,
    providerInstanceId: draft.providerInstanceId,
    modelId: draft.modelId,
    modelSchemaVersion: draft.modelSchemaVersion,
    routing: draft.routing,
    target: draft.target,
    context: draft.context,
    providerInputs: draft.providerInputs,
    references: draft.references,
    audio: draft.audio,
    placementPolicy: draft.placementPolicy,
    idempotencyKey: draft.idempotencyKey,
  });
}

function buildSubmissionIdentity(draft: GenerationDraft): GenerationSubmissionIdentity {
  return {
    key: submissionKey(draft),
    projectId: draft.projectId,
    provider: draft.provider,
    providerInstanceId: draft.providerInstanceId,
    modelId: draft.modelId,
    modelSchemaVersion: draft.modelSchemaVersion,
    routing: draft.routing,
    target: draft.target,
    context: draft.context,
    providerInputs: draft.providerInputs,
    references: draft.references ?? [],
    audio: draft.audio,
    placementPolicy: draft.placementPolicy,
  };
}

function toGenerationError(cause: unknown): GenerationError {
  if (cause && typeof cause === "object") {
    const candidate = cause as Partial<GenerationError>;
    if (typeof candidate.code === "string" && typeof candidate.message === "string" && typeof candidate.retryable === "boolean") {
      return { code: candidate.code, message: candidate.message, field: candidate.field, retryable: candidate.retryable };
    }
  }
  return { code: "generation-controller-submit-failed", message: cause instanceof Error ? cause.message : String(cause), retryable: true };
}

function validateJobOwnership(job: GenerationJob, projectId: string): void {
  if (job.projectId !== projectId) {
    throw new GenerationControllerOwnershipError("generation-job-project-mismatch", `Generation job ${job.id} belongs to ${job.projectId}, not ${projectId}`);
  }
  if (job.context.projectId !== projectId) {
    throw new GenerationControllerOwnershipError("generation-context-project-mismatch", `Generation job ${job.id} context belongs to ${job.context.projectId}, not ${projectId}`);
  }
}

function legacyNeedsAttention(record: LegacyGenerationRecord): LegacyGenerationNeedsAttention {
  return {
    kind: "legacy",
    storeKey: record.storeKey,
    projectId: record.projectId,
    status: "needs-attention",
    error: {
      code: "generation-legacy-job-unsupported",
      message: "This generation job predates the durable GenerationContext contract and needs review.",
      retryable: false,
    },
  };
}

function createLeaseReleaseCapability(
  submission: SubmitGenerationPorts,
  leases: GenerationReferenceLeasePort,
): { submission: SubmitGenerationPorts; capability: GenerationLeaseReleaseCapability } {
  const acquired = new Set<string>();
  let transferred = false;
  const capability: GenerationLeaseReleaseCapability = {
    get acquiredTokenIds() {
      return [...acquired];
    },
    async releaseAll() {
      if (transferred || acquired.size === 0) return;
      const tokenIds = [...acquired];
      const causes: unknown[] = [];
      for (const tokenId of tokenIds) {
        try {
          await leases.releaseUploadLease({ tokenId });
        } catch (cause) {
          causes.push(cause);
        }
      }
      acquired.clear();
      if (causes.length > 0) throw new GenerationLeaseReleaseError(tokenIds, causes);
    },
    transferOwnership() {
      transferred = true;
      acquired.clear();
    },
  };
  const references = submission.references
    ? {
        ...submission.references,
        async uploadReference(input: GenerationReferenceDraft) {
          const result = await submission.references!.uploadReference(input);
          acquired.add(result.tokenId);
          return result;
        },
      }
    : undefined;
  return { submission: { ...submission, references }, capability };
}

export function createGenerationController(
  ports: GenerationControllerPorts,
  options: GenerationControllerOptions = {},
): GenerationController {
  const sessionId = options.sessionId ?? createDurableId("generation-session");
  const submissionInflight = new Map<string, Promise<GenerationJob>>();
  const reconciliationInflight = new Map<string, Promise<GenerationJob>>();
  const reconciledJobs = new Map<string, GenerationJob>();
  const reconciliationEpochs = new Map<string, number>();

  function reconciliationEpoch(key: string): number {
    return reconciliationEpochs.get(key) ?? 0;
  }

  async function reconcileOne(job: GenerationJob): Promise<GenerationJob> {
    validateJobOwnership(job, job.projectId);
    const key = `${sessionId}:${job.projectId}:${job.id}`;
    const cached = reconciledJobs.get(key);
    if (cached) return cached;
    const existing = reconciliationInflight.get(key);
    if (existing) return existing;
    const epoch = reconciliationEpoch(key);
    const isCurrent = () => reconciliationEpoch(key) === epoch;

    const operation = (async () => {
      const claim = await ports.jobs.claimReconciliation({ projectId: job.projectId, jobId: job.id, sessionId });
      if (claim.status === "existing") {
        validateJobOwnership(claim.job, job.projectId);
        return claim.job;
      }
      if (claim.status === "pending") {
        const completed = await claim.waitForCompletion;
        validateJobOwnership(completed, job.projectId);
        return completed;
      }
      let next = job;
      if (isGenerationPollingActive(job.status) && shouldResumeGenerationAfterReload(job)) {
        const authoritative = await ports.status.read(job);
        validateJobOwnership(authoritative, job.projectId);
        assertDurableGenerationValue(authoritative);
        next = stableSubmissionStringify(authoritative) === stableSubmissionStringify(job) ? job : authoritative;
        if (!isCurrent()) return next;
        if (next !== job) await ports.jobs.save(next);
      }
      if (!isCurrent()) return next;
      await ports.jobs.completeReconciliation({ projectId: job.projectId, jobId: job.id, sessionId, claimId: claim.claimId, job: next });
      return next;
    })();
    reconciliationInflight.set(key, operation);
    void operation.then((result) => {
      if (isCurrent()) reconciledJobs.set(key, result);
    }).finally(() => {
      if (reconciliationInflight.get(key) === operation) reconciliationInflight.delete(key);
    }).catch(() => undefined);
    return operation;
  }

  return {
    async submit(draft) {
      const identity = buildSubmissionIdentity(draft);
      const active = submissionInflight.get(identity.key);
      if (active) return active;
      const operation = (async () => {
        const claim = await ports.jobs.claimSubmission({ identity });
        if (claim.status === "existing") return claim.job;
        if (claim.status === "pending") return claim.waitForCompletion;
        const leaseScope = createLeaseReleaseCapability(ports.submission, ports.leases);
        try {
          const job = await submitGeneration(draft, leaseScope.submission);
          assertDurableGenerationValue(job);
          await ports.jobs.completeSubmission({ key: identity.key, claimId: claim.claimId, job });
          leaseScope.capability.transferOwnership();
          return job;
        } catch (cause) {
          const affectedTokenIds = [...leaseScope.capability.acquiredTokenIds];
          const errors: unknown[] = [];
          try {
            await ports.jobs.failSubmission({ key: identity.key, claimId: claim.claimId, error: toGenerationError(cause) });
          } catch (failure) {
            errors.push(failure);
          }
          try {
            await leaseScope.capability.releaseAll();
          } catch (release) {
            errors.push(release);
          }
          if (errors.length > 0) throw new GenerationLeaseReleaseError(affectedTokenIds, errors);
          throw cause;
        }
      })();
      submissionInflight.set(identity.key, operation);
      void operation.finally(() => { submissionInflight.delete(identity.key); }).catch(() => undefined);
      return operation;
    },

    async reconcile(projectId) {
      const stored = await ports.jobs.list(projectId);
      const results: ReconciledGenerationJob[] = [];
      for (const record of stored) {
        if (record.kind === "legacy") {
          if (record.projectId !== projectId) throw new GenerationControllerOwnershipError("generation-job-project-mismatch", `Legacy record ${record.storeKey} belongs to ${record.projectId}, not ${projectId}`);
          const migrated = legacyNeedsAttention(record);
          assertDurableGenerationValue(migrated);
          results.push(await ports.jobs.save(migrated));
          continue;
        }
        validateJobOwnership(record.job, projectId);
        results.push(await reconcileOne(record.job));
      }
      return results;
    },

    async invalidateReconciliation(input) {
      const key = `${sessionId}:${input.projectId}:${input.jobId}`;
      reconciliationEpochs.set(key, reconciliationEpoch(key) + 1);
      reconciledJobs.delete(key);
      reconciliationInflight.delete(key);
      await ports.jobs.invalidateReconciliation({ ...input, sessionId });
    },
  };
}

export function resetGenerationControllerState(): void {
  // Controller state is intentionally instance/session scoped. Kept as a compatibility no-op for old tests.
}
import { createDurableId } from "@openreel/core";
